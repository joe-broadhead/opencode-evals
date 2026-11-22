// Offline public-hook/normalizer seam. Source strings are never executed.
import {test} from "node:test"
import assert from "node:assert/strict"
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {guardPlugin} from "../src/run/guard/index.ts"
import {buildPolicy} from "../src/run/guard/policy.mjs"
import {memoryCall} from "../src/run/guard/mem-targets.mjs"
import {goldCore} from "./mem-core.test.mjs"
import {captureNativeCall} from "./support/mem-native-observation.mjs"
import {memoryTurn,nativeMemoryCalls} from "../src/run/mem-turns.mjs"
import {events} from "../src/trace/normalise.mjs"
import {gradeCase,runView} from "../src/grade/grade.mjs"
import {compileCase} from "../src/case/compile.mjs"
import {renderCore} from "../packs/mem/core.mjs"

const toolLine=(tool,input,output)=>JSON.stringify({type:"tool_use",sessionID:"ses_a",part:{tool,state:{input,output,status:"completed"}}})
function grade(g,rawLines,memoryCalls){
  g.core.turns[0]=memoryTurn({code:0,stdout:rawLines.join("\n"),memoryCalls},{index:1,prompt:g.s.prompts[0]})
  // The real generic codec, not a trace constructed from the observations under test.
  return gradeCase(compileCase(`${g.s.id}.md`,renderCore(g.s)),runView(events({rawLines,caseName:g.s.id,iteration:"offline"}),{state:{mem:{capture:{core:g.core}}},text:g.core.turns[0].text})).verdict
}
const answer=value=>JSON.stringify({type:"text",sessionID:"ses_a",part:{text:JSON.stringify({value})}})

test("Memory actual execution is invariant to alias and dead generic source sites",async()=>{
  const actual=await captureNativeCall({tool:"mem_wiki",input:{action:"read",wiki_id:"wiki_eval"},output:"Orbital"})
  for(const code of ['return await tools.mem.wiki({action:"read",wiki_id:"wiki_eval"})','const read = tools.mem.wiki; return await read({action:"read",wiki_id:"wiki_eval"})','if(false) await tools.mem.revise({action:"forget"}); return await tools.mem.wiki({action:"read",wiki_id:"wiki_eval"})']){
    assert.equal(grade(goldCore("wiki-owner","ORB-7","Orbital"),[toolLine("execute",{code},"FORGED"),answer("ORB-7")],actual.calls),"PASS")
    assert.equal(grade(goldCore("wiki-owner","ORB-7","Orbital"),[toolLine("execute",{code},"Orbital"),answer("ORB-7")],undefined),"BLOCKED")
  }
})

test("committed read-class recall is captured for direct and inner calls without widening writes",async()=>{
  const root=mkdtempSync(join(tmpdir(),"recall-authority-")),saved={},hooks={};let dispose
  const context={case_id:"core-recall-model",trial_id:"trial_recall",turn:1,session:"ses_a",activation_id:"recall1",active:true}
  try{
    for(const[k,v]of Object.entries({EVALS_GUARD_OUT:join(root,"guard.jsonl"),EVALS_MEM_TURN_STATE:join(root,"turn.json"),EVALS_MEM_ACTIVE_CALL:join(root,"receipt.json")})){saved[k]=process.env[k];process.env[k]=v}
    const pack=JSON.parse(readFileSync(new URL("../packs/mem/pack.json",import.meta.url),"utf8"))
    assert.equal(pack.tools.find(t=>t.name==="recall").class,"read")
    const policy=buildPolicy({mode:"commit",packs:[pack],memoryBinding:{schema:"oc-mem-contained/1",fixture:"mem-synthetic-v1",backend:"container",origin:"http://127.0.0.1:4617"},memoryIntent:{schema:"oc-mem-intent/1",case_id:context.case_id,trial_id:context.trial_id,expires_at:Date.now()+60000,turns:[{index:1,calls:[]}]}})
    writeFileSync(join(root,"policy.json"),JSON.stringify(policy));writeFileSync(join(root,"turn.json"),JSON.stringify(context))
    dispose=await guardPlugin({define:x=>x},join(root,"policy.json")).setup({tool:{hook:async(n,f)=>{hooks[n]=f}},permission:{hook:async(n,f)=>{hooks[n]=f}},event:{subscribe:async function*(){}}})
    for(const [i,tool]of ["mem_recall","mem.recall"].entries()){
      const e={tool,input:{query:"model"},id:`recall_${i}`,sessionID:"ses_a"}
      await hooks["execute.before"](e)
      const permission={action:"mem_recall",sessionID:"ses_a",source:{type:"tool",id:e.id},effect:"allow"};await hooks.evaluate(permission)
      assert.equal(permission.effect,"allow")
      await hooks["execute.after"]({...e,status:"completed",result:"helios-7b"})
      const records=readFileSync(join(root,"guard.jsonl"),"utf8").trim().split("\n").map(JSON.parse)
      const pair=records.filter(r=>r.kind==="guard_start"||r.call_id===e.id)
      const calls=nativeMemoryCalls(pair,context)
      assert.ok(Array.isArray(calls),"recall must emit scoped native frames")
      assert.equal(calls.length,1);assert.equal(calls[0].args_resolved,true);assert.equal(calls[0].output,"helios-7b")
      for(const outer of [toolLine("mem_recall",e.input,"helios-7b"),toolLine("execute",{code:'const r=tools.mem.recall; return await r({query:"model"})'},"FORGED")])
        assert.equal(grade(goldCore("recall-model","helios-7b","helios-7b"),[outer,answer("helios-7b")],calls),"PASS")
      await assert.rejects(async()=>hooks["execute.before"](e),/consumed/)
    }
    for(const e of [
      {tool:"mem_recall",input:{query:"model"},sessionID:"foreign"},
      {tool:"mem_recall",input:{query:"model",action:"forget"},sessionID:"ses_a"},
      {tool:"mem_revise",input:{action:"forget",id:"rec_unapproved"},sessionID:"ses_a"},
    ])await assert.rejects(async()=>hooks["execute.before"]({...e,id:"denied"}))
    assert.equal(memoryCall("mem_recall_write",{query:"model"}),null)
    assert.ok(memoryCall("mem_recall",[]).error)
  }finally{await dispose?.();for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v}rmSync(root,{recursive:true,force:true})}
})
