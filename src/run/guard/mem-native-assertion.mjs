// Private assertion capability, independent of operation plans and native request IDs.
import {isDeepStrictEqual as equal} from "node:util"
// Native pending requests omit undefined metadata values, including on later reevaluation.
const metadata=value=>value&&Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined))
const evaluation=v=>({sessionID:v?.sessionID,agent:v?.agent,action:v?.action,resources:v?.resources,source:v?.source,metadata:metadata(v?.metadata)})
const pendingFields=v=>({sessionID:v?.sessionID,action:v?.action,resources:v?.resources,save:v?.save,source:v?.source,metadata:metadata(v?.metadata)})

export function createNativeAssertion(input,{live,revoke,resume,track,claimRequest,replyDecision,observe}) {
  const snapshot=structuredClone(input)
  let started=false,completed=false,denied=false,revision=0,effect=null,pending=null,sendWork=null
  const record=phase=>observe({phase,revision,effect,requestID:pending?.id??null})
  const failure=()=>new Error("Memory native assertion: revoked, stale or unsupported assertion")
  const reject=()=>{denied=true;effect="deny";revision++;revoke();record("revoked");return false}
  const current=()=>!denied&&!completed&&live()
  const evaluate=event=>{
    if(!current()||!equal(evaluation(event),evaluation(snapshot))||!["ask","allow"].includes(event.effect)){
      reject();event.effect="deny";return false
    }
    revision++;effect=event.effect;record("evaluated") // Observation only, not completion.
    return true
  }
  const matches=request=>typeof request?.id==="string"&&request.id.startsWith("per")&&equal(pendingFields(request),pendingFields(snapshot))
  const bind=request=>{
    if(!matches(request))return reject()
    if(pending&&!equal(pending,request))return reject()
    if(!pending){
      if(!claimRequest(request))return reject()
      pending=structuredClone(request)
      record("bound")
    }
    // Retain a verified binding on tombstones for exact late-request cleanup, never approval.
    return current()
  }
  const reply=send=>{
    if(sendWork||!pending||!current()||replyDecision(pending)!=="once"||typeof send!=="function"){
      reject();return Promise.resolve("reject")
    }
    const end=track()
    // Install the barrier before invoking the sender, including reentrant native completion.
    sendWork=Promise.resolve().then(()=>{
      if(!current())throw failure()
      return send(structuredClone(pending))
    }).then(()=>({ok:true}),error=>{reject();return {ok:false,error}}).finally(end)
    return sendWork.then(result=>result.ok&&current()?"once":"reject")
  }
  const run=async invoke=>{
    if(started||!current()||typeof invoke!=="function"){reject();throw failure()}
    started=true
    const end=track()
    try{
      const result=await invoke()
      if(sendWork){const sent=await sendWork;if(!sent.ok)throw sent.error}
      if(!current())throw failure()
      completed=true;effect="allow";revision++;resume();record("completed")
      return result
    }catch(error){reject();throw error}
    finally{end()}
  }
  const cleanup=(request,send)=>{
    reject()
    if(!matches(request)||typeof send!=="function")return Promise.reject(failure())
    const end=track()
    return Promise.resolve().then(()=>send(structuredClone(request))).finally(end)
  }
  const recover=read=>{
    const end=track()
    return Promise.resolve().then(read).finally(end)
  }
  return Object.freeze({evaluate,bind,matches,reply,run,cleanup,recover,reject,live:current})
}
