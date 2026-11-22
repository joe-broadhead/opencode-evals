// A stand-in for the documented hook interface, not an OpenCode host or runtime-sidecar observation.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { guardPlugin } from "../src/run/guard/index.ts"
import { buildPolicy } from "../src/run/guard/policy.mjs"

test("Memory hook responder sends once only for a scoped active call and records declined foreign asks",async()=>{
  const root=mkdtempSync(join(tmpdir(),"mem-hook-")),hooks={},replies=[]
  const old=process.env.EVALS_GUARD_OUT;process.env.EVALS_GUARD_OUT=join(root,"guard.jsonl")
  let dispose
  try {
    const p=buildPolicy({mode:"commit",packs:[{id:"mem",pluginId:"mem",tools:[{name:"revise",class:"write",permission:"mem_revise"}]}],commit:{mem_revise:{memory:"revise",allow:["spc-eval-personal"]}},memoryBinding:{schema:"oc-mem-contained/1",fixture:"mem-synthetic-v1",backend:"container",origin:"http://127.0.0.1:4617",record_spaces:{rec_eval_1:"spc-eval-personal"}},memoryReplies:{"memory.forget":"once"}})
    p.memoryIntent={schema:"oc-mem-intent/1",case_id:"synthetic-forget",trial_id:"trial_hook",expires_at:Date.now()+60000,turns:[{index:1,calls:[{family:"revise",args:{action:"forget",id:"rec_eval_1"}}]}]}
    p.memoryContext={case_id:"synthetic-forget",trial_id:"trial_hook",turn:1,session:"ses_1",active:true}
    const file=join(root,"guard.json");writeFileSync(file,JSON.stringify(p))
    let emit,finished
    const ready=new Promise((r)=>{emit=r}),done=new Promise((r)=>{finished=r})
    const ctx={tool:{hook:async(n,f)=>{hooks[n]=f}},permission:{hook:async(n,f)=>{hooks[n]=f},reply:async(r)=>{replies.push(r)}},event:{subscribe:async function*(){await ready;yield {data:{id:"ask_1",sessionID:"ses_1",action:"memory.forget",source:{type:"tool",id:"call_1"},resources:["rec_eval_1"]}};yield {data:{id:"ask_2",sessionID:"foreign",action:"memory.forget",source:{type:"tool",id:"call_1"},resources:["rec_eval_1"]}};finished()}}}
    const definition=guardPlugin({define:(d)=>d},file)
    dispose=await definition.setup(ctx)
    await hooks["execute.before"]({sessionID:"ses_1",id:"call_1",tool:"mem_revise",input:{action:"forget",id:"rec_eval_1"}})
    emit();await done
    assert.deepEqual(replies.map((r)=>r.decision),["once","reject"])
    assert.deepEqual(replies[0],{sessionID:"ses_1",requestID:"ask_1",decision:"once"})
    const evaluation={sessionID:"ses_1",action:"memory.forget",effect:"deny"}
    await hooks.evaluate(evaluation);assert.equal(evaluation.effect,"deny")
  } finally {await dispose?.();if(old===undefined)delete process.env.EVALS_GUARD_OUT;else process.env.EVALS_GUARD_OUT=old;rmSync(root,{recursive:true,force:true})}
})
