// Injected client returns recorded JSONL values only; never invokes OpenCode.
import { test } from "node:test"
import assert from "node:assert/strict"
import { runMemoryTurns, memoryTurn } from "../src/run/mem-turns.mjs"
import { coreCases } from "../packs/mem/core.mjs"
const result=(session,text,tool="mem_recall")=>({code:0,timedOut:false,stderr:"",stdout:[{type:"text",sessionID:session,part:{text}},{type:"tool_use",sessionID:session,part:{tool,state:{input:{query:"database"},output:"PostgreSQL",status:"completed"}}}].map((v)=>JSON.stringify(v)).join("\n")+"\n"})
test("native Memory continuation uses each original prompt and exactly the frozen fresh-session boundary",async()=>{
  for(const id of ["core-durability","core-forget","core-wiki-write"]){
    const spec=coreCases.find((s)=>s.original_id===id),seen=[]
    const r=await runMemoryTurns({spec,timeoutMs:1000,client:async({prompt,session})=>{seen.push({prompt,session});return result(session??`ses_${seen.length}`,'{"value":null}')}})
    assert.deepEqual(seen.map((s)=>s.prompt),spec.prompts)
    assert.equal(seen[0].session,null)
    for(let i=1;i<seen.length;i++)assert.equal(seen[i].session,i===spec.newSessionAfterRun?null:"ses_1")
    assert.equal(r.turns.length,spec.prompts.length)
    assert.equal(r.turns[0].calls[0].output,"PostgreSQL")
  }
})
test("source diagnostics keep namespace/arguments but never borrow outer output or argument authority",()=>{
  const make=(code,output)=>memoryTurn({code:0,stdout:JSON.stringify({type:"tool_use",sessionID:"ses_a",part:{tool:"execute",state:{status:"completed",input:{code},output}}})},{index:1,prompt:"question"})
  const sole=make('return await tools.mem.recall({query:"database"})',"PostgreSQL")
  assert.equal(sole.calls[0].tool,"mem_recall")
  assert.deepEqual(sole.calls[0].args,{query:"database"})
  assert.equal(sole.calls[0].args_resolved,false)
  assert.equal(sole.calls[0].args_source,"source")
  assert.equal(sole.calls[0].output,null)
  assert.equal(sole.calls_complete,false)
  const multi=make('await tools.mem.recall({query:"a"}); await tools.mem.recall({query:"b"}); return "PostgreSQL"',"PostgreSQL")
  assert.equal(multi.calls[0].output,null)
  assert.equal(multi.calls[0].status,"unattributable")
})
test("failed/incomplete session evidence stops continuation and retains original provider failure",async()=>{
  const spec=coreCases.find((s)=>s.original_id==="core-forget")
  let calls=0
  const r=await runMemoryTurns({spec,timeoutMs:1000,client:async()=>{calls++;return {...result("ses_1",""),code:1,stderr:"provider auth failed"}}})
  assert.equal(calls,1);assert.equal(r.code,1);assert.equal(r.stderr,"provider auth failed")
  await assert.rejects(runMemoryTurns({spec,timeoutMs:1000,client:async()=>({code:0,stdout:"",stderr:""})}),/session/)
})
