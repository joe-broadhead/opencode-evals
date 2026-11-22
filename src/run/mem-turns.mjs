// A Memory continuation adapter around the native runner's existing client, not another runner.
import { summarize } from "../trace/analyse.mjs"
import { dataflow, returnKeyFor } from "../trace/innerArgs.mjs"
import { parseFirstJson } from "../trace/resultCounts.mjs"
import {closedMemorySites,resolvedMemoryArgs} from "./mem-arguments.mjs"

export async function withMemoryActivation({write,clear,client,observations}){
  try{write(true);const result=await client();return {...result,memoryCalls:observations()}}
  finally{try{write(false)}finally{clear()}}
}

// The runner reads this private hook journal. Nothing here reads expected case arguments or answer text.
export function nativeMemoryCalls(records,context){
  const scoped=r=>r.case_id===context.case_id&&r.trial_id===context.trial_id&&r.turn===context.turn&&r.session===context.session&&r.activation_id===context.activation_id
  const starts=records.filter(r=>r.kind==="memory_native_start"&&scoped(r)&&r.pass===true),seen=new Set()
  return starts.map(r=>{
    const key=`${r.incarnation}:${r.call_id}`,ends=records.filter(e=>e.kind==="memory_native_end"&&scoped(e)&&e.call_id===r.call_id&&e.incarnation===r.incarnation&&e.tool===r.tool)
    const e=ends.length===1&&ends[0].pass===true?ends[0]:null,unique=!seen.has(key);seen.add(key)
    return {tool:r.tool,args:structuredClone(r.args),args_resolved:Boolean(unique&&resolvedMemoryArgs(r.args)),args_source:"native_guard",status:e?.status??"unattributable",output:e?(typeof e.output==="string"?e.output:JSON.stringify(e.output)):null,call_id:r.call_id,incarnation:r.incarnation}
  })
}

export function memoryTurn(result,{index,prompt}) {
  const summary=summarize(String(result.stdout??"").split("\n"),result.stderr)
  const calls=[]
  const text=(v)=>typeof v==="string"?v:JSON.stringify(v)
  if(Array.isArray(result.memoryCalls))return {index,prompt,session:summary.sessionID??null,exit:result.code,timedOut:Boolean(result.timedOut||result.stalled),text:summary.finalText,calls:structuredClone(result.memoryCalls)}
  for(const c of summary.calls) {
    if(c.tool!=="execute") {calls.push({tool:c.tool,args:c.inputRaw,args_resolved:resolvedMemoryArgs(c.inputRaw),output:text(c.outputRaw),status:c.status});continue}
    const code=c.inputRaw?.code,sites=closedMemorySites(code),flow=dataflow(code),payload=parseFirstJson(c.outputRaw)
    for(const site of sites) {
      const variable=[...flow.bindings.entries()].find(([,tool])=>tool===site.name)?.[0]
      const key=variable?returnKeyFor(flow.returns,variable):null
      const slice=key&&payload&&typeof payload==="object"?payload[key]:undefined
      const output=sites.length===1&&site.parsed?text(c.outputRaw):slice!==undefined?text(slice):null
      // Unattributable inner output stays null: it cannot satisfy a tool-output assertion.
      calls.push({tool:site.ns==="mem"?`mem_${site.name}`:site.name,args:site.args,args_resolved:site.parsed,code,output,status:output===null?"unattributable":c.status})
    }
  }
  return {index,prompt,session:summary.sessionID??null,exit:result.code,timedOut:Boolean(result.timedOut||result.stalled),text:summary.finalText,calls}
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
