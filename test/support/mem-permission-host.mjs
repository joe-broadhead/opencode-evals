// Source-shaped finite fake: native deny skips hooks; only pending ask allocates an ID.
import {deferred} from "./mem-assertion-fixture.mjs"
export function permissionHost({mode="allow",publish=true,sendGate=null,assertGate=null}={}) {
  const hooks=new Set(),pending=new Map(),queue=[],waiting=[],ready=deferred(),sendStarted=deferred()
  const calls={assert:[],reply:[],list:0,get:0,subscriptions:[],hookDisposals:0}
  const denied={native:"BlockedError"},declined={native:"DeclinedError"}
  let closed=false,sequence=0,delivered=null
  const take=item=>{delivered=item.ack;return {done:false,value:item.event}}
  const emit=event=>{const item={event,ack:deferred()};if(waiting.length)waiting.shift().resolve(take(item));else queue.push(item);return item.ack.promise}
  const evaluate=async input=>{
    const {sessionID,agent,action,resources,metadata,source}=input
    const event={sessionID,agent,action,resources,metadata,source,effect:mode==="allow"?"allow":"ask"}
    for(const hook of hooks)await hook(event)
    return event
  }
  const context={other:{untouched:true},permission:{
    hook:async(name,hook)=>{if(name!=="evaluate")throw Error("unexpected hook");hooks.add(hook);return {dispose:async()=>{hooks.delete(hook);calls.hookDisposals++}}},
    assert:async input=>{
      calls.assert.push(input)
      if(assertGate)await assertGate.promise
      if(mode==="deny")throw denied
      const decision=await evaluate(input)
      if(decision.effect==="deny")throw denied
      if(decision.effect==="allow"||mode==="unattended")return
      const {agent,...fields}=input
      const request={...structuredClone(fields),metadata:Object.fromEntries(Object.entries(fields.metadata??{}).filter(([,v])=>v!==undefined)),id:`per_${++sequence}`}
      const wait=deferred();pending.set(request.id,{request,wait})
      ready.resolve(request)
      if(publish)emit({type:"permission.asked",id:`event_${sequence}`,data:structuredClone(request)})
      try{await wait.promise}finally{pending.delete(request.id)}
    },
    list:async({sessionID})=>{calls.list++;return [...pending.values()].map(x=>structuredClone(x.request)).filter(r=>r.sessionID===sessionID)},
    get:async({sessionID,requestID})=>{calls.get++;const r=pending.get(requestID)?.request;if(!r||r.sessionID!==sessionID)throw Error("not found");return structuredClone(r)},
    reply:async input=>{
      calls.reply.push(input)
      sendStarted.resolve(input)
      const p=pending.get(input.requestID)
      if(!p||p.request.sessionID!==input.sessionID)throw Error("not found")
      emit({type:"permission.replied",id:"event_reply",data:{sessionID:input.sessionID,requestID:input.requestID,reply:input.decision}})
      if(input.decision==="once")p.wait.resolve()
      else if(input.decision==="reject"){
        for(const other of pending.values())if(other.request.sessionID===input.sessionID)other.wait.reject(declined)
      }else throw Error("unsupported reply")
      if(sendGate&&input.decision==="once")await sendGate.promise
    },
  },event:{subscribe:options=>{
    calls.subscriptions.push(options.types)
    return {[Symbol.asyncIterator]:()=>({
      next:()=>{delivered?.resolve();delivered=null;if(queue.length)return Promise.resolve(take(queue.shift()));if(closed)return Promise.resolve({done:true});const d=deferred();waiting.push(d);return d.promise},
      return:async()=>{closed=true;delivered?.resolve();for(const d of waiting.splice(0))d.resolve({done:true});return {done:true}},
    })}
  }}}
  const failStream=()=>{for(const d of waiting.splice(0))d.reject(new Error("stream lost"))}
  return {context,calls,denied,declined,emit,evaluate,pending,ready,sendStarted,failStream}
}
