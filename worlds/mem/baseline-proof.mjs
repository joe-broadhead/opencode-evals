// Pure observation recorder used by the contained emitter. Never fills an observed body from a case/answer.
import {createHash} from "node:crypto"
import {isDeepStrictEqual} from "node:util"
import {coreWikiIntentPayloadMatches} from "../../src/run/mem-intent-plan.mjs"
const digest=s=>createHash("sha256").update(s).digest("hex")
const wiki=(s,id)=>(s.knowledge??[]).find(w=>w.knowledge_id===id)
const ok=r=>r.status>=200&&r.status<300&&!r.json?.error&&!r.json?.code
const scope=w=>w.team_id==="local"||w.team_id==="eval-container-personal"?"personal":w.team_id==="eval-container-shared"?"shared":w.team_id

export function createBaselineProof(initial,control,intent) {
  const operations=[],creators=[],versions=new Map()
  const versionKey=(id,file)=>`${id}:${file}`
  for(const w of initial.knowledge??[])for(const [file,body]of Object.entries(w.raw??{}))if(typeof body==="string")versions.set(versionKey(w.knowledge_id,file),{digest:digest(body),revision:0})
  const state=(raw,control)=>{
    const copy=structuredClone(raw)
    copy.control=structuredClone(control)
    for(const w of copy.knowledge??[]) {
      w.space=scope(w)
      w.raw_versions=Object.fromEntries(Object.entries(w.raw??{}).map(([file,body])=>{
        const observed=versions.get(versionKey(w.knowledge_id,file))
        // An unobserved mutation has no linked revision and therefore cannot satisfy the oracle.
        return [file,observed?.digest===digest(String(body))?{...observed}:null]
      }))
    }
    return copy
  }
  const before=state(initial,control)
  const bound=(event)=>{
    const {context:c,invocation:v,request_session:s}=event
    const family=event.path.startsWith("/v3/wiki/")?"wiki":event.path==="/records/v1/records.put"?"remember":null
    if(c?.schema==="oc-mem-native-activation/1"||v?.schema==="oc-mem-native-receipt/1"){
      const nonempty=x=>typeof x==="string"&&x.length>0
      if(c?.schema!=="oc-mem-native-activation/1"||v?.schema!=="oc-mem-native-receipt/1"||!Number.isSafeInteger(c.trial)||c.trial<1||!Number.isSafeInteger(c.incarnation)||c.incarnation<1||!["activation_id","generation"].every(k=>nonempty(c[k]))||!["activation_id","incarnation","trial","generation"].every(k=>v[k]===c[k])||!nonempty(v.invocation_id)||v.native?.sessionID!==s||v.native?.id!==v.call_id||!nonempty(v.native?.messageID)||v.expires_at!==intent?.expires_at||!(v.expires_at>Date.now()))return false
      const mutation=["/v3/wiki/create","/v3/wiki/raw/write","/records/v1/records.put"].includes(event.path)
      if(mutation&&(!nonempty(v.operation_id)||!nonempty(v.reservation_id)||v.grant_id!==JSON.stringify([c.case_id,c.trial_id,c.turn,v.operation_id])))return false
    }
    return Boolean(intent&&intent.expires_at>Date.now()&&c?.active===true&&c.case_id===intent.case_id&&c.trial_id===intent.trial_id&&intent.turns.some(t=>t.index===c.turn)&&typeof s==="string"&&s&&s===c.session&&v?.pass===true&&v.active===true&&v.case_id===c.case_id&&v.trial_id===c.trial_id&&v.turn===c.turn&&v.session===s&&v.family===family&&typeof v.call_id==="string"&&v.call_id)
  }
  function creator(event,id,family) {
    const {context:c,invocation:v}=event
    if(!bound(event)||v.family!==family||typeof id!=="string")return
    const requested=intent.turns.find(t=>t.index===c.turn)?.calls.find(x=>x.creates&&x.family===family&&(isDeepStrictEqual(x.args,v.args)||(intent.case_id==="core-wiki-write"&&family==="wiki"&&coreWikiIntentPayloadMatches(x.args,v.args))))
    if(!requested||creators.some(x=>x.alias===requested.creates))return
    const reservation=v.schema==="oc-mem-native-receipt/1"?{schema:"oc-mem-native-creator/1",trial:v.trial,activation_id:v.activation_id,incarnation:v.incarnation,generation:v.generation,invocation_id:v.invocation_id,occurrence:v.occurrence,operation_id:v.operation_id,grant_id:v.grant_id,reservation_id:v.reservation_id}:{}
    creators.push({alias:requested.creates,id,family,args:structuredClone(v.args),case_id:intent.case_id,trial_id:intent.trial_id,turn:c.turn,session:c.session,call_id:v.call_id,status:"stored",...reservation})
  }
  function observe(event) {
    const {path,input,response,before,after,space,context}=event,payload=response.json?.data??response.json
    const valid=bound(event)
    const base={turn:valid?context.turn:null,session:event.request_session??null,request_session:event.request_session??null,binding:valid?"bound":"unbound",case_id:valid?context.case_id:null,trial_id:valid?context.trial_id:null,call_id:valid?event.invocation.call_id:null,space}
    if(path==="/v3/wiki/create") {
      const id=payload?.wiki_id??payload?.knowledge_id,w=wiki(after,id)
      const stored=ok(response)&&!wiki(before,id)&&w?.name===input.name&&scope(w)===space
      operations.push({...base,operation:"wiki.create",wiki_id:id??null,name:input.name,status:stored?"stored":ok(response)?"partial":"denied"})
      if(stored&&event.invocation?.args.name===input.name)creator(event,id,"wiki")
    } else if(path==="/v3/wiki/raw/write") {
      for(const f of input.files??[]) {
        const old=wiki(before,input.wiki_id)?.raw?.[f.filename],body=wiki(after,input.wiki_id)?.raw?.[f.filename]
        const prior=versions.get(versionKey(input.wiki_id,f.filename))
        const stored=ok(response)&&typeof body==="string"&&body===f.content&&body!==old&&(payload?.items??[]).some(i=>i.filename===f.filename&&i.status==="written")
        const version=stored?{digest:digest(body),revision:(prior?.revision??0)+1}:prior
        if(stored)versions.set(versionKey(input.wiki_id,f.filename),version)
        operations.push({...base,operation:"wiki.raw.write",wiki_id:input.wiki_id,filename:f.filename,status:stored?"stored":ok(response)?"partial":"denied",before_version:typeof old==="string"?digest(old):null,...(typeof old==="string"?{before_body:old}:{}),...(stored?{body,version:version.digest,revision:version.revision}:{})})
      }
    } else if(["/v3/wiki/raw/read","/v3/wiki/page/read"].includes(path)) {
      const items=path.endsWith("raw/read")?payload?.items:[{filename:input.path??input.ref,content:payload?.content}]
      for(const item of items??[]) {
        const observed=versions.get(versionKey(input.wiki_id,item.filename))
        const body=wiki(after,input.wiki_id)?.raw?.[item.filename]
        const read=ok(response)&&typeof body==="string"&&body===item.content&&observed?.digest===digest(body)
        operations.push({...base,operation:path.endsWith("raw/read")?"wiki.raw.read":"wiki.page.read",wiki_id:input.wiki_id,filename:item.filename,status:read?"read":"unverifiable",...(read?{body,version:observed.digest,revision:observed.revision}:{})})
      }
    } else if(path==="/records/v1/records.put") {
      const r=payload?.record
      if(ok(response)&&r?.id&&space==="personal"&&!(before.records??[]).some(x=>x.id===r.id)&&(after.records??[]).some(x=>x.id===r.id&&x.kind==="memory"&&x.body===input.record?.body&&["local","eval-space-personal"].includes(x.space_id))&&event.invocation?.args.content===input.record?.body&&event.invocation?.args.kind===input.record?.type)creator(event,r.id,"remember")
    }
  }
  return {before,state,observe,operations,creators}
}
