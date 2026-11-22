// PRIVATE discovery-only projection. Never serialize this object into traces, verdicts or diagnostics.
// Recording parsing and Code Mode attribution use the same supported codecs as the native runner.
import {parseEvents,summarize} from "../../trace/analyse.mjs"
import {extractInnerCalls} from "../../trace/innerArgs.mjs"
import {parseFirstJson} from "../../trace/resultCounts.mjs"
import {memoryTurn} from "../../run/mem-turns.mjs"
import {sha256} from "../../util/canonical.mjs"
import {isDeepStrictEqual as equal} from "node:util"

const mem=c=>c?.ns==="mem"||/^mem[._]/.test(c?.tool)
const text=v=>typeof v==="string"?v:JSON.stringify(v)
export function projectMemoryRecording(rawLines,source=null){
  const lines=rawLines.filter(line=>String(line).trim()),records=parseEvents(lines),issues=[],calls=[],trace=[],sessions=[]
  const issue=(state,code)=>issues.push({state,code})
  if(records.length!==lines.length)issue("fail","malformed private recording")
  const final=records.filter(e=>e.type==="text").at(-1)
  let ordinal=0
  const ids=new Set(),parts=new Set()
  for(const e of records){
    if(!["tool_use","text"].includes(e.type))continue
    sessions.push(e.sessionID)
    if(e.part?.sessionID!==undefined&&e.part.sessionID!==e.sessionID)issue("fail","conflicting recorded session")
    if(e.type!=="tool_use")continue
    const part=e.part??{},state=part.state??{},line=JSON.stringify(e),summary=summarize([line]),outer=summary.calls[0],outerIndex=trace.length
    const callId=part.callID
    if(callId==null)issue("unverifiable","recorded call identity")
    else if(typeof callId!=="string"||!callId||ids.has(callId))issue("fail","malformed or replayed call identity")
    else ids.add(callId)
    if(part.id!=null){if(typeof part.id!=="string"||!part.id||parts.has(part.id))issue("fail","malformed or replayed part identity");else parts.add(part.id)}
    const sites=outer?.tool==="execute"?extractInnerCalls(outer.inputRaw?.code):[]
    const status=state.status==="completed"?"ok":state.status==="error"?"error":"unknown"
    trace.push({tool:part.tool,via:part.tool==="execute"?"execute":"direct",args_sha256:Object.hasOwn(state,"input")?sha256(JSON.stringify(outer.inputRaw)):null,status,parent_index:null})
    for(const site of sites)trace.push({tool:site.name,ns:site.ns,via:"execute",args_sha256:site.parsed?sha256(JSON.stringify(site.args)):null,status,parent_index:outerIndex})
    const native=memoryTurn({code:0,stdout:line},{index:1,prompt:""}).calls
    const relevant=native.filter(mem)
    if(relevant.length&&summary.inner.failures)issue("fail","recorded inner invocation failed")
    // A call site is not proof of execution. Only a sole unconditional returned await has bounded
    // attribution here. Other programs need runtime per-inner lineage, which this recording lacks.
    let attributable=true
    if(relevant.length&&part.tool==="execute"){
      const site=sites[0],code=outer.inputRaw?.code?.trim().replace(/;$/,"").trim()
      attributable=sites.length===1&&site.parsed&&site.ns==="mem"&&code===`return await tools.mem.${site.name}(${JSON.stringify(site.args)})`
      if(!attributable)issue("unverifiable","executed inner-call attribution")
    }
    for(const [i,c]of native.entries())if(mem(c)){
      const output=c.output,args=c.args
      calls.push({tool:c.tool,args,args_sha256:args==null?null:sha256(JSON.stringify(args)),status:state.status,output,output_sha256:typeof output==="string"?sha256(output):null,session:e.sessionID,call_id:callId,part_id:part.id??null,outer_tool:part.tool,native_index:i,ordinal:ordinal++,inner_index:part.tool==="execute"?i:null,trace_index:part.tool==="execute"?outerIndex+1+i:outerIndex,attributable,
        identity_sha256:callId==null?null:sha256(JSON.stringify([e.sessionID,callId,part.id??null,part.tool,i,c.tool,args==null?null:sha256(JSON.stringify(args)),state.status,output==null?null:sha256(text(output))]))})
      if(!Object.hasOwn(state,"input"))issue("unverifiable","recorded typed arguments")
      if(state.status==null)issue("unverifiable","recorded invocation status")
      else if(state.status!=="completed")issue("fail","recorded invocation failed")
      const payload=parseFirstJson(output)
      if(!Object.hasOwn(state,"output")||state.output==null||state.output===""||attributable&&(output==null||output===""||!payload||typeof payload!=="object"||Object.keys(payload).length===0))issue("fail","recorded invocation returned no attributable data")
    }
  }
  return {schema:"oc-mem-private-recording/1",source,raw_sha256:sha256(rawLines.join("\n")),sessions,text:final?.part?.text??null,text_session:final?.sessionID??null,calls,trace,issues}
}

const plain=v=>Boolean(v&&typeof v==="object"&&!Array.isArray(v))
const name=c=>c.ns==="mem"?c.tool:String(c.tool).replace(/^mem[._]/,"")
export function reconcileMemoryRecording(id,recording,view,turn,native,q){
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
  if(trace){
    if(trace.length!==view.calls.length)q.fail("official trace call order/count contradicts actual recording")
    const seqs=new Set()
    for(const [i,sig]of trace.entries()){
      if(!plain(sig)){q.fail("recorded trace lineage malformed");continue}
      const c=view.calls[i];if(!c)continue
      if(!Number.isInteger(c.seq)||seqs.has(c.seq))q.fail("replayed official trace call identity");seqs.add(c.seq)
      if(sig.tool!==c.tool||sig.ns!==c.ns||sig.via!==c.via)q.fail("official trace tool/order contradicts actual recording")
      q.check("official argument digest contradicts actual recording",[[c.args_sha256,"official trace argument digest"],[sig.args_sha256,"actual argument digest"]],()=>c.args_sha256===sig.args_sha256)
      if(sig.parent_index===null?c.parent_seq!==undefined:c.parent_seq!==view.calls[sig.parent_index]?.seq)q.fail("official inner call parent contradicts actual recording")
      const results=view.events.filter(e=>e.kind==="tool_result"&&e.for_seq===c.seq)
      if(results.length>1)q.fail("replayed official invocation outcome")
      if(c.status==="unknown")q.missing("official invocation outcome")
      else if(c.status!==sig.status)q.fail("official invocation outcome contradicts actual recording")
    }
  }
  if(actual){
    if(actual.some(c=>!plain(c))){q.fail("actual call lineage malformed");return}
    const joinable=actual.every(c=>c.attributable===true)
    if(native&&joinable&&actual.length!==native.length)q.fail("private proof call count contradicts actual recording")
    for(const [i,c]of actual.entries()){
      if(c.ordinal!==i)q.fail("actual call order malformed")
      q.check("actual call session contradicts private proof",[[c.session,"actual call session"],[turn?.session,"native session artifact"]],()=>c.session===turn.session)
      const identity=[c.session,c.call_id,c.part_id,c.outer_tool,c.native_index,c.tool,c.args_sha256,c.status,c.output_sha256]
      q.check("actual call identity digest malformed",[[c.call_id,"actual call identity"],[c.identity_sha256,"actual identity digest"]],()=>typeof c.call_id==="string"&&c.identity_sha256===sha256(JSON.stringify(identity)))
      q.check("actual argument digest malformed",[[c.args,"actual typed arguments"],[c.args_sha256,"actual argument digest"]],()=>plain(c.args)&&c.args_sha256===sha256(JSON.stringify(c.args)))
      q.check("actual output digest malformed",[[c.output,"actual call output"],[c.output_sha256,"actual output digest"]],()=>typeof c.output==="string"&&c.output_sha256===sha256(c.output))
      if(!joinable){q.missing("executed inner-call attribution");continue}
      const proof=native?.[i]
      if(!proof)continue
      if(name(proof)!==name(c))q.fail("private proof tool/order contradicts actual recording")
      q.check("private proof arguments contradict actual recording",[[proof.args,"private argument artifact"],[c.args,"actual typed arguments"]],()=>equal(proof.args,c.args)&&sha256(JSON.stringify(proof.args))===c.args_sha256)
      q.check("private proof status contradicts actual recording",[[proof.status,"native call status"],[c.status,"actual invocation status"]],()=>proof.status===c.status)
      q.check("private proof output contradicts actual recording",[[proof.output,"native call output"],[c.output,"actual call output"]],()=>proof.output===c.output)
      for(const key of ["call_id","part_id","identity_sha256"])if(Object.hasOwn(proof,key))q.check("private proof call identity contradicts actual recording",[[proof[key],"native call identity"],[c[key],"actual call identity"]],()=>proof[key]===c[key])
    }
  }
}
