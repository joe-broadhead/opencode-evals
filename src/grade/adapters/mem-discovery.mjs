// Discovery-only oracle. No core-grader change and no state inferred from model answers or receipt prose.
import {isDeepStrictEqual as equal} from "node:util"
import {discoveryCases,DISCOVERY_VERSION} from "../../../packs/mem/discovery-plan.mjs"
import {memoryCall} from "../../run/guard/mem-targets.mjs"
const name=c=>c.ns==="mem"?c.tool:String(c.tool).replace(/^mem[._]/,"")
const plain=v=>Boolean(v&&typeof v==="object"&&!Array.isArray(v))
const family=c=>({wikis:"wiki",pages:"page"})[name(c)]??name(c)
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
  if(view.scope?.ns&&view.scope.ns!=="mem"||!view.guardLog?.some(r=>r.kind==="guard_start"&&r.case_id===id&&r.trial_id===p.trial_id))return fail("native guard/case/trial binding missing")
  if(!equal(p.before,s.seed)||!plain(p.state)||!equal(Object.keys(p.state).sort(),Object.keys(s.seed).sort())||!Array.isArray(p.requests)||!Array.isArray(p.turns)||p.turns.length!==1)return fail("canonical seed/state/turn missing or changed")
  const t=p.turns[0]
  if(t.index!==1||t.prompt!==s.prompt||typeof t.session!=="string"||!t.session||t.exit!==0||t.timedOut||!Array.isArray(t.calls))return fail("native turn contract differs")
  const native=t.calls.filter(c=>String(c.tool).startsWith("mem_")||String(c.tool).startsWith("mem.")),trace=view.calls.filter(c=>c.ns==="mem"||/^mem[._]/.test(c.tool))
  if(native.length!==trace.length||native.some((c,i)=>name(c)!==name(trace[i])||!equal(c.args,trace[i].args)))return fail("typed native calls disagree with trace")
  for(const c of native){if(!plain(c.args)||c.args_resolved===false)return fail("unresolved or malformed native invocation");const classified=memoryCall(`mem_${family(c)}`,c.args,{});if(classified?.error&&!bindingMatches(s,c)||!classified&&name(c)!=="recall"||name(c)!==family(c)&&classified?.write)return fail("unknown or malformed native action")}
  if(!native.some(c=>bindingMatches(s,c)&&c.status==="completed"&&c.args_resolved!==false))return fail("source-bound typed invocation absent or wrong action/arguments")
  const changes=native.filter(c=>["remember","page","commitments","wiki","spaces"].includes(name(c))&&((name(c)==="remember")||["write","append","replace","delete","move","add","update","create"].includes(c.args?.action)||c.args?.bind||c.args?.job?.op==="draft"))
  if(changes.some(c=>!s.write||name(c)!==s.binding.tool||!equal(c.args,s.binding.args)))return fail("unrequested mutation invocation")
  const request=p.requests.filter(r=>r.method===s.backend.method&&equal(r.input,s.backend.input)&&r.space==="personal"&&r.http_status===200&&r.context?.active===true&&r.context.case_id===id&&r.context.trial_id===p.trial_id&&r.context.turn===1&&r.context.session===t.session)
  if(request.length!==1)return fail("successful same-case/turn scoped backend observation missing")
  const r=request[0],out=r.output,a=p.state.personal,b=p.before.personal
  if(!plain(a)||!equal(p.state.shared,p.before.shared)||p.requests.some(r=>r.space!=="personal"||r.http_status!==200||r.status==="queued"||r.output?.partial||r.output?.metadata_only||r.output?.status==="queued"))return fail("wrong scope, partial, failed or unverified backend result")
  if(s.write&&r.status!=="stored")return fail("not durably stored")
  if(!s.write&&!equal(p.state,p.before))return fail("a read changed durable content")
  let proof=false,allowed=null
  if(["memory","page","commitment"].includes(s.family)){
    const expected=s.backend.input.record,record=a.records?.at(-1)
    proof=a.records.length===b.records.length+1&&equal(a.records.slice(0,-1),b.records)&&plain(record)&&Object.entries(expected).every(([k,v])=>equal(record[k],v))&&record.status==="current"&&record.version===1&&record.id===out.record?.id&&equal(record,out.record)&&!record.due&&!record.fields?.due&&!record.fields?.trigger
    allowed="records"
  }else if(s.family==="wiki-write"){proof=a.raw?.["design.md"]==="Quartz is synthetic."&&out.items?.some(i=>i.filename==="design.md"&&i.status==="written");allowed="raw"}
  else if(s.family==="wiki-read")proof=out.items?.length===1&&out.items[0].filename==="design.md"&&out.items[0].content===b.raw["design.md"]
  else if(s.family==="browse")proof=out.records?.length===1&&equal(out.records[0],b.records[0])&&out.more===true&&typeof out.cursor==="string"&&out.cursor.startsWith("discovery:personal:")
  else if(s.family==="exact-read")proof=out.records?.length===1&&equal(out.records[0],b.records[0])&&out.records[0].body==="Quartz full current body. Record nonce QREC-71."&&Array.isArray(out.missing)&&out.missing.length===0
  else if(s.family==="code")proof=out.nodes?.some(n=>n.id==="submitInvoice"&&n.nonce==="QCODE-37")&&out.edges?.some(e=>e.source==="submitInvoice"&&e.target==="parseInvoice"&&e.kind==="calls")
  else if(s.family==="wiki-graph")proof=out.nodes?.some(n=>n.id==="README.md")&&out.edges?.some(e=>e.source==="README.md"&&e.target==="design.md")&&out.communities?.some(c=>c.id==="quartz-docs"&&c.nonce==="QWIKI-64")
  else if(s.family==="skills")proof=out.items?.length===2&&equal(out.items,b.skills.map(({content,...summary})=>summary))&&out.items[0].version===1&&out.items[0].is_expired===true&&out.items[1].version===2&&out.items[1].is_expired===false
  else if(s.family==="sources"){proof=a.sourceRequests?.length===1&&a.sourceRequests[0].state==="requested"&&a.sourceRequests[0].source==="gmail"&&a.sourceRequests[0].account==="quartz-synthetic"&&equal(out.request,a.sourceRequests[0])&&a.bindings?.length===0;allowed="sourceRequests"}
  else if(s.family==="jobs"){const j=a.jobs?.[0];proof=a.jobs?.length===1&&j.status==="draft"&&j.active===false&&j.next_due===null&&j.template==="slack-threads-project"&&j.project==="quartz"&&j.account==="quartz-synthetic"&&equal(j,out.job)&&out.draft?.state==="draft";allowed="jobs"}
  if(!proof)return fail("canonical body/topology/version/request/draft truth not proven")
  if(s.write&&s.family!=="wiki-write"){
    const created=s.family==="sources"?a.sourceRequests[0]:s.family==="jobs"?a.jobs[0]:a.records.at(-1)
    if(typeof created.id!=="string"||!p.creators?.some(c=>c.id===created.id&&c.case_id===id&&c.trial_id===p.trial_id&&c.turn===1&&c.session===t.session&&name(c)===s.binding.tool&&equal(c.args,s.binding.args)&&c.status==="stored"))return fail("backend-owned creation identity is unlinked")
  }
  if(s.write){const before=structuredClone(b),after=structuredClone(a);delete before[allowed];delete after[allowed];if(!equal(before,after))return fail("unrelated durable family changed")}
  if(typeof t.text!=="string")return fail("answer missing")
  const answer=t.text.trim(),lower=answer.toLowerCase()
  const truthful=s.legacy_answer_contract?answer===s.answer:s.family==="exact-read"?answer.includes("Quartz full current body. Record nonce QREC-71.")&&!/\b(?:not|missing|unsupported|partial)\b/i.test(answer):s.family==="code"?answer.includes("submitInvoice")&&answer.includes("parseInvoice")&&!/\b(?:not|unknown|unsupported|partial)\b/i.test(answer):s.family==="wiki-graph"?["README.md","design.md","quartz-docs"].every(v=>answer.includes(v))&&!/unknown|unsupported|partial/i.test(answer):s.family==="skills"?/\b1\b[\s\S]*expired[\s\S]*\b2\b[\s\S]*current/i.test(answer):["sources","jobs"].includes(s.family)?answer===s.answer:false
  if(!truthful)return fail("answer differs from the literal verified outcome")
  return {state:"ok",detail:`${id}: scoped durable discovery contract agrees (offline-capable, not runtime approval)`}
}
