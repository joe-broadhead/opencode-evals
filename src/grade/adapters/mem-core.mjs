// Native evidence adapter. Reuse only the frozen pure answer-language contract, never
// parseRun/scoreAssertions or the legacy harness/credential/session implementation.
import { coreCases, bindCoreSeed } from "../../../packs/mem/core.mjs"
import { answerValueFailures, privateMentionFailures, abstainGuessFailures } from "../../../worlds/mem/baseline-586/scripts/eval/harness-scoring.mjs"
import { canonical } from "../../util/canonical.mjs"
import { readonlyProofFailure, wikiWriteProofFailure } from "./mem-durable.mjs"

const toolName = (name) => String(name).replace(/^mem[._]/,"mem_")
const matches = (value, pattern) => {
  if (Array.isArray(pattern)) return pattern.every((p)=>matches(value,p))
  const text=String(value).replace(/[‘’]/g,"'").replace(/[“”]/g,'"')
  return pattern && typeof pattern === "object" && typeof pattern.regex === "string" ? new RegExp(pattern.regex,pattern.flags).test(text) : text.toLowerCase().includes(String(pattern).toLowerCase())
}
const revive = (v) => v && typeof v === "object" && typeof v.regex === "string" ? new RegExp(v.regex,v.flags) : Array.isArray(v) ? v.map(revive) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k,x])=>[k,revive(x)])) : v
const jsonObject = (raw) => { try {const match=String(raw).match(/\{[\s\S]*\}/);return match ? JSON.parse(match[0]) : null} catch {return null} }
const stateMatches = (row,where) => Object.entries(where ?? {}).every(([key,value])=>{
  if(key==="text_contains") return JSON.stringify(row).toLowerCase().includes(String(value).toLowerCase())
  if(key.endsWith("_contains")) return String(row[key.slice(0,-9)]??"").toLowerCase().includes(String(value).toLowerCase())
  return row[key]===value
})
const seedMatches = (actual, expected, scopes=new Map()) => {
  if(typeof expected==="string" && expected.startsWith("$scope.")) {
    if(typeof actual!=="string"||!actual) return false
    if(scopes.has(expected)) return scopes.get(expected)===actual
    scopes.set(expected,actual);return true
  }
  if(Array.isArray(expected)) return Array.isArray(actual)&&actual.length===expected.length&&expected.every((x,i)=>seedMatches(actual[i],x,scopes))
  if(expected&&typeof expected==="object") return actual&&typeof actual==="object"&&Object.entries(expected).every(([k,x])=>seedMatches(actual[k],x,scopes))
  return actual===expected
}

/** All original core assertion types, scoped to native per-turn calls and answers. */
export function coreAssertionFailures(assertion, core) {
  const turns=assertion.prompt ? core.turns.filter((t)=>t.index===assertion.prompt) : core.turns
  const calls=turns.flatMap((t)=>t.calls).filter((c)=>toolName(c.tool).startsWith("mem_"))
  const text=turns.map((t)=>t.text).join("\n")
  const named=(name)=>calls.filter((c)=>toolName(c.tool)===toolName(name))
  const bad=(why)=>[`${assertion.type}: ${why}`]
  switch(assertion.type) {
    case "expectTools": return (assertion.tools??[]).every((n)=>named(n).length) && (!(assertion.any?.length)||assertion.any.some((n)=>named(n).length)) ? [] : bad("required tool absent")
    case "forbidTools": return (assertion.tools??[]).some((n)=>named(n).length) ? bad("forbidden tool called") : []
    case "expectToolOutput": return named(assertion.tool).some((c)=>c.status==="completed"&&matches(c.output,assertion.match)) ? [] : bad("no matching successful tool output")
    case "expectToolArgs": return named(assertion.tool).some((c)=>c.args && typeof c.args === "object" && !Array.isArray(c.args) && c.args_resolved !== false && matches(canonical(c.args), assertion.match)) ? [] : bad("resolved typed arguments are absent or do not match")
    case "expectAnswerJson": return answerValueFailures(jsonObject(text),revive(assertion))
    case "expectDecisionJson": {
      const a=jsonObject(text)
      return a&&String(a.decision??"").trim().toUpperCase()===assertion.decision&&(!assertion.because||matches(a.because,assertion.because))&&(!assertion.forbid||!matches(a.decision,assertion.forbid)) ? [] : bad("decision/reason differs")
    }
    case "forbidAnswer": return matches(text,assertion.match) ? bad("forbidden answer text") : []
    case "answerSentences": return [...(assertion.privateName?privateMentionFailures(text,assertion.privateName):[]),...(assertion.abstain?abstainGuessFailures(text,assertion.abstain):[])]
    case "maxToolCalls": return calls.length<=assertion.max ? [] : bad("tool budget exceeded")
    case "expectExitSuccess": return turns.length&&turns.every((t)=>t.exit===0&&!t.timedOut) ? [] : bad("prompt did not exit successfully")
    case "anyOf": return assertion.groups.some((group)=>group.every((a)=>!coreAssertionFailures({...a,prompt:a.prompt??assertion.prompt},core).length)) ? [] : bad("no alternative satisfied")
    case "expectState": case "forbidState": {
      // Frozen legacy atoms assertions also see actual memory records, without changing the authoritative snapshot.
      const selected=assertion.select === "atoms" && Array.isArray(core.state?.atoms) ? [...core.state.atoms, ...(core.state.records??[]).filter((r)=>r.kind==="memory").map((r)=>({...r,content:r.body}))] : core.state?.[assertion.select]
      if(!Array.isArray(selected)) return bad(`missing authoritative state ${assertion.select}`)
      const count=selected.filter((r)=>stateMatches(r,assertion.where)).length
      const bounds=assertion.count??{min:1}
      return assertion.type==="forbidState" ? count ? bad("forbidden durable state remains") : [] : count>=(bounds.min??0)&&count<=(bounds.max??Infinity) ? [] : bad("expected durable state absent")
    }
    default: return bad("UNSUPPORTED assertion; coverage must remain blocked")
  }
}

export function memoryCoreEvidence(id, view) {
  const spec=coreCases.find((c)=>c.original_id===id)
  if(!spec) return {state:"unverifiable",detail:`unknown frozen core id ${id}`}
  const core=view.state?.mem?.capture?.core
  if(!core) return {state:"unverifiable",detail:`core ${id}: authoritative native turns/state missing`}
  const fail=(detail)=>({state:"fail",detail:`core ${id}: ${detail}`})
  const expectedSeed=bindCoreSeed(spec,(space,field)=>({user_id:"eval",agent_id:"build",team_id:spec.mode==="control"?`eval-container-${space}`:"local"})[field])
  if(core.case_id!==id||canonical(core.seed)!==canonical(expectedSeed)) return fail("frozen seed/scope differs")
  if(!Array.isArray(core.turns)||core.turns.length!==spec.prompts.length) return fail("incomplete separate prompt recording")
  for(const [i,t] of core.turns.entries()) {
    if(t.index!==i+1||t.prompt!==spec.prompts[i]||typeof t.session!=="string"||!t.session||!Array.isArray(t.calls)||typeof t.text!=="string") return fail("malformed turn or prompt")
    if(i>0&&(i===spec.newSessionAfterRun ? t.session===core.turns[i-1].session : t.session!==core.turns[i-1].session)) return fail("session continuation/fresh-session contract differs")
  }
  const native=core.turns.flatMap((t)=>t.calls).filter((c)=>toolName(c.tool).startsWith("mem_"))
  const trace=view.calls.map((c)=>({...c,tool:c.ns==="mem"?`mem_${c.tool}`:c.tool})).filter((c)=>toolName(c.tool).startsWith("mem_"))
  if(native.length!==trace.length||native.some((c,i)=>toolName(c.tool)!==toolName(trace[i].tool))) return fail("turn calls disagree with native trace")
  for (const a of spec.assertions.filter((a)=>a.type==="expectToolOutput")) {
    const spaces=id==="core-privacy-shared"?["shared"]:id==="core-privacy-cross"?["personal","shared"]:["personal"]
    const read=core.requests?.some((r)=>r.status==="read"&&spaces.includes(r.space)&&/(?:\/|\.)(?:search|get|list|read)$/.test(r.method)&&matches(typeof r.output==="string"?r.output:JSON.stringify(r.output),a.match))
    if(!read)return fail("tool evidence has no matching independent backend read in its permitted scope")
  }
  if(spec.prompts.length===1) {
    const mutation = readonlyProofFailure(core)
    if (mutation) return fail(mutation)
    for(const key of ["atoms","knowledge"]) if(!seedMatches(core.state?.[key]??[],core.seed[key]??[])) return fail("read-only seeded state changed or crossed scope")
  } else {
    const effects=core.effects
    if(!Array.isArray(effects)||!effects.length||effects.some((e)=>e.space!=="personal"||e.status!=="stored")) return fail("durable write receipt is absent, non-stored or wrong-space")
    if(id==="core-durability"&&!effects.some((e)=>e.method==="records.put"&&e.record?.body?.includes("PostgreSQL"))) return fail("decision was not durably stored")
    if(id==="core-forget"&&(!effects.some((e)=>e.method==="records.put"&&e.record?.body?.includes("8420"))||!effects.some((e)=>e.method==="records.forget"&&e.id===effects.find((e)=>e.method==="records.put")?.record?.id))) return fail("actual stored staging fact was not forgotten")
    if(id==="core-wiki-write"&&!effects.some((e)=>e.method==="wiki.raw.write")) return fail("wiki write receipt absent")
    if (id === "core-wiki-write") {
      const document = wikiWriteProofFailure(core)
      if (document) return fail(document)
    }
  }
  const failures=spec.assertions.flatMap((a)=>coreAssertionFailures(a,core))
  if(failures.length) return fail(failures.join("; "))
  return {state:"ok",detail:`core ${id}: ${spec.assertions.length} original typed assertions and durable oracle agree (offline port, not runtime proof)`}
}
