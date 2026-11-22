// Opt-in controlled setup facade. No host runtime, transform registration, or transport installation.
import {AsyncLocalStorage} from "node:async_hooks"
import {randomUUID} from "node:crypto"
import {isDeepStrictEqual as equal} from "node:util"

export const ASSERTION_METADATA_KEY="oc_mem_assertion_v1"
const controlled=action=>/^(?:mem[._](?:recall|remember|revise|page|wiki|commitments|spaces|read|code)|memory\.(?:revise|forget)|(?:page|wiki)\.(?:write|delete))$/.test(action)
const failure=()=>new Error("Memory assertion bridge: missing, stale or invalid execution")

export async function createMemoryAssertionBridge({authority,context}) {
  const permission=context?.permission
  if(![permission?.assert,permission?.hook,permission?.list,permission?.get,permission?.reply,context?.event?.subscribe].every(f=>typeof f==="function"))throw new Error("Memory assertion bridge: public host seams required")
  const local=new AsyncLocalStorage(),owned=new WeakSet(),tokens=new Map(),requests=new Map(),tasks=new Set(),nativeWork=new Set(),facts=[]
  let closing=false,closed=false,partial=false
  const note=reason=>{partial=true;facts.push({kind:"partial",reason})}
  const fault=reason=>{note(reason);authority.cancel()}
  const watch=promise=>{
    const safe=Promise.resolve(promise).catch(()=>{note("host operation failed; cleanup unproven")}).finally(()=>tasks.delete(safe))
    tasks.add(safe);return safe
  }
  const current=()=>{
    const store=local.getStore()
    if(closing||!store||!owned.has(store)||store.ended||store.signal?.aborted)throw failure()
    return store
  }
  const assert=async input=>{
    // Capture ALS synchronously, before any Promise/Effect boundary.
    const store=current()
    if(!store.execution.receipt()){store.execution.cancel();throw failure()}
    if(ASSERTION_METADATA_KEY in Object(input?.metadata)){store.execution.cancel();throw new Error("Memory assertion bridge: reserved metadata key")}
    const token=randomUUID(),request={...input,metadata:{...input.metadata,[ASSERTION_METADATA_KEY]:token}}
    const assertion=store.execution.beginAssertion(request)
    const record={assertion,store,request:structuredClone(request),replyStarted:false,cleanups:new Set(),recovered:false}
    tokens.set(token,record);store.records.add(record)
    const work=assertion.run(()=>permission.assert(request))
    nativeWork.add(work)
    try{return await work}finally{nativeWork.delete(work)}
  }
  const evaluate=event=>{
    const token=event.metadata?.[ASSERTION_METADATA_KEY],record=tokens.get(token)
    if(!record){if(controlled(event.action)||token!==undefined){event.effect="deny";fault("unregistered assertion evaluation")}return}
    record.assertion.evaluate(event)
  }
  const cleanup=(record,request)=>{
    if(!record.assertion.matches(request)||record.cleanups.has(request.id))return
    record.cleanups.add(request.id)
    return watch(record.assertion.cleanup(request,async real=>{
      const actual=await permission.get({sessionID:real.sessionID,requestID:real.id})
      if(!equal(actual,real))throw new Error("pending cleanup snapshot changed")
      await permission.reply({sessionID:real.sessionID,requestID:real.id,decision:"reject"})
    }))
  }
  const asked=request=>{
    const token=request?.metadata?.[ASSERTION_METADATA_KEY],record=tokens.get(token)
    if(!record){if(controlled(request?.action)||token!==undefined)fault("unregistered pending ask");return}
    const key=JSON.stringify([request.sessionID,request.id]),owner=requests.get(key)
    if(owner&&owner!==record){record.assertion.reject();owner.assertion.reject();fault("ambiguous native request");return}
    if(!record.assertion.bind(request)){
      record.assertion.reject();note("stale or mismatched pending ask")
      cleanup(record,request);if(record.pending)cleanup(record,record.pending)
      return
    }
    requests.set(key,record)
    record.pending=structuredClone(request)
    if(record.replyStarted)return
    record.replyStarted=true
    watch(record.assertion.reply(real=>permission.reply({sessionID:real.sessionID,requestID:real.id,decision:"once"})).then(decision=>{
      if(decision!=="once")cleanup(record,request)
    }))
  }
  const recoverRecords=async records=>{
    for(const sessionID of new Set(records.map(r=>r.request.sessionID))){
      let listed
      try{listed=await permission.list({sessionID});if(!Array.isArray(listed))throw Error("invalid list")}
      catch{for(const r of records.filter(r=>r.request.sessionID===sessionID))r.assertion.reject();note("pending list unavailable");continue}
      for(const record of records.filter(r=>r.request.sessionID===sessionID)){
        const token=record.request.metadata[ASSERTION_METADATA_KEY]
        const matches=listed.filter(r=>r.metadata?.[ASSERTION_METADATA_KEY]===token)
        if(matches.length!==1){
          record.assertion.reject();note("pending token missing or ambiguous")
          // At most two exact rejects. Larger ambiguity requires external containment.
          await Promise.all(matches.slice(0,2).map(r=>cleanup(record,r)))
          continue
        }
        try{
          const real=await permission.get({sessionID,requestID:matches[0].id})
          if(!equal(real,matches[0]))throw Error("pending recovery changed")
          asked(real)
        }catch{record.assertion.reject();note("pending get unavailable or changed")}
      }
    }
  }
  const recover=()=>{
    const records=[...tokens.values()].filter(r=>!r.recovered)
    for(const r of records)r.recovered=true // One list/get recovery attempt per registered token, never polling.
    const work=Promise.resolve().then(()=>recoverRecords(records))
    return watch(Promise.all(records.map(r=>r.assertion.recover(()=>work))))
  }
  const event=event=>{
    if(event.type==="permission.asked")asked(event.data) // Envelope ID is deliberately unused.
    if(event.type==="permission.replied"){
      const data=event.data,record=requests.get(JSON.stringify([data?.sessionID,data?.requestID]))
      if(record&&data.reply==="reject")record.assertion.reject()
      // Neither a replied event nor a hook observation closes the assertion barrier.
    }
  }
  const registration=await permission.hook("evaluate",evaluate)
  let iterator
  try{iterator=context.event.subscribe({types:["permission.asked","permission.replied"]})[Symbol.asyncIterator]()}
  catch(error){await registration.dispose();throw error}
  const streamLost=reason=>{fault(reason);void recover()}
  const pump=(async()=>{try{for(;;){const next=await iterator.next();if(next.done){if(!closing)streamLost("event stream ended");break}event(next.value)}}catch{streamLost("event stream failed")}})()
  const wrap=(tool,captured)=>async(input,native)=>{
    if(closing||native?.signal?.aborted)throw native?.signal?.reason??failure()
    return authority.execute({tool,input,native:{sessionID:native?.sessionID,messageID:native?.messageID,id:native?.id}},async execution=>{
      const store={execution,signal:native.signal,ended:false,records:new Set()};owned.add(store)
      const abort=()=>{execution.cancel();for(const r of store.records){r.assertion.reject();if(r.pending)cleanup(r,r.pending)}}
      native.signal?.addEventListener("abort",abort,{once:true})
      try{
        if(native.signal?.aborted){abort();throw native.signal.reason??failure()}
        return await local.run(store,()=>captured(input,native))
      }finally{
        store.ended=true;native.signal?.removeEventListener("abort",abort)
        for(const r of store.records)if(r.assertion.live()){r.assertion.reject();if(r.pending)cleanup(r,r.pending)}
      }
    })
  }
  const close=async()=>{
    if(closed)return
    closing=true;authority.cancel()
    for(const record of tokens.values()){record.assertion.reject();if(record.pending&&nativeWork.size)cleanup(record,record.pending)}
    await Promise.all([...tasks])
    if(nativeWork.size)return {closed:false,outstanding:nativeWork.size,partial:true}
    await registration.dispose();await iterator.return?.();await pump
    closed=true;local.disable()
    return {closed:true,outstanding:0,partial}
  }
  const facade={...context,permission:{...permission,assert}}
  const setup=async original=>{
    let dispose
    try{dispose=await original(facade)}catch(error){await close();throw error}
    let work
    return ()=>work??=(async()=>{try{if(typeof dispose==="function")await dispose()}finally{await close()}})()
  }
  return Object.freeze({context:facade,setup,wrap,
    currentExecution:()=>{const store=current();return Object.freeze({receipt:()=>store.execution.receipt()})},
    recover,close,status:()=>({closed,partial,outstanding:nativeWork.size,tasks:tasks.size}),facts:()=>structuredClone(facts)})
}
