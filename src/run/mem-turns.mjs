// A Memory continuation adapter around the native runner's existing client, not another runner.
import { summarize } from "../trace/analyse.mjs"
import { extractInnerCalls, dataflow, returnKeyFor } from "../trace/innerArgs.mjs"
import { parseFirstJson } from "../trace/resultCounts.mjs"

export function memoryTurn(result,{index,prompt}) {
  const summary=summarize(String(result.stdout??"").split("\n"),result.stderr)
  const calls=[]
  const text=(v)=>typeof v==="string"?v:JSON.stringify(v)
  for(const c of summary.calls) {
    if(c.tool!=="execute") {calls.push({tool:c.tool,args:c.inputRaw,output:text(c.outputRaw),status:c.status});continue}
    const code=c.inputRaw?.code,sites=extractInnerCalls(code),flow=dataflow(code),payload=parseFirstJson(c.outputRaw)
    for(const site of sites) {
      const variable=[...flow.bindings.entries()].find(([,tool])=>tool===site.name)?.[0]
      const key=variable?returnKeyFor(flow.returns,variable):null
      const slice=key&&payload&&typeof payload==="object"?payload[key]:undefined
      const output=sites.length===1&&site.parsed?text(c.outputRaw):slice!==undefined?text(slice):null
      // Unattributable inner output stays null: it cannot satisfy a tool-output assertion.
      calls.push({tool:site.ns==="mem"?`mem_${site.name}`:site.name,args:site.args,code,output,status:output===null?"unattributable":c.status})
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
