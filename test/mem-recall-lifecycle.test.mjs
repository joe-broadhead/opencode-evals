// In-process public hooks only; no runtime, backend or source evaluation.
import {test} from "node:test"
import assert from "node:assert/strict"
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {guardPlugin} from "../src/run/guard/index.ts"
import {buildPolicy} from "../src/run/guard/policy.mjs"
import {memoryActionMatches,memoryPermissionContext} from "../src/run/guard/mem-call-context.mjs"

async function withCall(tool,run){
  const root=mkdtempSync(join(tmpdir(),"recall-lifecycle-")),hooks={},saved={};let dispose
  const context={case_id:"core-recall-model",trial_id:"trial_lifecycle",turn:1,session:"ses_a",activation_id:"recall1",active:true}
  try{
    for(const[k,v]of Object.entries({EVALS_GUARD_OUT:join(root,"guard.jsonl"),EVALS_MEM_TURN_STATE:join(root,"turn.json"),EVALS_MEM_ACTIVE_CALL:join(root,"receipt.json")})){saved[k]=process.env[k];process.env[k]=v}
    const pack=JSON.parse(readFileSync(new URL("../packs/mem/pack.json",import.meta.url),"utf8"))
    const policy=buildPolicy({mode:"commit",packs:[pack],memoryBinding:{schema:"oc-mem-contained/1",fixture:"mem-synthetic-v1",backend:"container",origin:"http://127.0.0.1:4617"},memoryIntent:{schema:"oc-mem-intent/1",case_id:context.case_id,trial_id:context.trial_id,expires_at:Date.now()+60000,turns:[{index:1,calls:[]}]}})
    writeFileSync(join(root,"policy.json"),JSON.stringify(policy))
    const write=c=>writeFileSync(join(root,"turn.json"),JSON.stringify(c));write(context)
    dispose=await guardPlugin({define:x=>x},join(root,"policy.json")).setup({tool:{hook:async(n,f)=>{hooks[n]=f}},permission:{hook:async(n,f)=>{hooks[n]=f}},event:{subscribe:async function*(){}}})
    const event={tool,input:{query:"model"},id:"actual_recall",sessionID:"ses_a"}
    await hooks["execute.before"](event)
    const receipt=()=>JSON.parse(readFileSync(join(root,"receipt.json"),"utf8"))
    assert.equal(receipt().pass,true)
    await run({hooks,event,context,write,receipt,policy})
  }finally{await dispose?.();for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v}rmSync(root,{recursive:true,force:true})}
}

for(const tool of ["mem_recall","mem.recall"])for(const action of ["mem_recall","mem.recall"]){
  test(`${tool}/${action}: deny revokes, ask suspends, and closed turns reject permissions`,async()=>{
    for(const effect of ["deny","ask","closed"])await withCall(tool,async({hooks,event,context,write,receipt})=>{
      const permission=effect=>({action,sessionID:event.sessionID,source:{type:"tool",id:event.id},effect})
      if(effect==="closed")write({...context,active:false})
      const evaluation=permission(effect==="closed"?"allow":effect);await hooks.evaluate(evaluation)
      assert.equal(receipt(),null,effect)
      if(effect!=="ask"){
        assert.equal(evaluation.effect,"deny")
        const retry=permission("allow");await hooks.evaluate(retry);assert.equal(retry.effect,"deny");assert.equal(receipt(),null)
      }else{
        assert.equal(evaluation.effect,"ask")
        const allowed=permission("allow");await hooks.evaluate(allowed);assert.equal(allowed.effect,"allow");assert.equal(receipt().pass,true)
      }
      await assert.rejects(async()=>hooks["execute.before"](event))
    })
  })
}

test("recall permission routing keeps exact aliases and validated invocation identity",async()=>{
  await withCall("mem_recall",async({hooks,event,receipt,policy})=>{
    const allowed={action:"mem.recall",sessionID:event.sessionID,source:{type:"tool",id:event.id},effect:"allow"};await hooks.evaluate(allowed)
    assert.equal(allowed.effect,"allow")
    const foreign={...allowed,source:{type:"tool",id:"unobserved"}};await hooks.evaluate(foreign)
    assert.equal(foreign.effect,"deny");assert.equal(receipt(),null)
    for(const action of ["mem_recall_write","mem.recall.extra","memory.recall"]){
      assert.equal(memoryActionMatches({tool:"mem_recall",classification:{family:"recall",write:false}},action),false)
      assert.equal(memoryPermissionContext(policy,{...allowed,action},new Map()),null)
    }
  })
})
