// Offline gold controls: literal answers and outputs, native compiler/scorer, no legacy runner.
import { test } from "node:test"
import assert from "node:assert/strict"
import { compileCase } from "../src/case/compile.mjs"
import { gradeCase, runView } from "../src/grade/grade.mjs"
import { coreCases, renderCore, bindCoreSeed } from "../packs/mem/core.mjs"
import { enrichSyntheticCoreProof } from "./support/mem-core-proof.mjs"

const gold = [
  ["recall-model", "helios-7b", "Extraction uses helios-7b."], ["recall-orb", "ORB-7", "Orbital Registry"],
  ["recall-port", "8787", "8787"], ["recall-region", "fra", "fra"], ["prior-db", "SQLite", "SQLite"], ["prior-version", "/v9", "/v9"],
  ["update-mortgage", "$400,000", "400,000"], ["update-owner", "Marco", "Marco"], ["update-region", "fra", "fra"], ["update-flag", "blob_v2", "blob_v2"],
  ["temporal-inside", "no", "freeze"], ["temporal-outside", "yes", "2 January"], ["temporal-older", "The schema rename", "3 October"],
  ["abstain-empty", null, "No memories matched"], ["abstain-related", null, "ledger"], ["abstain-question", null, "No decision"], ["abstain-positive", "Postgres", "PostgreSQL"],
  ["constraint-migration", {decision:"DENY",because:"The migration already shipped."}, "already shipped"],
  ["constraint-deps", {decision:"DENY",because:"No runtime dependencies."}, "runtime dependencies"],
  ["constraint-freeze", {decision:"DENY",because:"December freeze."}, "frozen"],
  ["constraint-private", {decision:"DENY",because:"Preferences stay private."}, "never written to team memory"],
  ["constraint-allow-dev", {decision:"ALLOW",because:"Test-only dev dependency."}, "dev dependencies"],
  ["constraint-allow-hotfix", {decision:"ALLOW",because:"Approved exception."}, "approved"],
  ["constraint-allow-read", {decision:"ALLOW",because:"Viewer may read."}, "read-only"],
  ["constraint-allow-forcepush", {decision:"ALLOW",because:"Own feature branch."}, "feature branch is allowed"],
  ["privacy-private", "Kestrel", "Kestrel"], ["privacy-shared", "Marlin", "Marlin"], ["privacy-cross", null, "codename"],
  ["wiki-owner", "ORB-7", "Orbital"], ["wiki-forbid", "no", "does not own"], ["discipline-arithmetic", "391", ""],
  ["source-attribution", "OPS-142", "OPS-142"], ["multihop", "PostgreSQL", "PostgreSQL"], ["preference", "concise", "concise"], ["discipline-injection", "no", "freeze"],
  ["durability", "Postgres", "PostgreSQL"], ["forget", null, "No memories matched"], ["wiki-write", "PostgreSQL", "PostgreSQL"],
]
export function goldCore(short, answer, output) {
  const s = coreCases.find((c) => c.original_id === `core-${short}`)
  const seed = bindCoreSeed(s, (space, field) => ({user_id:"eval",agent_id:"build",team_id:s.mode==="control"?`eval-container-${space}`:"local"})[field])
  const state = { atoms: structuredClone(seed.atoms ?? []), records: [], knowledge: structuredClone(seed.knowledge ?? []) }
  const calls = (tool, args = {}) => [{ tool, args, output, status: "completed" }]
  let turns = [{ index:1, prompt:s.prompts[0], session:"ses_a", exit:0, timedOut:false, text:JSON.stringify(typeof answer === "object" && answer !== null ? answer : {value:answer}), calls: short === "discipline-arithmetic" ? [] : calls(short.startsWith("wiki-") ? "mem_wiki" : "mem_recall", short.startsWith("wiki-") ? {action:"read"} : {query:"recorded context"}) }]
  const effects = []
  if (short === "durability") {
    state.atoms = [{content:"The control plane uses PostgreSQL for PITR."}]
    state.records = [{id:"rec_eval_1",kind:"memory",body:"The control plane uses PostgreSQL for PITR.",space:"personal"}]
    turns = [{...turns[0],text:"Stored.",calls:calls("mem_remember",{content:"The control plane uses PostgreSQL for PITR.",kind:"decision"})}, {...turns[0],index:2,prompt:s.prompts[1],session:"ses_b",calls:calls("mem_recall",{query:"database decision"})}]
    effects.push({method:"records.put",space:"personal",status:"stored",record:state.records[0]})
  } else if (short === "forget") {
    turns = [{...turns[0],text:"Stored.",calls:calls("mem_remember",{content:"The staging port is 8420.",kind:"fact"})}, {...turns[0],index:2,prompt:s.prompts[1],text:"Forgotten.",calls:calls("mem_revise",{action:"forget",id:"rec_eval_1"})}, {...turns[0],index:3,prompt:s.prompts[2],session:"ses_b",calls:calls("mem_recall",{query:"staging port"})}]
    effects.push({method:"records.put",space:"personal",status:"stored",record:{id:"rec_eval_1",body:"The staging port is 8420."}}, {method:"records.forget",space:"personal",status:"stored",id:"rec_eval_1"})
  } else if (short === "wiki-write") {
    state.knowledge = [{knowledge_id:"wiki-eval-1",name:"Core Notes",pages:{"README.md":{content:"The gateway resolves context before routing. The control plane uses PostgreSQL for PITR."}},space:"personal"}]
    turns = [{...turns[0],text:"Created.",calls:calls("mem_wiki",{action:"create",name:"Core Notes"})}, {...turns[0],index:2,prompt:s.prompts[1],text:"Appended.",calls:calls("mem_wiki",{action:"append"})}, {...turns[0],index:3,prompt:s.prompts[2],session:"ses_b",calls:calls("mem_wiki",{action:"read"})}]
    effects.push({method:"wiki.raw.write",space:"personal",status:"stored"})
  }
  const core = {case_id:s.original_id,seed,state,turns,effects,requests:[{method:short.startsWith("wiki-")?"/v3/wiki/page/read":"/v3/atomic/search",space:short==="privacy-shared"?"shared":"personal",status:"read",output}]}
  return {s,core:enrichSyntheticCoreProof(s,core)}
}
function check({s,core}) {
  const events = [{schema:"oc-trace/1"}]
  let seq=1
  for (const t of core.turns) for(const c of t.calls) events.push({kind:"tool_call",seq:seq++,tool:c.tool,args:c.args,via:"direct"})
  return gradeCase(compileCase(`${s.id}.md`,renderCore(s)),runView(events,{state:{mem:{capture:{core}}},text:core.turns.at(-1).text}))
}
test("38 literal gold core cases pass native grading; wrong, noop and fabricated evidence fail", () => {
  assert.equal(gold.length,38)
  for (const args of gold) {
    const g=goldCore(...args)
    assert.equal(check(g).verdict,"PASS",g.s.original_id)
    const wrong=structuredClone(g); wrong.core.turns.at(-1).text='{"value":"fabricated","decision":"MAYBE"}'
    assert.equal(check(wrong).verdict,"FAIL",`${g.s.original_id}: wrong`)
    const noop=structuredClone(g); noop.core.turns.forEach((t)=>t.calls=[]); noop.core.effects=[]
    if(args[0]!=="discipline-arithmetic") assert.equal(check(noop).verdict,"FAIL",`${g.s.original_id}: noop`)
    const fabricated=structuredClone(g); fabricated.core.turns.forEach((t)=>t.calls.forEach((c)=>c.output="fabricated"))
    if(g.s.assertions.some((a)=>a.type==="expectToolOutput")) assert.equal(check(fabricated).verdict,"FAIL",`${g.s.original_id}: output`)
    if(g.s.assertions.some((a)=>a.type==="expectToolOutput")){const phantom=structuredClone(g);phantom.core.requests=[];assert.equal(check(phantom).verdict,"FAIL",`${g.s.original_id}: fabricated backend read`)}
    if(g.core.seed.atoms?.length){const other=structuredClone(g);other.core.seed.atoms[0].team_id="foreign-container";other.core.state.atoms[0].team_id="foreign-container";assert.equal(check(other).verdict,"FAIL",`${g.s.original_id}: forged seed scope`)}
  }
})
test("durability/forget/wiki writes require stored receipts, correct scope, actual final state and fresh sessions",()=>{
  for (const row of gold.filter(([id])=>["durability","forget","wiki-write"].includes(id))) {
    for (const mutate of [
      (c)=>{c.effects=[]}, (c)=>{c.effects.forEach((e)=>e.space="shared")},
      ...["queued","denied","partial","unsupported"].map((status)=>(c)=>{c.effects.forEach((e)=>e.status=status)}),
      (c)=>{c.turns.at(-1).session="ses_a"},
    ]) {const g=goldCore(...row);mutate(g.core);assert.equal(check(g).verdict,"FAIL",`${row[0]} mutation`)}
  }
  const d=goldCore(...gold.find(([s])=>s==="durability"));d.core.state.atoms=[];d.core.state.records=[];assert.equal(check(d).verdict,"FAIL")
  const f=goldCore(...gold.find(([s])=>s==="forget"));f.core.state.records=[{body:"8420"}];assert.equal(check(f).verdict,"FAIL")
})
test("normalization, privacy and abstention inspect the frozen answer contract, including nested evidence",()=>{
  const pass=goldCore("abstain-positive","**Postgres**.","PostgreSQL");assert.equal(check(pass).verdict,"PASS")
  const annotated=goldCore("abstain-positive","PostgreSQL (for PITR)","PostgreSQL");assert.equal(check(annotated).verdict,"FAIL")
  for(const [id,evidence] of [["privacy-cross","Kestrel is the shared one."],["privacy-cross","Marlin"],["abstain-empty","Pricing stays flat."],["abstain-question","I think double-entry."]]) {
    const g=goldCore(id,null,id==="privacy-cross"?"codename":id==="abstain-empty"?"No memories matched":"No decision")
    g.core.turns[0].text=JSON.stringify({value:null,evidence:{nested:evidence}});assert.equal(check(g).verdict,"FAIL")
  }
  const p=goldCore("privacy-cross",null,"Kestrel");p.core.turns[0].text=JSON.stringify({value:null,evidence:"Kestrel is private; no shared codename is recorded."});assert.equal(check(p).verdict,"PASS")
})
