// A Memory continuation adapter around the native runner's existing client, not another runner.
import { summarize } from "../trace/analyse.mjs"
import {closedMemorySites,resolvedMemoryArgs} from "./mem-arguments.mjs"
const terminal=(status)=>status==="completed"||status==="error"

export async function withMemoryActivation({write,clear,client,observations}){
  try{write(true);const result=await client();return {...result,memoryCalls:observations()}}
  finally{try{write(false)}finally{clear()}}
}

// The runner reads this private hook journal. Nothing here reads expected case arguments or answer text.
export function nativeMemoryCalls(records,context){
  if(!Array.isArray(records)||records.some(r=>!r||typeof r!=="object"||Array.isArray(r))||!["case_id","trial_id","session","activation_id"].every(k=>typeof context?.[k]==="string"&&context[k])||!Number.isInteger(context?.turn)||context.turn<1)return undefined
  if(!records.some(r=>r.kind==="guard_start"))return undefined
  const scoped=r=>r.case_id===context.case_id&&r.trial_id===context.trial_id&&r.turn===context.turn&&r.session===context.session&&r.activation_id===context.activation_id
  const starts=records.filter(r=>r.kind==="memory_native_start"&&scoped(r)&&r.pass===true)
  if(starts.some(r=>r.active!==true||typeof r.call_id!=="string"||!r.call_id||!Number.isInteger(r.incarnation)||r.incarnation<1||typeof r.tool!=="string"||!r.tool))return undefined
  if(!starts.length&&records.some(r=>r.kind==="memory_native_end"&&scoped(r)))return undefined
  return starts.map(r=>{
    const key=`${r.incarnation}:${r.call_id}`,ends=records.filter(e=>e.kind==="memory_native_end"&&scoped(e)&&e.call_id===r.call_id&&e.incarnation===r.incarnation&&e.tool===r.tool)
    const e=ends.length===1&&ends[0].pass===true&&ends[0].active===true?ends[0]:null,unique=starts.filter(s=>`${s.incarnation}:${s.call_id}`===key).length===1
    return {tool:r.tool,args:structuredClone(r.args),args_resolved:Boolean(unique&&terminal(e?.status)&&resolvedMemoryArgs(r.args)),args_source:"native_guard",status:e?.status??"unattributable",output:e?(typeof e.output==="string"?e.output:JSON.stringify(e.output)):null,call_id:r.call_id,incarnation:r.incarnation}
  })
}

export function memoryTurn(result,{index,prompt}) {
  const lines=String(result.stdout??"").split("\n"),summary=summarize(lines,result.stderr)
  const sessions=lines.flatMap(line=>{try{const e=JSON.parse(line);return e.type==="tool_use"?[e.sessionID]:[]}catch{return []}})
  const calls=[]
  let calls_complete=!Object.hasOwn(result,"memoryCalls")
  const text=(v)=>typeof v==="string"?v:JSON.stringify(v)
  if(Array.isArray(result.memoryCalls)){
    const valid=result.memoryCalls.every(c=>c&&c.args_source==="native_guard"&&typeof c.tool==="string"&&typeof c.call_id==="string"&&c.call_id&&Number.isInteger(c.incarnation)&&c.incarnation>0)
    const observed=valid?structuredClone(result.memoryCalls).map(c=>({...c,args_resolved:Boolean(c.args_resolved===true&&terminal(c.status)&&resolvedMemoryArgs(c.args))})):[]
    return {index,prompt,session:summary.sessionID??null,exit:result.code,timedOut:Boolean(result.timedOut||result.stalled),text:summary.finalText,calls_complete:valid&&observed.every(c=>c.args_resolved),calls:observed}
  }
  for(const [i,c] of summary.calls.entries()) {
    if(c.tool!=="execute") {const bound=Boolean(summary.sessionID&&sessions[i]===summary.sessionID);calls.push({tool:c.tool,args:c.inputRaw,args_source:"native_event",args_resolved:Boolean(bound&&terminal(c.status)&&resolvedMemoryArgs(c.inputRaw)),output:bound?text(c.outputRaw):null,status:c.status});continue}
    calls_complete=false
    const code=c.inputRaw?.code;let sites=[]
    try{sites=closedMemorySites(code)}catch{/* Optional diagnostics cannot establish or invalidate execution evidence. */}
    for(const site of sites) {
      // Source parsing is diagnostic only, including syntactically valid literals.
      // Neither source nor the outer execute result proves an inner invocation.
      calls.push({tool:site.ns==="mem"?`mem_${site.name}`:site.name,args:site.args,args_source:"source",args_resolved:false,code,output:null,status:"unattributable"})
    }
  }
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
