// Synthetic public-hook fixture only. Never imported by runtime or graders.
// Input is an explicit actual hook event, never parsed source or an expected answer.
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {guardPlugin} from "../../src/run/guard/index.ts"
import {buildPolicy} from "../../src/run/guard/policy.mjs"
import {nativeMemoryCalls} from "../../src/run/mem-turns.mjs"

export async function captureNativeCall({tool="mem_revise",input,output="Actual private result.",context={case_id:"core-forget",trial_id:"trial_provenance",turn:2,session:"ses_a",activation_id:"provenance_activation_2",active:true},status="completed"}) {
  const root=mkdtempSync(join(tmpdir(),"mem-observation-")),hooks={},saved={};let dispose
  try {
    for(const [key,value]of Object.entries({EVALS_GUARD_OUT:join(root,"guard.jsonl"),EVALS_MEM_TURN_STATE:join(root,"turn.json"),EVALS_MEM_ACTIVE_CALL:join(root,"active.json")})){saved[key]=process.env[key];process.env[key]=value}
    const family=tool.replace(/^mem[._]/,"")
    const intent={schema:"oc-mem-intent/1",case_id:context.case_id,trial_id:context.trial_id,expires_at:Date.now()+60000,turns:Array.from({length:context.turn},(_,i)=>({index:i+1,calls:i+1===context.turn?[{family,args:input}]:[]}))}
    const binding={schema:"oc-mem-contained/1",fixture:"mem-synthetic-v1",backend:"container",origin:"http://127.0.0.1:4617",record_spaces:input.id?{[input.id]:"spc-eval-personal"}:{},wiki_spaces:input.wiki_id?{[input.wiki_id]:"spc-eval-personal"}:{}}
    const policy=buildPolicy({mode:"commit",packs:[{id:"mem",pluginId:"mem",tools:[{name:family,permission:`mem_${family}`,class:"write"}]}],memoryBinding:binding,commit:{[`mem_${family}`]:{memory:family,allow:["spc-eval-personal"]}},memoryIntent:intent})
    const file=join(root,"policy.json");writeFileSync(file,JSON.stringify(policy));writeFileSync(join(root,"turn.json"),JSON.stringify(context))
    dispose=await guardPlugin({define:x=>x},file).setup({tool:{hook:async(n,f)=>{hooks[n]=f}},permission:{hook:async(n,f)=>{hooks[n]=f}},event:{subscribe:async function*(){}}})
    const event={tool,input,id:"actual_provenance_call",sessionID:context.session}
    await hooks["execute.before"](event)
    const permission={action:`mem_${family}`,sessionID:context.session,source:{type:"tool",id:event.id},effect:"allow"};await hooks.evaluate(permission)
    if(permission.effect!=="allow")throw new Error("synthetic actual call was refused")
    await hooks["execute.after"]({...event,status,result:output})
    const records=readFileSync(join(root,"guard.jsonl"),"utf8").trim().split("\n").map(JSON.parse)
    const calls=nativeMemoryCalls(records,context)
    const receipt=JSON.parse(readFileSync(join(root,"active.json"),"utf8"))
    if(receipt!==null)throw new Error("native receipt was not cleared")
    return {calls,records,context,receipt}
  }finally{await dispose?.();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value}rmSync(root,{recursive:true,force:true})}
}
