// Discovery-only oracle. No core-grader change and no state inferred from model answers or receipt prose.
import {isDeepStrictEqual as equal} from "node:util"
import {discoveryCases,DISCOVERY_VERSION} from "../../../packs/mem/discovery-plan.mjs"
import {memoryCall} from "../../run/guard/mem-targets.mjs"
import {sha256} from "../../util/canonical.mjs"
const name=c=>c.ns==="mem"?c.tool:String(c.tool).replace(/^mem[._]/,"")
const plain=v=>Boolean(v&&typeof v==="object"&&!Array.isArray(v))
const family=c=>({wikis:"wiki",pages:"page"})[name(c)]??name(c)
const writes=new Set(["records.put","wiki.raw.write","sources.request","plugins.request","jobs.draft"])
const failedStatuses=new Set(["queued","pending","denied","unsupported","error","failed","failure","rejected"])
function failedEnvelope(value){
  if(!value||typeof value!=="object")return false
  if(Array.isArray(value))return value.some(failedEnvelope)
  if(Object.hasOwn(value,"error")||Object.hasOwn(value,"errors")||failedStatuses.has(value.status)||value.success===false||value.ok===false||value.partial===true||value.metadata_only===true||Object.hasOwn(value,"code")&&value.code!==0)return true
  return Object.values(value).some(failedEnvelope)
}
function successfulObservation(r){
  const expected=writes.has(r.method)?"stored":"read"
  const outputStatus=["wiki.get","wiki.ingest","code-graph.get","code-graph.status"].includes(r.method)?"ready":expected
  return r.http_status===200&&r.status===expected&&plain(r.output)&&!failedEnvelope(r.output)&&(r.output.status===undefined||r.output.status===outputStatus)&&(r.method==="records.put"||equal(r.wire_input,r.input))
}
function nativeFailure(c){
  if(c.status!=="completed")return true
  try{return failedEnvelope(JSON.parse(c.output))}catch{return false} // Prose is not backend truth.
}
function bindingMatches(s,c){
  if((s.write?name(c):family(c))!==s.binding.tool||!plain(c.args))return false
  const args=structuredClone(c.args)
  if(!s.write){if(args.space!==undefined&&!["personal","eval-space-personal","spc-eval-personal"].includes(args.space))return false;delete args.space;if(s.family==="skills"&&args.skill?.offset===0)delete args.skill.offset;if(["wiki-read","wiki-graph"].includes(s.family)&&args.wiki_id===undefined)args.wiki_id=s.backend.input.wiki_id}
  return equal(args,s.binding.args)
}
export function memoryDiscoveryEvidence(id,view){
  const s=discoveryCases.find(s=>s.id===id),p=view.state?.mem?.capture?.discovery
  const fail=detail=>({state:"fail",detail:`discovery ${id}: ${detail}`})
  if(!s||!p||p.schema!=="oc-mem-discovery-proof/1"||p.suite!==DISCOVERY_VERSION||p.case_id!==id||typeof p.trial_id!=="string")return fail("bound authoritative proof missing")
  if(!["allow","ask-approved"].includes(p.permission?.effect))return fail("successful fake permission condition missing")
  if(view.scope?.ns&&view.scope.ns!=="mem"||!view.guardLog?.some(r=>r.kind==="guard_start"&&r.case_id===id&&r.trial_id===p.trial_id))return fail("native guard/case/trial binding missing")
  if(!equal(p.before,s.seed)||!plain(p.state)||!equal(Object.keys(p.state).sort(),Object.keys(s.seed).sort())||!Array.isArray(p.requests)||!Array.isArray(p.turns)||p.turns.length!==1)return fail("canonical seed/state/turn missing or changed")
  const t=p.turns[0]
  if(t.index!==1||t.prompt!==s.prompt||typeof t.session!=="string"||!t.session||t.exit!==0||t.timedOut||!Array.isArray(t.calls))return fail("native turn contract differs")
  const native=t.calls.filter(c=>String(c.tool).startsWith("mem_")||String(c.tool).startsWith("mem.")),trace=view.calls.filter(c=>c.ns==="mem"||/^mem[._]/.test(c.tool))
  if(native.length!==trace.length||native.some((c,i)=>name(c)!==name(trace[i])))return fail("typed native calls disagree with trace")
  // Match the official events() codec, not canonical-sorted JSON or safeArgs' redacted shapes.
  // Both direct inputRaw and parsed inner site.args use JSON.stringify in recorded key order.
  if(native.some((c,i)=>!plain(c.args)||typeof trace[i].args_sha256!=="string"||!/^[a-f0-9]{64}$/.test(trace[i].args_sha256)||sha256(JSON.stringify(c.args))!==trace[i].args_sha256))return {state:"unverifiable",detail:`discovery ${id}: private typed arguments lack a matching official trace digest`}
  for(const c of native){if(!plain(c.args)||c.args_resolved===false||nativeFailure(c))return fail("unresolved, malformed or failed native invocation");const classified=memoryCall(`mem_${family(c)}`,c.args,{});if(classified?.error&&!bindingMatches(s,c)||!classified&&name(c)!=="recall"||name(c)!==family(c)&&classified?.write)return fail("unknown or malformed native action")}
  if(!native.some(c=>bindingMatches(s,c)&&c.status==="completed"&&c.args_resolved!==false))return fail("source-bound typed invocation absent or wrong action/arguments")
  const changes=native.filter(c=>["remember","page","commitments","wiki","spaces"].includes(name(c))&&((name(c)==="remember")||["write","append","replace","delete","move","add","update","create"].includes(c.args?.action)||c.args?.bind||c.args?.job?.op==="draft"))
  if(changes.some(c=>!s.write||name(c)!==s.binding.tool||!equal(c.args,s.binding.args)))return fail("unrequested mutation invocation")
  const request=p.requests.filter(r=>r.method===s.backend.method&&equal(r.input,s.backend.input)&&r.space==="personal"&&r.http_status===200&&r.context?.active===true&&r.context.case_id===id&&r.context.trial_id===p.trial_id&&r.context.turn===1&&r.context.session===t.session)
  if(request.length!==1)return fail("successful same-case/turn scoped backend observation missing")
  const r=request[0],out=r.output,a=p.state.personal,b=p.before.personal
  if(!plain(a)||!equal(Object.keys(a).sort(),Object.keys(b).sort())||Object.entries(b).some(([k,v])=>Array.isArray(v)?!Array.isArray(a[k]):!plain(a[k]))||!equal(p.state.shared,p.before.shared)||p.requests.some(r=>r.space!=="personal"||!successfulObservation(r)||writes.has(r.method)&&(!s.write||r.method!==s.backend.method)||r.context?.active!==true||r.context.case_id!==id||r.context.trial_id!==p.trial_id||r.context.turn!==1||r.context.session!==t.session))return fail("wrong scope, partial, failed or unverified backend result")
  if(!s.write&&!equal(p.state,p.before))return fail("a read changed durable content")
  let proof=false,expectedState=structuredClone(b)
  if(["memory","page","commitment"].includes(s.family)){
    const expected=s.backend.input.record,record=a.records?.at(-1)
    // Closed finite record payload: optional source-owned projections are content/session-bound.
    const metadata={},wire=r.wire_input?.record
    if(plain(wire)){
      if(Object.hasOwn(wire,"type")&&!Object.hasOwn(expected,"type"))metadata.type=expected.kind
      if(Object.hasOwn(wire,"title"))metadata.title=expected.body.slice(0,200)
      if(Object.hasOwn(wire,"stated_by")&&["agent","person"].includes(wire.stated_by))metadata.stated_by=wire.stated_by
      if(Object.hasOwn(wire,"source"))metadata.source={session:t.session}
      if(Object.hasOwn(wire,"fields")&&s.family==="commitment")metadata.fields={what:expected.body,owner:"user",state:"open"}
    }
    const authorized={...expected,...metadata,id:record?.id,status:"current",version:1}
    proof=plain(r.wire_input)&&Object.keys(r.wire_input).every(k=>["record","upsert_path"].includes(k))&&(r.wire_input.upsert_path===undefined||s.family==="page"&&r.wire_input.upsert_path===true)&&plain(wire)&&equal(wire,{...expected,...metadata})&&plain(record)&&equal(record,authorized)&&record.id===out.record?.id&&equal(record,out.record)
    expectedState.records.push(authorized)
  }else if(s.family==="wiki-write"){
    for(const file of s.backend.input.files)expectedState.raw[file.filename]=file.content
    proof=equal(out.items,s.backend.input.files.map(f=>({filename:f.filename,status:"written"})))
  }
  else if(s.family==="wiki-read")proof=out.items?.length===1&&out.items[0].filename==="design.md"&&out.items[0].content===b.raw["design.md"]
  else if(s.family==="browse")proof=out.records?.length===1&&equal(out.records[0],b.records[0])&&out.more===true&&typeof out.cursor==="string"&&out.cursor.startsWith("discovery:personal:")
  else if(s.family==="exact-read")proof=out.records?.length===1&&equal(out.records[0],b.records[0])&&out.records[0].body==="Quartz full current body. Record nonce QREC-71."&&Array.isArray(out.missing)&&out.missing.length===0
  else if(s.family==="code")proof=out.nodes?.some(n=>n.id==="submitInvoice"&&n.nonce==="QCODE-37")&&out.edges?.some(e=>e.source==="submitInvoice"&&e.target==="parseInvoice"&&e.kind==="calls")
  else if(s.family==="wiki-graph")proof=out.nodes?.some(n=>n.id==="README.md")&&out.edges?.some(e=>e.source==="README.md"&&e.target==="design.md")&&out.communities?.some(c=>c.id==="quartz-docs"&&c.nonce==="QWIKI-64")
  else if(s.family==="skills")proof=out.items?.length===2&&equal(out.items,b.skills.map(({content,...summary})=>summary))&&out.items[0].version===1&&out.items[0].is_expired===true&&out.items[1].version===2&&out.items[1].is_expired===false
  else if(s.family==="sources"){
    const authorized={id:out.request?.id,...s.backend.input,state:"requested"}
    expectedState.sourceRequests.push(authorized);proof=equal(out.request,authorized)
  }
  else if(s.family==="jobs"){
    const authorized={id:out.job?.id,...s.backend.input,status:"draft",active:false,next_due:null,version:1}
    expectedState.jobs.push(authorized);proof=equal(out.job,authorized)&&equal(out.draft,{version:1,state:"draft"})
  }
  if(!proof)return fail("canonical body/topology/version/request/draft truth not proven")
  if(s.write&&!equal(a,expectedState))return fail("durable poststate is not seed plus exactly the authorized payload")
  if(s.write&&s.family!=="wiki-write"){
    const created=s.family==="sources"?a.sourceRequests[0]:s.family==="jobs"?a.jobs[0]:a.records.at(-1)
    if(typeof created.id!=="string"||!p.creators?.some(c=>c.id===created.id&&c.case_id===id&&c.trial_id===p.trial_id&&c.turn===1&&c.session===t.session&&name(c)===s.binding.tool&&equal(c.args,s.binding.args)&&c.status==="stored"))return fail("backend-owned creation identity is unlinked")
  }
  if(typeof t.text!=="string")return fail("answer missing")
  const answer=t.text.trim(),lower=answer.toLowerCase()
  const truthful=s.legacy_answer_contract?answer===s.answer:s.family==="exact-read"?answer.includes("Quartz full current body. Record nonce QREC-71.")&&!/\b(?:not|missing|unsupported|partial)\b/i.test(answer):s.family==="code"?answer.includes("submitInvoice")&&answer.includes("parseInvoice")&&!/\b(?:not|unknown|unsupported|partial)\b/i.test(answer):s.family==="wiki-graph"?["README.md","design.md","quartz-docs"].every(v=>answer.includes(v))&&!/unknown|unsupported|partial/i.test(answer):s.family==="skills"?/\b1\b[\s\S]*expired[\s\S]*\b2\b[\s\S]*current/i.test(answer):["sources","jobs"].includes(s.family)?answer===s.answer:false
  if(!truthful)return fail("answer differs from the literal verified outcome")
  return {state:"ok",detail:`${id}: scoped durable discovery contract agrees (offline-capable, not runtime approval)`}
}
