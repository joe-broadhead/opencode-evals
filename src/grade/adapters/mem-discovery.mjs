// Discovery-only oracle. Missing fragments never suppress independently settled contradictions.
import {isDeepStrictEqual as equal} from "node:util"
import {discoveryCases,DISCOVERY_VERSION} from "../../../packs/mem/discovery-plan.mjs"
import {memoryCall} from "../../run/guard/mem-targets.mjs"
import {sha256} from "../../util/canonical.mjs"
import {reconcileMemoryRecording} from "./mem-recording.mjs"
import {parseFirstJson} from "../../trace/resultCounts.mjs"

const name=c=>c.ns==="mem"?c.tool:String(c.tool).replace(/^mem[._]/,"")
const plain=v=>Boolean(v&&typeof v==="object"&&!Array.isArray(v))
const family=c=>({wikis:"wiki",pages:"page"})[name(c)]??name(c)
const memory=c=>c?.ns==="mem"||/^mem[._]/.test(c?.tool)
const writes=new Set(["records.put","wiki.raw.write","sources.request","plugins.request","jobs.draft"])
const recallKeys=new Set(["query","task","visibility","in","types","status","limit","space","filter","cursor"])
const failedStatuses=new Set(["queued","pending","denied","unsupported","error","failed","failure","rejected"])
const outputStatus=method=>["wiki.get","wiki.ingest","code-graph.get","code-graph.status"].includes(method)?"ready":writes.has(method)?"stored":"read"
function failedEnvelope(v){
  if(!v||typeof v!=="object")return false
  if(Array.isArray(v))return v.some(failedEnvelope)
  return Object.hasOwn(v,"error")||Object.hasOwn(v,"errors")||failedStatuses.has(v.status)||v.success===false||v.ok===false||v.partial===true||v.metadata_only===true||Object.hasOwn(v,"code")&&v.code!==0||Object.values(v).some(failedEnvelope)
}
function bindingMatches(s,c){
  if((s.write?name(c):family(c))!==s.binding.tool||!plain(c.args))return false
  const args=structuredClone(c.args)
  if(!s.write){if(args.space!==undefined&&!["personal","eval-space-personal","spc-eval-personal"].includes(args.space))return false;delete args.space;if(s.family==="skills"&&args.skill?.offset===0)delete args.skill.offset;if(["wiki-read","wiki-graph"].includes(s.family)&&args.wiki_id===undefined)args.wiki_id=s.backend.input.wiki_id}
  return equal(args,s.binding.args)
}
function truthfulAnswer(s,text){
  const answer=text.trim()
  return s.legacy_answer_contract?answer===s.answer:s.family==="exact-read"?answer.includes("Quartz full current body. Record nonce QREC-71.")&&!/\b(?:not|missing|unsupported|partial)\b/i.test(answer):s.family==="code"?answer.includes("submitInvoice")&&answer.includes("parseInvoice")&&!/\b(?:not|unknown|unsupported|partial)\b/i.test(answer):s.family==="wiki-graph"?["README.md","design.md","quartz-docs"].every(v=>answer.includes(v))&&!/unknown|unsupported|partial/i.test(answer):s.family==="skills"?/\b1\b[\s\S]*expired[\s\S]*\b2\b[\s\S]*current/i.test(answer):["sources","jobs"].includes(s.family)?answer===s.answer:false
}

// records.put admits only these observed producer metadata fields, for every write row.
// The same closed payload is used to check the resulting stored object.
function recordPayload(s,wire,session,q){
  const record=q.typed(wire?.record,"backend wire record",plain)
  if(!record)return
  const expected=s.backend.input.record,metadata={}
  if(Object.hasOwn(record,"type")&&!Object.hasOwn(expected,"type"))metadata.type=expected.kind
  if(Object.hasOwn(record,"title"))metadata.title=expected.body.slice(0,200)
  if(Object.hasOwn(record,"stated_by")&&["agent","person"].includes(record.stated_by))metadata.stated_by=record.stated_by
  if(Object.hasOwn(record,"source")){
    const source=q.typed(record.source,"record source metadata",plain)
    if(source){
      if(!equal(Object.keys(source),["session"])||typeof source.session!=="string")q.fail("record source metadata malformed")
      q.check("record source session differs",[[source.session,"record source session"],[session,"native session artifact"]],()=>source.session===session)
      metadata.source=source
    }
  }
  if(Object.hasOwn(record,"fields")&&s.family==="commitment")metadata.fields={what:expected.body,owner:"user",state:"open"}
  const payload={...expected,...metadata}
  if(!Object.keys(wire).every(k=>["record","upsert_path"].includes(k))||wire.upsert_path!==undefined&&!(s.family==="page"&&wire.upsert_path===true)||!equal(record,payload))q.fail("record wire payload differs from authorized content")
  return payload
}

// Compare only supplied overlapping facts. An absent copy/field stays unavailable, never filled.
function copies(left,right,q){
  if(left===null&&right===null)return
  if(left==null||right==null){q.missing("overlapping capture artifact");return}
  if(Array.isArray(left)&&Array.isArray(right)){
    if(left.length!==right.length)q.fail("capture copies contradict each other")
    for(let i=0;i<Math.min(left.length,right.length);i++)copies(left[i],right[i],q)
  }else if(plain(left)&&plain(right)){
    for(const k of new Set([...Object.keys(left),...Object.keys(right)]))copies(left[k],right[k],q)
  }else if(!equal(left,right))q.fail("capture copies contradict each other")
}

// Each predicate declares its fragments. Only the final reduction chooses FAIL > BLOCKED > PASS.
function checks(id){
  const failures=new Set(),missing=new Set()
  const need=(value,label)=>{if(value==null){missing.add(label);return false}return true}
  const check=(label,values,predicate)=>{if(values.every(([v,key])=>need(v,key))&&!predicate())failures.add(label)}
  const typed=(value,label,test)=>{if(!need(value,label))return undefined;if(!test(value)){failures.add(`${label} malformed`);return undefined}return value}
  const version=(value,expected,label,pattern)=>{if(!need(value,label))return false;if(value===expected)return true;if(typeof value==="string"&&pattern.test(value))missing.add(label);else failures.add(`${label} malformed`);return false}
  return {need,check,typed,version,fail:label=>failures.add(label),missing:label=>missing.add(label),finish(){return failures.size?{state:"fail",detail:`discovery ${id}: ${[...failures][0]}`} :missing.size?{state:"unverifiable",detail:`discovery ${id}: unavailable ${[...missing].slice(0,3).join(", ")}`} :{state:"ok",detail:`${id}: scoped durable discovery contract agrees (offline-capable, not runtime approval)`}}}
}

export function memoryDiscoveryEvidence(id,view){
  const q=checks(id),s=discoveryCases.find(s=>s.id===id)
  if(!s){q.missing("case contract");return q.finish()}
  const object=(v,label)=>q.typed(v,label,plain),list=(v,label)=>q.typed(v,label,Array.isArray)
  const field=(v,label,type)=>q.typed(v,label,x=>typeof x===type)
  const invocations=(calls,actual=false,complete=true)=>{
    if(!calls)return
    for(const c of calls){
      if(!plain(c)){q.fail("native calls malformed");continue}
      const args=object(c.args,actual?"actual typed arguments":"private argument artifact"),status=field(c.status,actual?"actual invocation status":"native call status","string")
      if(c.args_resolved===false)q.fail("explicitly unresolved native invocation")
      if(status==="unattributable")q.missing("attributable native invocation outcome")
      else if(status!==undefined&&status!=="completed")q.fail("failed native invocation")
      const output=field(c.output,actual?"actual call output":"native call output","string")
      if(output!==undefined){try{if(failedEnvelope(JSON.parse(output)))q.fail("error-bearing native output")}catch{/* Prose supplies no backend truth. */}}
      const tool=field(c.tool,"native invocation tool","string")
      if(args&&tool!==undefined){
        if(name(c)==="recall"&&Object.keys(args).some(k=>!recallKeys.has(k)))q.fail("unknown recall argument")
        const classified=memoryCall(`mem_${family(c)}`,args,{})
        if(classified?.error&&!bindingMatches(s,c)||!classified&&name(c)!=="recall"||name(c)!==family(c)&&classified?.write)q.fail("unknown or malformed native action")
        const change=name(c)==="remember"||["page","commitments","wiki","spaces"].includes(name(c))&&(["write","append","replace","delete","move","add","update","create"].includes(args.action)||args.bind||args.job?.op==="draft")
        if(change&&(!s.write||name(c)!==s.binding.tool||!equal(args,s.binding.args)))q.fail("unrequested mutation invocation")
      }
      if(actual&&c.attributable!==true)q.missing("executed inner-call attribution")
    }
    if(complete&&calls.every(c=>plain(c?.args)&&c.status!=null&&c.status!=="unattributable"&&(!actual||c.attributable===true))&&!calls.some(c=>bindingMatches(s,c)&&c.status==="completed"))q.fail("recorded execution omitted the required typed invocation")
  }
  const answer=field(view.answer?.text,"official recording text","string")
  q.check("actual answer differs from the literal outcome",[[answer,"official recording text"]],()=>truthfulAnswer(s,answer))
  let capture=view.state?.mem?.capture
  if(capture==null){
    q.missing("state adapter result")
    const files=list(view.files,"file recording")
    if(files){
      if(files.some(f=>!plain(f)))q.fail("file recording malformed")
      const candidates=files.filter(f=>f?.path==="mem-fixture/capture.json"&&f.change!=="deleted")
      if(candidates.length>1)q.fail("conflicting authoritative captures")
      else if(candidates.length===1){const text=field(candidates[0].text,"authoritative capture text","string");if(text!==undefined)try{capture=JSON.parse(text)}catch{q.fail("authoritative capture JSON malformed")}}
      else q.missing("authoritative capture")
    }
  }
  capture=object(capture,"authoritative capture")
  let p
  if(capture){
    q.check("authoritative capture is foreign",[[capture.fixture,"capture identity"]],()=>capture.fixture==="mem-synthetic-v1")
    const supported=q.version(capture.schema,"oc-mem-capture/1","capture schema version",/^oc-mem-capture\/\d+$/)
    list(capture.requests,"capture backend recording")
    for(const key of ["before","after"]){const states=object(capture[key],`capture ${key} artifact`);if(states)for(const state of Object.values(states))if(!plain(state)||!Array.isArray(state.records)||!plain(state.raw)||Object.values(state.raw).some(v=>typeof v!=="string"))q.fail("capture state malformed")}
    if(supported)p=object(capture.discovery,"discovery capture")
  }
  if(p){
    q.check("foreign case identity",[[p.case_id,"case identity"]],()=>p.case_id===id)
    field(p.trial_id,"trial identity","string");if(p.trial_id==="")q.fail("trial identity malformed")
    const supported=q.version(p.schema,"oc-mem-discovery-proof/1","discovery schema version",/^oc-mem-discovery-proof\/\d+$/)&&q.version(p.suite,DISCOVERY_VERSION,"suite version",/^mem-discovery\/\d+$/)
    if(!supported)p=undefined
  }
  if(view.memoryRecording?.journal_scope)q.check("native journal semantic trial contradicts capture",[[view.memoryRecording.journal_scope.trial_id,"native journal trial"],[p?.trial_id,"trial identity"]],()=>view.memoryRecording.journal_scope.trial_id===p.trial_id)
  if(view.scope?.ns&&view.scope.ns!=="mem")q.fail("foreign native scope")
  const guard=list(view.guardLog,"guard recording")
  if(guard&&guard.some(r=>!plain(r)))q.fail("guard recording malformed")
  if(p){
    const permission=object(p.permission,"permission recording")
    if(permission)q.check("successful fake permission condition contradicted",[[permission.effect,"permission condition"]],()=>["allow","ask-approved"].includes(permission.effect))
    q.check("native guard/case/trial binding differs",[[guard,"guard recording"],[p.trial_id,"trial identity"]],()=>guard.some(r=>r?.kind==="guard_start"&&r.case_id===id&&r.trial_id===p.trial_id))
  }
  const before=p&&object(p.before,"seed artifact"),state=p&&object(p.state,"poststate artifact")
  const outerBefore=capture&&object(capture.before,"capture before artifact"),outerState=capture&&object(capture.after,"capture after artifact")
  const shape=states=>equal(Object.keys(states).sort(),Object.keys(s.seed).sort())&&Object.entries(s.seed).every(([scope,seed])=>plain(states[scope])&&equal(Object.keys(states[scope]).sort(),Object.keys(seed).sort())&&Object.entries(seed).every(([k,v])=>Array.isArray(v)?Array.isArray(states[scope][k]):plain(states[scope][k])))
  for(const [before,state] of [[outerBefore,outerState]]){
    if(before){if(!shape(before))q.fail("capture seed malformed");if(!equal(before,s.seed))q.fail("capture seed changed")}
    if(state&&!shape(state))q.fail("capture poststate malformed")
    q.check("outer unexpected shared durable effect",[[before,"capture before artifact"],[state,"capture after artifact"]],()=>equal(before.shared,state.shared))
    if(!s.write)q.check("outer read changed durable content",[[before,"capture before artifact"],[state,"capture after artifact"]],()=>equal(before,state))
  }
  if(before){if(!shape(before))q.fail("canonical seed malformed");q.check("canonical seed changed",[[before,"seed artifact"]],()=>equal(before,s.seed))}
  if(state&&!shape(state))q.fail("canonical poststate malformed")
  q.check("unexpected shared durable effect",[[before,"seed artifact"],[state,"poststate artifact"]],()=>equal(before.shared,state.shared))
  if(!s.write)q.check("a read changed durable content",[[before,"seed artifact"],[state,"poststate artifact"]],()=>equal(before,state))
  if(capture&&p){
    copies(capture.before,p.before,q);copies(capture.after,p.state,q);copies(capture.requests,p.requests,q)
  }
  const turns=p&&list(p.turns,"native recording")
  if(turns&&turns.length!==1)q.fail("native recording omitted or replayed the turn")
  const t=turns?.length===1?object(turns[0],"native turn"):undefined
  if(t){
    for(const [key,expected]of [["index",1],["prompt",s.prompt],["exit",0],["timedOut",false]])q.check("native turn contract differs",[[t[key],`native ${key} artifact`]],()=>t[key]===expected)
    const session=field(t.session,"native session artifact","string");if(session==="")q.fail("native session malformed")
    const text=field(t.text,"native answer artifact","string")
    q.check("native answer differs from the literal outcome",[[text,"native answer artifact"]],()=>truthfulAnswer(s,text))
    q.check("actual answer contradicts private proof",[[answer,"official recording text"],[text,"native answer artifact"]],()=>answer.trim()===text.trim())
  }
  const calls=t&&list(t.calls,"native call recording"),native=calls?.filter(memory),trace=view.calls.filter(memory)
  if(calls&&calls.some(c=>!plain(c)||typeof c.tool!=="string"))q.fail("native calls malformed")
  const directOnly=!view.calls.some(c=>c.tool==="execute")
  invocations(native,false,directOnly||view.memoryRecording?.execution_complete===true)
  const actualCalls=view.memoryRecording?.schema==="oc-mem-private-recording/1"&&Array.isArray(view.memoryRecording.calls)?view.memoryRecording.calls:undefined
  invocations(actualCalls,true,view.memoryRecording?.execution_complete===true)
  if(Array.isArray(view.memoryRecording?.unjoined_calls))invocations(view.memoryRecording.unjoined_calls,true,false)
  if(Array.isArray(view.memoryRecording?.direct_calls))invocations(view.memoryRecording.direct_calls,true,false)
  if(native){
    if(directOnly&&(native.length!==trace.length||native.some((c,i)=>name(c)!==name(trace[i]))))q.fail("typed native calls disagree with trace")
    for(const [i,c]of native.entries()){
      if(!directOnly)continue // Code Mode source sites carry no executed-call count or argument authority.
      if(trace[i]?.status==="error")q.fail("official trace records a failed invocation")
      // The public codec defaults missing raw input to {}. That digest is not typed evidence.
      const direct=view.memoryRecording?.direct_calls?.[i]
      if(direct&&direct.args==null){q.missing("actual typed arguments");continue}
      const args=plain(c.args)?c.args:undefined
      const digest=trace[i]?.args_sha256
      q.check("official trace argument digest malformed",[[digest,"official trace argument digest"]],()=>typeof digest==="string"&&/^[a-f0-9]{64}$/.test(digest))
      if(typeof digest==="string"&&/^[a-f0-9]{64}$/.test(digest))q.check("private arguments contradict official digest",[[args,"private argument artifact"]],()=>sha256(JSON.stringify(args))===digest)
    }
  }
  const requests=p&&list(p.requests,"backend recording"),outerRequests=capture&&list(capture.requests,"capture backend recording")
  for(const observations of [requests,outerRequests]){
  const rows=observations?.filter(plain)
  const actualWrites=actualCalls?.filter(c=>bindingMatches(s,c)&&c.status==="completed"&&c.attributable===true),usedWrites=new Set()
  if(observations&&rows.length!==observations.length)q.fail("backend observation malformed")
  for(const r of rows??[]){
    for(const key of ["method","space","input","wire_input","output","status","http_status","context"])q.need(r[key],`backend ${key} artifact`)
    if(r.verb!=null&&r.verb!=="POST")q.fail("backend verb contradicts operation")
    if(r.http_status!=null&&r.http_status!==200||r.space!=null&&r.space!=="personal"||r.status!=null&&(r.method==null?!["read","stored"].includes(r.status):r.status!==(writes.has(r.method)?"stored":"read")))q.fail("failed or foreign backend observation")
    const input=object(r.input,"backend input artifact"),wire=object(r.wire_input,"backend wire_input artifact"),out=object(r.output,"backend output artifact"),context=object(r.context,"backend context artifact")
    if(out&&(failedEnvelope(out)||r.method!=null&&out.status!=null&&out.status!==outputStatus(r.method)))q.fail("error-bearing or conflicting backend output")
    if(r.method!=="records.put")q.check("wire input contradicts canonical input",[[input,"backend input artifact"],[wire,"backend wire_input artifact"]],()=>equal(input,wire))
    if(context){
      for(const key of ["active","case_id","trial_id","turn","session"])q.need(context[key],`backend context ${key}`)
      if(context.active!=null&&context.active!==true||context.case_id!=null&&context.case_id!==id||context.turn!=null&&context.turn!==1)q.fail("backend native lifetime differs")
      q.check("backend trial differs",[[context.trial_id,"backend context trial_id"],[p?.trial_id,"trial identity"]],()=>context.trial_id===p.trial_id)
      q.check("backend session differs",[[context.session,"backend context session"],[t?.session,"native session artifact"]],()=>context.session===t.session)
      q.check("backend session contradicts actual recording",[[context.session,"backend context session"],[view.memoryRecording?.text_session,"actual final session"]],()=>context.session===view.memoryRecording.text_session)
    }
    if(writes.has(r.method)){
      if(!s.write||r.method!==s.backend.method)q.fail("unrequested backend mutation")
      else{
        q.check("backend mutation payload is not authorized",[[input,"backend input artifact"]],()=>equal(input,s.backend.input))
        if(r.method==="records.put")recordPayload(s,wire,t?.session,q)
        else q.check("backend mutation wire payload is not authorized",[[wire,"backend wire_input artifact"]],()=>equal(wire,s.backend.input))
        if(view.memoryRecording?.execution_complete===true)q.check("backend write is not a distinct actual invocation",[[actualWrites,"actual invocation recording"],[out,"backend output artifact"],[context?.session,"backend context session"]],()=>{
          const i=actualWrites.findIndex((c,i)=>!usedWrites.has(i)&&c.session===context.session&&equal(parseFirstJson(c.output),out))
          if(i<0)return false
          usedWrites.add(i);return true
        })
      }
    }
  }
  if(s.write&&view.memoryRecording?.execution_complete===true&&actualWrites&&rows?.filter(r=>writes.has(r.method)).length>actualWrites.length)q.fail("backend write count exceeds actual invocation inventory")
  const matching=rows?.filter(r=>r.method===s.backend.method&&r.input!=null&&equal(r.input,s.backend.input))
  if(matching?.length>1||rows?.every(r=>r.method!=null&&r.input!=null)&&matching.length===0)q.fail("recorded execution omitted or replayed required backend operation")
  }
  const creators=p&&list(p.creators,"creator recording")
  const creatorCollections=[creators]
  if(capture?.creators!==undefined){const outerCreators=list(capture.creators,"outer creator recording");creatorCollections.push(outerCreators);copies(capture.creators,p?.creators,q)}
  for(const creators of creatorCollections){
  const creatorIds=new Set()
  for(const c of creators??[]){
    if(!plain(c)){q.fail("creator recording malformed");continue}
    if(Object.keys(c).some(k=>!["id","case_id","trial_id","turn","session","tool","args","status"].includes(k)))q.fail("creator has unrecognized fields")
    if(!s.write||s.family==="wiki-write")q.fail("unrequested creator observation")
    if(creatorIds.has(c.id))q.fail("duplicate creator identity");creatorIds.add(c.id)
    for(const key of ["id","case_id","trial_id","turn","session","tool","args","status"])q.need(c[key],`creator ${key} artifact`)
    if(c.id!=null&&typeof c.id!=="string"||c.case_id!=null&&c.case_id!==id||c.turn!=null&&c.turn!==1||c.tool!=null&&name(c)!==s.binding.tool||c.args!=null&&!equal(c.args,s.binding.args)||c.status!=null&&c.status!=="stored")q.fail("creator contradicts the sealed operation")
    q.check("creator trial differs",[[c.trial_id,"creator trial artifact"],[p?.trial_id,"trial identity"]],()=>c.trial_id===p.trial_id)
    q.check("creator session differs",[[c.session,"creator session artifact"],[t?.session,"native session artifact"]],()=>c.session===t.session)
    q.check("creator session contradicts actual recording",[[c.session,"creator session artifact"],[view.memoryRecording?.text_session,"actual final session"]],()=>c.session===view.memoryRecording.text_session)
    if(view.memoryRecording?.execution_complete===true)q.check("creator is not an actual completed creation",[[actualCalls,"actual invocation recording"]],()=>actualCalls.some(a=>{
      const output=parseFirstJson(a.output)
      return a.attributable===true&&name(a)===name(c)&&equal(a.args,c.args)&&a.session===c.session&&a.status==="completed"&&(output?.record?.id===c.id||output?.request?.id===c.id||output?.job?.id===c.id)
    }))
  }
  }
  const allowed=s.family==="wiki-write"?"raw":s.family==="sources"?"sourceRequests":s.family==="jobs"?"jobs":"records"
  for(const [seed,post,observations] of [[before,state,requests],[outerBefore,outerState,outerRequests]]){
  const b=seed&&shape(seed)?seed.personal:undefined,a=post&&shape(post)?post.personal:undefined
  const matching=observations?.filter(r=>plain(r)&&r.method===s.backend.method&&equal(r.input,s.backend.input)),r=matching?.length===1?matching[0]:undefined,out=r&&plain(r.output)?r.output:undefined
  if(view.memoryRecording?.execution_complete===true)q.check("backend output contradicts actual invocation",[[actualCalls,"actual invocation recording"],[out,"backend output artifact"]],()=>actualCalls.some(c=>bindingMatches(s,c)&&c.status==="completed"&&equal(parseFirstJson(c.output),out)))
  for(const c of creatorCollections.flatMap(c=>c??[])){
    if(!plain(c))continue
    q.check("creator identity already existed",[[b,"seed artifact"]],()=>!(b[allowed]??[]).some?.(v=>v?.id===c.id))
    q.check("creator identity is orphaned",[[a,"poststate artifact"]],()=>Array.isArray(a[allowed])&&a[allowed].filter(v=>v?.id===c.id).length===1)
    q.check("creator is not a backend creation",[[out,"backend output artifact"]],()=>out.created===true&&out.record?.id===c.id||out.request?.id===c.id||out.job?.id===c.id)
  }
  if(s.write){
    q.check("unrelated personal durable family changed",[[a,"poststate artifact"],[b,"seed artifact"]],()=>Object.keys(b).every(k=>k===allowed||equal(a[k],b[k])))
    if(s.family==="wiki-write"){
      q.check("wiki poststate contains unauthorized content",[[a,"poststate artifact"],[b,"seed artifact"]],()=>{const expected=structuredClone(b.raw);for(const file of s.backend.input.files)expected[file.filename]=file.content;return equal(a.raw,expected)})
      q.check("wiki output differs",[[out,"backend output artifact"]],()=>equal(out.items,s.backend.input.files.map(f=>({filename:f.filename,status:"written"}))))
    }else{
      const created=a?.[allowed]?.at(-1)
      q.check("written family has extra or changed objects",[[a,"poststate artifact"],[b,"seed artifact"]],()=>a[allowed].length===b[allowed].length+1&&equal(a[allowed].slice(0,-1),b[allowed]))
      if(a&&!plain(created))q.fail("written object missing or malformed")
      if(plain(created)){
        let authorized
        if(["memory","page","commitment"].includes(s.family)){
          const expected=s.backend.input.record,wire=r&&plain(r.wire_input)?r.wire_input:undefined
          // Unknown stored fields fail even when the wire artifact is unavailable.
          if(Object.keys(created).some(k=>![...Object.keys(expected),"id","status","version","type","title","stated_by","source","fields"].includes(k)))q.fail("written record contains hidden payload")
          const payload=recordPayload(s,wire,t?.session,q)
          if(payload)authorized={...payload,id:created.id,status:"current",version:1}
        }else authorized={id:created.id,...s.backend.input,...(s.family==="sources"?{state:"requested"}:{status:"draft",active:false,next_due:null,version:1})}
        if(authorized){if(!equal(created,authorized))q.fail("written object is not the closed authorized payload");q.check("stored output contradicts actual object",[[out,"backend output artifact"]],()=>equal(out[s.family==="sources"?"request":s.family==="jobs"?"job":"record"],authorized)&&(s.family!=="jobs"||equal(out.draft,{version:1,state:"draft"})))}
        if(typeof created.id!=="string")q.fail("stored identity malformed")
        q.check("backend creation identity is unlinked",[[creators,"creator recording"],[t?.session,"native session artifact"],[p?.trial_id,"trial identity"]],()=>creators.some(c=>c?.id===created.id&&c.case_id===id&&c.trial_id===p.trial_id&&c.turn===1&&c.session===t.session&&name(c)===s.binding.tool&&equal(c.args,s.binding.args)&&c.status==="stored"))
      }
    }
  }else if(out){
    if(["wiki-read","browse","exact-read","skills"].includes(s.family))q.need(b,"seed artifact")
    if(b){
      if(s.family==="wiki-read"&&!(Array.isArray(out.items)&&out.items.length===1&&out.items[0]?.filename==="design.md"&&out.items[0]?.content===b.raw["design.md"]))q.fail("canonical source body not proven")
      if(s.family==="browse"&&!(out.records?.length===1&&equal(out.records[0],b.records[0])&&out.more===true&&typeof out.cursor==="string"&&out.cursor.startsWith("discovery:personal:")))q.fail("canonical sample not proven")
      if(s.family==="exact-read"&&!(out.records?.length===1&&equal(out.records[0],b.records[0])&&out.records[0].body==="Quartz full current body. Record nonce QREC-71."&&Array.isArray(out.missing)&&out.missing.length===0))q.fail("canonical full current body not proven")
      if(s.family==="skills"&&!(out.items?.length===2&&equal(out.items,b.skills.map(({content,...summary})=>summary))&&out.items[0].version===1&&out.items[0].is_expired===true&&out.items[1].version===2&&out.items[1].is_expired===false))q.fail("canonical version history not proven")
    }
    if(s.family==="code"&&!(Array.isArray(out.nodes)&&out.nodes.some(n=>n?.id==="submitInvoice"&&n?.nonce==="QCODE-37")&&Array.isArray(out.edges)&&out.edges.some(e=>e?.source==="submitInvoice"&&e?.target==="parseInvoice"&&e?.kind==="calls")))q.fail("canonical code topology not proven")
    if(s.family==="wiki-graph"&&!(Array.isArray(out.nodes)&&out.nodes.some(n=>n?.id==="README.md")&&Array.isArray(out.edges)&&out.edges.some(e=>e?.source==="README.md"&&e?.target==="design.md")&&Array.isArray(out.communities)&&out.communities.some(c=>c?.id==="quartz-docs"&&c?.nonce==="QWIKI-64")))q.fail("canonical document topology not proven")
  }
  }
  reconcileMemoryRecording(id,view.memoryRecording,view,t,native,q)
  return q.finish()
}
