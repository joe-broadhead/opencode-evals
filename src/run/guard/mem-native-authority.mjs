// Private opt-in runner capability. Not installed by the legacy guard or exposed as a tool.
import {isDeepStrictEqual as equal} from "node:util"
import {randomUUID} from "node:crypto"
import {nativeOperationPlan} from "../mem-operation-plan.mjs"
import {validIntent,intentContext,memoryIntentAlternativeMatches} from "./mem-intents.mjs"
import {memoryCall,validMemoryBinding} from "./mem-targets.mjs"
import {decideBefore} from "./logic.mjs"
import {registerMemoryScopes,memoryReply} from "./mem-permissions.mjs"
import {memoryActionMatches} from "./mem-call-context.mjs"

const text=v=>typeof v==="string"&&v.length>0
const positive=v=>Number.isSafeInteger(v)&&v>0
const normalize=action=>String(action).replace(/^mem\./,"mem_")
const requestOf=p=>({requestID:p?.requestID,sessionID:p?.sessionID,action:normalize(p?.action),source:p?.source,resources:p?.resources})
const requestKey=p=>JSON.stringify([p?.sessionID,p?.requestID])
const scopeOf=c=>({case_id:c.case_id,trial:c.trial,trial_id:c.trial_id,turn:c.turn,activation_id:c.activation_id,incarnation:c.incarnation,sessionID:c.session})

export function createNativeAuthority(source, {readActivation,readScopes,readCompletion}) {
  const policy=structuredClone(source),expected=nativeOperationPlan(policy.memoryIntent)
  if(!validIntent(policy.memoryIntent)||!validMemoryBinding(policy.memoryBinding)||!expected||!equal(expected,policy.memoryOperationPlan))throw new Error("explicit supported operation-use plan required")
  if(typeof readActivation!=="function"||typeof readScopes!=="function"||typeof readCompletion!=="function")throw new Error("trusted runner adapters required")
  // These sets survive scope closure. Decline/error/cancellation never refund a use.
  const spent=new Set(),occurrences=new Set(),leases=new Set(),requests=new Map(),reservations=new Map(),reading=new Set(),facts=[]
  let current=null,proof=null,highestTurn=0,highestIncarnation=0,trial=null,disposed=false,controlRevision=0
  const fact=(kind,body={})=>facts.push({kind,...structuredClone(body)})
  const revoke=reason=>{
    controlRevision++
    for(const lease of leases){lease.pass=false;lease.revoked=true;lease.pending=false}
    if(current){fact("revoked",{scope:current.scope,reason});current=null}
  }
  const refuse=reason=>{fact("refused",{reason});throw new Error(`Memory native authority: ${reason}`)}
  const readTrusted=reader=>{
    if(reading.has(reader)){revoke("reentrant trusted reader");throw new Error("trusted reader reentry refused")}
    reading.add(reader)
    try{
      const value=reader()
      if(value!==null&&(typeof value==="object"||typeof value==="function")&&typeof value.then==="function"){
        // Observe rejection only. Neither resolution nor rejection can supply authority later.
        void Promise.resolve(value).catch(()=>{})
        throw new Error("trusted reader must return synchronously")
      }
      return value
    }catch(error){revoke("trusted reader failed or returned asynchronously");throw error}
    finally{reading.delete(reader)}
  }
  const activation=()=>{
    const c=readTrusted(readActivation)
    if(c?.schema!=="oc-mem-native-activation/1"||!positive(c.trial)||!positive(c.turn)||!positive(c.incarnation)||![c.case_id,c.trial_id,c.session,c.activation_id,c.generation].every(text)||c.active!==true)return null
    policy.memoryContext=structuredClone(c)
    return intentContext(policy,c.session)?c:null
  }
  const live=()=>{
    if(!current||disposed)return false
    const scope=current
    try {
      const c=activation()
      if(c&&!disposed&&current===scope&&equal(scopeOf(c),scope.scope)&&c.generation===scope.generation)return true
    }catch{}
    revoke("activation lost or expired");return false
  }
  const active=lease=>live()&&leases.has(lease)&&lease.pass&&!lease.ended
  const receipt=lease=>active(lease)&&!lease.pending?structuredClone({...policy.memoryContext,schema:"oc-mem-native-receipt/1",tool:lease.tool,family:lease.classification.family,args:lease.input,call_id:lease.native.id,native:lease.native,invocation_id:lease.invocation_id,occurrence:lease.occurrence,operation_id:lease.operation_id,grant_id:lease.grant_id,reservation_id:lease.reservation_id,expires_at:policy.memoryIntent.expires_at,pass:true}):null
  const open=()=>{
    if(disposed||current||leases.size)refuse("scope is already open, pending or disposed")
    const revision=controlRevision
    let c;try{c=activation()}catch{refuse("trusted activation unavailable")}
    if(disposed||current||leases.size||controlRevision!==revision)refuse("activation changed during open")
    if(!c||c.turn<=highestTurn||c.incarnation<=highestIncarnation||(trial!==null&&c.trial!==trial))refuse("missing, stale or foreign activation")
    highestTurn=c.turn;highestIncarnation=c.incarnation;trial=c.trial
    current={scope:scopeOf(c),generation:c.generation};proof=Object.freeze({})
    fact("opened",current);return proof
  }
  const verifyAuthority=request=>{
    if(!live()||request?.proof!==proof||request.generation!==current.generation)return null
    if(request.action==="open")return structuredClone(current)
    if(request.action!=="seal"||!equal(request.scope,current.scope)||leases.size)return null
    const scope=current
    // This record comes from the private qualified runner adapter, never request booleans.
    let completion;try{completion=readTrusted(readCompletion)}catch{return null}
    if(current!==scope||!live()||current!==scope||leases.size)return null
    if(completion?.schema!=="oc-mem-native-completion/1"||!equal(completion.scope,scope.scope)||completion.generation!==scope.generation||completion.terminal?.sessionID!==scope.scope.sessionID||!text(completion.terminal?.messageID)||completion.terminal.status!=="completed"||completion.dispatch?.closed!==true||completion.dispatch.outstanding!==0||completion.audit?.status!=="clean")return null
    const verified={...structuredClone(scope),quiescent:true}
    fact("sealed",verified);current=null
    return verified
  }
  const readReservation=({scope,native,tool})=>{
    if(!live()||!equal(scope,current.scope))return null
    const matching=[...leases].filter(l=>!l.ended&&l.tool===tool&&equal(l.native,native))
    const lease=matching.length===1?matching[0]:null
    return lease?.pass&&!lease.pending&&lease.grant_id?{grant_id:lease.grant_id,reservation_id:lease.reservation_id}:null
  }
  const denyRequest=event=>{
    // Refusal can revoke all candidates. It must never choose one to authorize.
    for(const lease of leases)if(lease.native.sessionID===event?.sessionID){lease.pass=false;lease.revoked=true;lease.pending=false}
    fact("permission_refused",{request:requestOf(event),reason:"missing, stale or ambiguous immutable request bridge"})
    return null
  }
  const resolveRequest=event=>{
    const bound=requests.get(requestKey(event))
    if(!text(event?.requestID)||!bound||!equal(bound.request,requestOf(event))||!active(bound.lease)||bound.state==="denied")return denyRequest(event)
    return bound
  }
  const bindRequest=(lease,event)=>{
    const request=structuredClone(requestOf(event)),key=requestKey(request)
    const targets=new Set([lease.target,...(lease.input.ids??[]),lease.input.id,lease.input.wiki_id,lease.input.path].filter(Boolean))
    const resourcesOK=!lease.classification.write||(Array.isArray(request.resources)&&request.resources.length>0&&request.resources.every(r=>targets.has(r)))
    if(!active(lease)||lease.boundRequest||!resourcesOK||!text(request.requestID)||requests.has(key)||request.sessionID!==lease.native.sessionID||request.source?.type!=="tool"||request.source.id!==lease.native.id||request.source.messageID!==lease.native.messageID||!memoryActionMatches(lease,request.action)){
      lease.pass=false;lease.revoked=true;refuse("invalid or already bound native request")
    }
    lease.boundRequest=key
    requests.set(key,{request,lease,state:"bound",revision:0})
    fact("request_bound",{request,invocation_id:lease.invocation_id,occurrence:lease.occurrence})
  }
  const transition=(bound,state)=>{bound.state=state;bound.revision++}
  const evaluate=event=>{
    const bound=resolveRequest(event)
    if(!bound){event.effect="deny";return}
    const lease=bound.lease
    if(event.effect==="ask"){transition(bound,"pending");lease.pending=true}
    else if(event.effect==="allow"){transition(bound,"allowed");lease.pending=false}
    else{event.effect="deny";transition(bound,"denied");lease.pass=false;lease.revoked=true;lease.pending=false}
    fact("permission",{request:bound.request,effect:event.effect,invocation_id:lease.invocation_id,occurrence:lease.occurrence})
  }
  const reply=async(event,send)=>{
    const bound=resolveRequest(event)
    if(!bound)return "reject"
    const lease=bound.lease
    const ask={...bound.request,id:bound.request.requestID,action:normalize(bound.request.action)}
    const decision=memoryReply(policy,ask,new Map([[`${lease.native.sessionID}:${lease.native.id}`,lease]]))
    if(event.effect==="deny"||bound.state!=="pending"||bound.replyStarted||decision!=="once"||typeof send!=="function"){
      lease.pass=false;lease.revoked=true;transition(bound,"denied");return "reject"
    }
    bound.replyStarted=true
    const revision=bound.revision
    // Both the request binding and pending transition must survive the await unchanged.
    try{await send({sessionID:ask.sessionID,requestID:ask.id,decision:"once"})}
    catch{
      if(bound.revision===revision&&active(lease)){lease.pass=false;lease.revoked=true;transition(bound,"denied")}
      fact("reply_failed",{request:bound.request});return "reject"
    }
    if(!active(lease)||bound.revision!==revision||bound.state!=="pending")return "reject"
    transition(bound,"allowed");lease.pending=false
    fact("reply",{request:bound.request,invocation_id:lease.invocation_id,occurrence:lease.occurrence});return "once"
  }
  const execute=async(request,delegate)=>{
    if(!live())refuse("inactive scope")
    const scope=current
    let snapshot;try{snapshot=structuredClone(request)}catch{refuse("unsupported native input snapshot")}
    const {native,tool,input,occurrence}=snapshot??{}
    fact("attempt",{native,tool,input,occurrence})
    const occurrenceKey=JSON.stringify([current.scope,occurrence])
    if(occurrence!==undefined&&(!text(occurrence)||occurrences.has(occurrenceKey)))refuse("invalid or reused occurrence")
    if(!native||![native.sessionID,native.messageID,native.id].every(text)||native.sessionID!==current.scope.sessionID)refuse("foreign or incomplete native identity")
    if(typeof delegate!=="function")refuse("trusted executor missing")
    try{
      const scopes=readTrusted(readScopes)
      for(const creator of scopes?.creators??[]){
        const origin=reservations.get(creator.reservation_id)
        if(!origin||origin.revoked||origin.pending||origin.failed||creator.alias!==origin.creates||creator.schema!=="oc-mem-native-creator/1"||creator.family!==origin.classification.family||!equal(creator.args,origin.input)||creator.session!==origin.native.sessionID||creator.call_id!==origin.native.id||!["invocation_id","occurrence","operation_id","grant_id"].every(k=>creator[k]===origin[k])||!["case_id","trial_id","trial","turn","activation_id","incarnation","generation"].every(k=>creator[k]===origin.context[k]))throw new Error("unbound creator reservation")
      }
      registerMemoryScopes(policy,scopes)
    }catch{refuse("trusted scope map or creator reservation unavailable")}
    if(current!==scope)refuse("activation changed during scope refresh")
    const classification=memoryCall(tool,input,policy.memoryBinding)
    if(!classification||classification.error)refuse("unsupported Memory classification")
    const decision=decideBefore(policy,tool,input,new Map(),native)
    if(!decision.pass)refuse(decision.why)
    let use=null,grant_id=null
    if(classification.write){
      if(policy.mode!=="commit")refuse("mutation requires commit policy")
      // Generic known-tool fallback is not mutation authorization. Require the selected Memory extractor and target policy.
      const write=decision.write
      if(write?.memory!==classification.family||!Array.isArray(write.allow)||!write.allow.includes(classification.target))refuse("mutation requires an explicit Memory family and target write policy")
      if([...leases].some(l=>l.classification.write))refuse("concurrent mutations unsupported")
      const matches=expected.turns.find(t=>t.index===current.scope.turn)?.uses.filter(u=>u.alternatives.some(a=>memoryIntentAlternativeMatches(policy,a,classification,input,native.sessionID)))??[]
      if(matches.length!==1)refuse("no unique authorized operation use")
      use=matches[0]
      grant_id=JSON.stringify([current.scope.case_id,current.scope.trial_id,current.scope.turn,use.id])
      if(spent.has(grant_id))refuse("operation use already consumed")
    }
    const creates=use?.alternatives.find(a=>memoryIntentAlternativeMatches(policy,a,classification,input,native.sessionID))?.creates
    if(!live())refuse("activation lost before reservation")
    if(grant_id)spent.add(grant_id) // Atomic, before any await or delegate; never refunded.
    if(occurrence!==undefined)occurrences.add(occurrenceKey)
    const lease={native,tool,input,occurrence:occurrence??null,invocation_id:randomUUID(),classification,sessionID:native.sessionID,target:classification.target,context:structuredClone(policy.memoryContext),operation_id:use?.id??null,grant_id,reservation_id:use?randomUUID():null,creates,pass:true,pending:false,ended:false,revoked:false,failed:false}
    if(lease.reservation_id)reservations.set(lease.reservation_id,lease)
    leases.add(lease);fact("reserved",{native,invocation_id:lease.invocation_id,occurrence:lease.occurrence,grant_id,reservation_id:lease.reservation_id})
    const execution=Object.freeze({receipt:()=>receipt(lease),bindRequest:event=>bindRequest(lease,event),cancel:()=>{lease.pass=false;lease.revoked=true;lease.pending=false;fact("cancelled",{invocation_id:lease.invocation_id,occurrence:lease.occurrence})}})
    try{return await delegate(execution)}
    catch(error){lease.failed=true;throw error}
    finally{lease.ended=true;lease.pass=false;leases.delete(lease);fact("ended",{invocation_id:lease.invocation_id,occurrence:lease.occurrence})}
  }
  return Object.freeze({open,verifyAuthority,readReservation,execute,evaluate,reply,facts:()=>structuredClone(facts),cancel:()=>revoke("cancelled"),close:()=>{disposed=true;revoke("disposed")}})
}
