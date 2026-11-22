// A Memory continuation adapter around the native runner's existing client, not another runner.
import { summarize } from "../trace/analyse.mjs"
import {closedMemorySites,resolvedMemoryArgs} from "./mem-arguments.mjs"
const terminal=(status)=>status==="completed"||status==="error"
const typedInput=(args)=>Boolean(args&&typeof args==="object"&&!Array.isArray(args)&&resolvedMemoryArgs(args))

export async function withMemoryActivation({write,clear,client,observations}){
  try{write(true);const result=await client();return {...result,memoryCalls:observations()}}
  finally{try{write(false)}finally{clear()}}
}

// The runner reads this private hook journal. Nothing here reads expected case arguments or answer text.
export function nativeMemoryCalls(records,context){
  if(!Array.isArray(records)||!["case_id","trial_id","session","activation_id"].every(k=>typeof context?.[k]==="string"&&context[k])||!Number.isInteger(context?.turn)||context.turn<1)return undefined
  const shaped=records.filter(r=>r&&typeof r==="object"&&!Array.isArray(r))
  // This is an inventory diagnostic, never an invocation or an invented scope marker.
  // Keeping it in the supplied array prevents both complete-empty and direct fallback.
  const incomplete=shaped.length!==records.length?[{kind:"memory_inventory_incomplete",reason:"malformed raw journal row"}]:[]
  records=shaped
  if(!records.some(r=>r.kind==="guard_start"&&r.case_id===context.case_id&&r.trial_id===context.trial_id))return incomplete.length?incomplete:undefined
  const scoped=r=>r.case_id===context.case_id&&r.trial_id===context.trial_id&&r.turn===context.turn&&r.session===context.session&&r.activation_id===context.activation_id
  const starts=records.filter(r=>r.kind==="memory_native_start"&&scoped(r))
  const ends=records.filter(r=>r.kind==="memory_native_end"&&scoped(r))
  // Startup establishes neither a turn's coverage nor an authoritative empty inventory.
  if(!starts.length&&!ends.length)return incomplete.length?incomplete:undefined
  const same=(a,b)=>a.call_id===b.call_id&&a.incarnation===b.incarnation&&a.tool===b.tool
  const valid=r=>r.pass===true&&r.active===true&&typeof r.call_id==="string"&&r.call_id&&Number.isInteger(r.incarnation)&&r.incarnation>0&&typeof r.tool==="string"&&r.tool
  const call=(r,e,resolved)=>({tool:r.tool,args:structuredClone(r.args),args_resolved:Boolean(resolved&&typedInput(r.args)),args_source:"native_guard",status:e?.status??"unattributable",output:e?(typeof e.output==="string"?e.output:JSON.stringify(e.output)):null,call_id:r.call_id,incarnation:r.incarnation})
  const calls=starts.map(r=>{
    const matches=ends.filter(e=>same(r,e)),e=matches.length===1?matches[0]:null
    const unique=starts.filter(s=>s.call_id===r.call_id&&s.incarnation===r.incarnation).length===1
    return call(r,e,unique&&valid(r)&&e&&valid(e)&&terminal(e.status))
  })
  // Orphans remain visible but cannot prove an invocation without its start.
  for(const e of ends.filter(e=>!starts.some(r=>same(r,e))))calls.push(call(e,e,false))
  return [...calls,...incomplete]
}

export function memoryTurn(result,{index,prompt}) {
  const lines=String(result.stdout??"").split("\n"),summary=summarize(lines,result.stderr)
  const events=lines.flatMap(line=>{try{const e=JSON.parse(line);return e?.type==="tool_use"?[e]:[]}catch{return []}})
  const calls=[]
  let calls_complete=result.memoryCalls===undefined
  const text=(v)=>typeof v==="string"?v:JSON.stringify(v)
  if(Array.isArray(result.memoryCalls)){
    const validCall=c=>c&&c.args_source==="native_guard"&&typeof c.tool==="string"&&typeof c.call_id==="string"&&c.call_id&&Number.isInteger(c.incarnation)&&c.incarnation>0
    const valid=result.memoryCalls.every(validCall)
    const observed=structuredClone(result.memoryCalls.filter(validCall)).map(c=>({...c,args_resolved:Boolean(c.args_resolved===true&&terminal(c.status)&&typedInput(c.args))}))
    return {index,prompt,session:summary.sessionID??null,exit:result.code,timedOut:Boolean(result.timedOut||result.stalled),text:summary.finalText,calls_complete:valid&&observed.every(c=>c.args_resolved),calls:observed}
  }
  for(const [i,c] of summary.calls.entries()) {
    if(c.tool!=="execute") {const bound=Boolean(summary.sessionID&&events[i]?.sessionID===summary.sessionID),args=events[i]?.part?.state?.input,resolved=Boolean(bound&&terminal(c.status)&&typedInput(args));if(!resolved)calls_complete=false;calls.push({tool:c.tool,args,args_source:"native_event",args_resolved:resolved,output:bound?text(c.outputRaw):null,status:c.status});continue}
    calls_complete=false
    const code=c.inputRaw?.code;let sites=[]
    try{sites=closedMemorySites(code)}catch{/* Optional diagnostics cannot establish or invalidate execution evidence. */}
    for(const site of sites) {
      // Source parsing is diagnostic only, including syntactically valid literals.
      // Neither source nor the outer execute result proves an inner invocation.
      calls.push({tool:site.ns==="mem"?`mem_${site.name}`:site.name,args:site.args,args_source:"source",args_resolved:false,code,output:null,status:"unattributable"})
    }
  }
  if(Object.hasOwn(result,"memoryCalls")&&!calls.length)calls_complete=false
  return {index,prompt,session:summary.sessionID??null,exit:result.code,timedOut:Boolean(result.timedOut||result.stalled),text:summary.finalText,calls_complete,calls}
}

export async function runMemoryTurns({spec,client,timeoutMs,now=Date.now}) {
  const started=now(),turns=[],results=[]
  let session=null
  for(const [i,prompt] of spec.prompts.entries()) {
    if(i===spec.newSessionAfterRun) session=null
    const remaining=timeoutMs-(now()-started)
    if(remaining<=0) return {code:124,timedOut:true,stdout:results.map((r)=>r.stdout).join("\n"),stderr:"Memory multi-turn trial deadline exceeded",turns}
    const r=await client({prompt,session,index:i+1,timeoutMs:remaining})
    results.push(r)
    const turn=memoryTurn(r,{index:i+1,prompt});turns.push(turn)
    if(r.code!==0||r.timedOut||r.stalled) break
    if(!turn.session) throw new Error("Memory continuation lacks native session evidence")
    session=turn.session
  }
  return {...results.at(-1),stdout:results.map((r)=>r.stdout??"").join("\n"),stderr:results.map((r)=>r.stderr??"").join("\n"),turns}
}
