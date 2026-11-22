// PRIVATE discovery-only projection. Never serialize this object into traces, verdicts or diagnostics.
// Recording parsing and Code Mode attribution use the same supported codecs as the native runner.
import {parseEvents,summarize} from "../../trace/analyse.mjs"
import {extractInnerCalls} from "../../trace/innerArgs.mjs"
import {parseFirstJson} from "../../trace/resultCounts.mjs"
import {sha256} from "../../util/canonical.mjs"
import {isDeepStrictEqual as equal} from "node:util"

const mem=c=>c?.ns==="mem"||/^mem[._]/.test(c?.tool)
const text=v=>typeof v==="string"?v:JSON.stringify(v)
export function projectMemoryRecording(rawLines,source=null,nativeJournal=null){
  const lines=rawLines.filter(line=>String(line).trim()),records=parseEvents(lines),issues=[],calls=[],unjoinedCalls=[],trace=[],sessions=[]
  const issue=(state,code)=>issues.push({state,code})
  const required=(v,test,code)=>{if(v==null){issue("unverifiable",code);return false}if(!test(v)){issue("fail",code);return false}return true}
  if(records.length!==lines.length)issue("fail","malformed private recording")
  const final=records.filter(e=>e.type==="text").at(-1)
  let ordinal=0
  const ids=new Set(),parts=new Set(),carriers=new Map()
  // Inventory/identity completeness is independent of argument, status and output availability.
  let executionComplete=true
  const inspect=c=>{
    const {args,output}=c
    if(args==null)issue("unverifiable","recorded typed arguments")
    else if(!plain(args))issue("fail","malformed native invocation arguments")
    if(c.args_resolved===false)issue("fail","explicitly unresolved native invocation")
    if(c.status==null)issue("unverifiable","recorded invocation status")
    else if(c.status!=="completed")issue("fail","recorded invocation failed")
    const payload=parseFirstJson(output)
    if(output===undefined)issue("unverifiable","recorded invocation output absent")
    else if(typeof output!=="string"||!payload||typeof payload!=="object"||Object.keys(payload).length===0)issue("fail","recorded invocation returned no attributable data")
  }
  const append=(c,carrier,nativeIndex)=>{
    const args=c.args,output=c.output,callId=c.call_id
    const item={tool:c.tool,args,args_sha256:args==null?null:sha256(JSON.stringify(args)),status:c.status,output,output_sha256:typeof output==="string"?sha256(output):null,session:carrier.session,call_id:callId,part_id:carrier.part_id,outer_tool:carrier.tool,native_index:nativeIndex,ordinal:ordinal++,inner_index:carrier.tool==="execute"?nativeIndex:null,carrier_call_id:carrier.call_id,attributable:true}
    item.identity_sha256=callId==null?null:sha256(JSON.stringify([item.session,callId,item.part_id,item.outer_tool,nativeIndex,c.tool,item.args_sha256,c.status,item.output_sha256]))
    calls.push(item)
  }
  for(const e of records){
    if(!["tool_use","text"].includes(e.type))continue
    sessions.push(e.sessionID)
    if(e.part?.sessionID!==undefined&&e.part.sessionID!==e.sessionID)issue("fail","conflicting recorded session")
    if(e.type!=="tool_use")continue
    const part=e.part??{},state=part.state??{},line=JSON.stringify(e),summary=summarize([line]),outer=summary.calls[0],outerIndex=trace.length
    const callId=part.callID
    if(callId==null){executionComplete=false;issue("unverifiable","recorded call identity")}
    else if(typeof callId!=="string"||!callId||ids.has(callId))issue("fail","malformed or replayed call identity")
    else ids.add(callId)
    if(part.id!=null){if(typeof part.id!=="string"||!part.id||parts.has(part.id))issue("fail","malformed or replayed part identity");else parts.add(part.id)}
    const sites=outer?.tool==="execute"?extractInnerCalls(outer.inputRaw?.code):[]
    const status=state.status==="completed"?"ok":state.status==="error"?"error":"unknown"
    trace.push({tool:part.tool,via:part.tool==="execute"?"execute":"direct",args_sha256:state.input!=null?sha256(JSON.stringify(state.input)):null,status,parent_index:null})
    for(const site of sites)trace.push({tool:site.name,ns:site.ns,via:"execute",args_sha256:site.parsed?sha256(JSON.stringify(site.args)):null,status,parent_index:outerIndex})
    const carrier={tool:part.tool,call_id:callId,part_id:part.id??null,session:e.sessionID,args:state.input,status:state.status,output:text(state.output),order:carriers.size}
    carriers.set(callId,carrier)
    if(part.tool==="execute"){
      // Source sites are provenance only, even for a sole returned await. No execution inference.
      executionComplete=false
      if(state.status&&state.status!=="completed")issue("fail","recorded carrier failed")
      if(summary.inner.failures)issue("fail","recorded carrier contains an observed failure")
    }else if(mem({tool:part.tool})){
      if(!Object.hasOwn(state,"input"))issue("unverifiable","recorded typed arguments")
      const c={tool:part.tool,args:state.input,status:state.status,output:text(state.output),call_id:callId}
      inspect(c);append(c,carrier,0)
    }
  }
  const rawHash=sha256(rawLines.join("\n"))
  // Retain direct facts for contradiction checks only. They never repair a supplied journal.
  const directCalls=[...calls]
  let journalScope=null
  if(nativeJournal!=null){
    // A supplied journal never falls back, including empty, incomplete, malformed or future schemas.
    const direct=calls.splice(0);ordinal=0;executionComplete=false
    if(!plain(nativeJournal))issue("fail","malformed native journal")
    else if(nativeJournal.schema!=="oc-mem-invocations/1")issue(nativeJournal.schema==null||/^oc-mem-invocations\/\d+$/.test(nativeJournal.schema)?"unverifiable":"fail","unsupported native journal schema")
    else{
      journalScope=nativeJournal.scope
      const scope=journalScope
      let scopeReady=required(scope,plain,"native journal scope")
      if(scopeReady){
        const ready=[required(scope.case_id,v=>typeof v==="string"&&v.length>0,"native journal case"),required(scope.trial,v=>Number.isInteger(v)&&v>0,"native journal physical trial"),required(scope.trial_id,v=>typeof v==="string"&&v.length>0,"native journal semantic trial"),required(scope.turn,v=>v===1,"native journal turn"),required(scope.session,v=>typeof v==="string"&&v.length>0,"native journal session")]
        scopeReady=ready.every(Boolean)
        if(source?.case_id!=null&&scope.case_id!=null&&scope.case_id!==source.case_id||source?.trial!=null&&scope.trial!=null&&scope.trial!==source.trial||final?.sessionID!=null&&scope.session!=null&&scope.session!==final.sessionID)issue("fail","foreign native journal scope")
      }
      const digestReady=required(nativeJournal.raw_sha256,v=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v),"native journal recording digest")
      if(digestReady&&nativeJournal.raw_sha256!==rawHash)issue("fail","native journal recording digest differs")
      const completeReady=required(nativeJournal.complete,v=>typeof v==="boolean","native journal completeness"),callsReady=required(nativeJournal.calls,Array.isArray,"native journal calls")
      if(callsReady){
        executionComplete=scopeReady&&digestReady&&completeReady&&nativeJournal.complete
        if(!executionComplete)issue("unverifiable","incomplete native journal")
        const seen=new Set(),observedDirect=new Set();let lastCarrier=-1
        for(const c of nativeJournal.calls){
          if(!plain(c)){issue("fail","malformed native observation");continue}
          inspect(c)
          const ready=[required(c.tool,v=>typeof v==="string"&&/^mem[._][a-z][a-z_]*$/.test(v),"native observation tool"),required(c.call_id,v=>typeof v==="string"&&v.length>0,"native observation identity"),required(c.carrier_call_id,v=>typeof v==="string"&&v.length>0,"native observation carrier")]
          if(!ready.every(Boolean)){executionComplete=false;unjoinedCalls.push(c);continue}
          if(seen.has(c.call_id))issue("fail","replayed native observation");seen.add(c.call_id)
          const carrier=carriers.get(c.carrier_call_id)
          if(!carrier){if(carriers.has(undefined))executionComplete=false;issue(carriers.has(undefined)?"unverifiable":"fail","orphan native observation");unjoinedCalls.push(c);continue}
          if(carrier.order<lastCarrier)issue("fail","native carrier order differs");lastCarrier=carrier.order
          if(scope?.session!=null&&carrier.session!==scope.session||carrier.tool!=="execute"&&!mem(carrier))issue("fail","foreign native observation carrier")
          if(carrier.tool!=="execute"){
            if(observedDirect.has(carrier.call_id))issue("fail","replayed direct observation");observedDirect.add(carrier.call_id)
            const d=direct.find(d=>d.call_id===carrier.call_id)
            if(!d||c.call_id!==d.call_id||name(c)!==name(d)||c.args!=null&&d.args!=null&&!equal(c.args,d.args)||c.status!=null&&d.status!=null&&c.status!==d.status||c.output!==undefined&&d.output!==undefined&&c.output!==d.output)issue("fail","native journal contradicts direct recording")
          }
          append(c,carrier,calls.filter(c=>c.carrier_call_id===carrier.call_id).length)
        }
        if(executionComplete&&direct.some(c=>!observedDirect.has(c.call_id)))issue("fail","native journal omitted actual direct invocation")
      }
    }
  }else if(!executionComplete)issue("unverifiable","native Code Mode execution journal absent")
  return {schema:"oc-mem-private-recording/1",source,raw_sha256:rawHash,sessions,text:final?.part?.text??null,text_session:final?.sessionID??null,calls,direct_calls:directCalls,unjoined_calls:unjoinedCalls,trace,issues,execution_complete:executionComplete,journal_scope:journalScope}
}

const plain=v=>Boolean(v&&typeof v==="object"&&!Array.isArray(v))
const name=c=>c.ns==="mem"?c.tool:String(c.tool).replace(/^mem[._]/,"")
export function reconcileMemoryRecording(id,recording,view,turn,native,q,nativeComplete=true){
  const r=q.typed(recording,"actual private recording lineage",plain)
  if(!r)return
  if(r.schema!=="oc-mem-private-recording/1"){q.fail("private recording projection malformed");return}
  const issues=q.typed(r.issues,"recording attribution",Array.isArray)
  for(const issue of issues??[]){if(!plain(issue)||!["fail","unverifiable"].includes(issue.state))q.fail("recording attribution malformed");else if(issue.state==="fail")q.fail("actual recording has a failed or malformed invocation");else q.missing("actual recording invocation lineage")}
  q.check("recording belongs to a different case",[[r.source?.case_id,"recording source case"]],()=>r.source.case_id===id)
  const hash=view.head?.privacy?.raw?.sha256
  q.check("recording reference digest malformed",[[hash,"official recording digest"]],()=>typeof hash==="string"&&/^[a-f0-9]{64}$/.test(hash))
  q.check("actual recording contradicts official source digest",[[hash,"official recording digest"],[r.raw_sha256,"private recording digest"]],()=>hash===r.raw_sha256)
  const text=q.typed(r.text,"actual final answer",x=>typeof x==="string"),session=q.typed(r.text_session,"actual final session",x=>typeof x==="string"&&x.length>0)
  const viewText=q.typed(view.answer?.text,"official recording text",x=>typeof x==="string"),proofText=q.typed(turn?.text,"native answer artifact",x=>typeof x==="string")
  q.check("actual final answer contradicts recording text",[[text,"actual final answer"],[viewText,"official recording text"]],()=>text.trim()===viewText.trim())
  q.check("actual final answer contradicts private proof",[[text,"actual final answer"],[proofText,"native answer artifact"]],()=>text.trim()===proofText.trim())
  q.check("actual final session contradicts private proof",[[session,"actual final session"],[turn?.session,"native session artifact"]],()=>session===turn.session)
  const sessions=q.typed(r.sessions,"recorded sessions",Array.isArray)
  for(const value of sessions??[])q.check("foreign or mixed actual session",[[value,"actual call session"],[session,"actual final session"]],()=>typeof value==="string"&&value===session)
  const trace=q.typed(r.trace,"recorded trace lineage",Array.isArray),actual=q.typed(r.calls,"recorded calls",Array.isArray)
  const compareProof=(proof,c)=>{
    if(name(proof)!==name(c))q.fail("private proof tool/order contradicts actual recording")
    q.check("private proof arguments contradict actual recording",[[proof.args,"private argument artifact"],[c.args,"actual typed arguments"]],()=>equal(proof.args,c.args)&&sha256(JSON.stringify(proof.args))===c.args_sha256)
    q.check("private proof status contradicts actual recording",[[proof.status,"native call status"],[c.status,"actual invocation status"]],()=>proof.status===c.status)
    q.check("private proof output contradicts actual recording",[[proof.output,"native call output"],[c.output,"actual call output"]],()=>proof.output===c.output)
    for(const key of ["call_id","part_id","identity_sha256"])if(Object.hasOwn(proof,key))q.check("private proof call identity contradicts actual recording",[[proof[key],"native call identity"],[c[key],"actual call identity"]],()=>proof[key]===c[key])
  }
  if(trace){
    if(trace.length!==view.calls.length)q.fail("official trace call order/count contradicts actual recording")
    const seqs=new Set()
    for(const [i,sig]of trace.entries()){
      if(!plain(sig)){q.fail("recorded trace lineage malformed");continue}
      const c=view.calls[i];if(!c)continue
      if(!Number.isInteger(c.seq)||seqs.has(c.seq))q.fail("replayed official trace call identity");seqs.add(c.seq)
      if(sig.tool!==c.tool||sig.ns!==c.ns||sig.via!==c.via)q.fail("official trace tool/order contradicts actual recording")
      if(sig.args_sha256!==null||c.args_sha256!=null)q.check("official argument digest contradicts actual recording",[[c.args_sha256,"official trace argument digest"],[sig.args_sha256,"actual argument digest"]],()=>c.args_sha256===sig.args_sha256)
      if(sig.parent_index===null?c.parent_seq!==undefined:c.parent_seq!==view.calls[sig.parent_index]?.seq)q.fail("official inner call parent contradicts actual recording")
      const results=view.events.filter(e=>e.kind==="tool_result"&&e.for_seq===c.seq)
      if(results.length>1)q.fail("replayed official invocation outcome")
      // Inner trace rows come from source sites, not observed executions. Their
      // structure stays bound above; only carrier/direct/journal outcomes prove execution.
      if(sig.via==="execute"&&Number.isInteger(sig.parent_index))continue
      if(c.status==="unknown")q.missing("official invocation outcome")
      else if(c.status!==sig.status)q.fail("official invocation outcome contradicts actual recording")
    }
  }
  // A mixed turn still has an ordered direct-event inventory. Compare that copy
  // with recorded direct events, not with source sites or inner journal ordinals.
  const directProof=!nativeComplete&&native?.filter(c=>c.args_source==="native_event")
  if(directProof?.length){
    const direct=q.typed(r.direct_calls,"actual direct call recording",Array.isArray)
    if(direct){
      if(direct.length!==directProof.length)q.fail("private direct call count contradicts actual recording")
      for(const [i,c]of direct.entries()){
        if(!plain(c)){q.fail("actual direct call lineage malformed");continue}
        if(directProof[i])compareProof(directProof[i],c)
      }
    }
  }
  if(actual){
    if(actual.some(c=>!plain(c))){q.fail("actual call lineage malformed");return}
    // The remaining captured rows need identity, not a position among source sites.
    if(!nativeComplete)for(const proof of native??[]){
      if(proof.args_source==="native_event")continue
      if(typeof proof.call_id!=="string"||!proof.call_id)q.missing("private invocation identity")
      else if(native.filter(c=>c.call_id===proof.call_id).length!==1)q.fail("replayed private invocation identity")
      else if(!actual.some(c=>c.call_id===proof.call_id)){
        if(r.execution_complete===true)q.fail("private invocation absent from complete actual recording")
        else q.missing("private invocation binding")
      }
    }
    // Excluded source sites do not imply a complete private invocation inventory.
    const joinable=nativeComplete&&r.execution_complete===true&&actual.every(c=>c.attributable===true)
    if(native&&joinable&&actual.length!==native.length)q.fail("private proof call count contradicts actual recording")
    for(const [i,c]of actual.entries()){
      if(c.ordinal!==i)q.fail("actual call order malformed")
      q.check("actual call session contradicts private proof",[[c.session,"actual call session"],[turn?.session,"native session artifact"]],()=>c.session===turn.session)
      const identity=[c.session,c.call_id,c.part_id,c.outer_tool,c.native_index,c.tool,c.args_sha256,c.status,c.output_sha256]
      q.check("actual call identity digest malformed",[[c.call_id,"actual call identity"],[c.identity_sha256,"actual identity digest"]],()=>typeof c.call_id==="string"&&c.identity_sha256===sha256(JSON.stringify(identity)))
      q.check("actual argument digest malformed",[[c.args,"actual typed arguments"],[c.args_sha256,"actual argument digest"]],()=>plain(c.args)&&c.args_sha256===sha256(JSON.stringify(c.args)))
      q.check("actual output digest malformed",[[c.output,"actual call output"],[c.output_sha256,"actual output digest"]],()=>typeof c.output==="string"&&c.output_sha256===sha256(c.output))
      // Even incomplete journals can establish a contradiction for a supplied observation.
      const proof=joinable?native?.[i]:c.call_id!=null?native?.find(p=>p.call_id!=null&&p.call_id===c.call_id):undefined
      if(!proof)continue
      compareProof(proof,c)
    }
  }
  if(r.execution_complete!==true)q.missing("complete native execution observations")
  if(r.journal_scope){
    q.check("native journal turn/session differs",[[r.journal_scope.turn,"journal turn"],[r.journal_scope.session,"journal session"],[turn?.index,"native turn index"],[turn?.session,"native session artifact"]],()=>r.journal_scope.turn===turn.index&&r.journal_scope.session===turn.session)
    q.check("native journal trial differs",[[r.journal_scope.trial_id,"journal trial"],[view.guardLog,"guard recording"]],()=>view.guardLog.some(g=>g?.kind==="guard_start"&&g.case_id===id&&g.trial_id===r.journal_scope.trial_id))
  }
}
