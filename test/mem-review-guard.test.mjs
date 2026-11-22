// Public hook seam with typed host events only. No OpenCode, listeners, or model calls.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { guardPlugin } from "../src/run/guard/index.ts"
import { buildPolicy } from "../src/run/guard/policy.mjs"
import { coreMemoryIntent } from "../src/run/mem-intent-plan.mjs"
import { coreCases } from "../packs/mem/core.mjs"

const binding={schema:"oc-mem-contained/1",fixture:"mem-synthetic-v1",backend:"container",origin:"http://127.0.0.1:4617"}
const pack={id:"mem",pluginId:"mem",rpc:"mem.tools",tools:["wiki","page","remember","revise"].map(name=>({name,permission:`mem_${name}`,class:"write"}))}
async function host(policy,run) {
  const root=mkdtempSync(join(tmpdir(),"mem-review-hooks-")),hooks={}
  const old=process.env.EVALS_GUARD_OUT;process.env.EVALS_GUARD_OUT=join(root,"guard.jsonl")
  let dispose
  try {
    const file=join(root,"guard.json");writeFileSync(file,JSON.stringify(policy))
    dispose=await guardPlugin({define:d=>d},file).setup({tool:{hook:async(n,f)=>{hooks[n]=f}},permission:{hook:async(n,f)=>{hooks[n]=f}},event:{subscribe:async function*(){}}})
    await run(hooks,async()=>{await dispose?.();dispose=null},root)
  }finally{await dispose?.();if(old===undefined)delete process.env.EVALS_GUARD_OUT;else process.env.EVALS_GUARD_OUT=old;rmSync(root,{recursive:true,force:true})}
}
test("M4: a validated mixed-family read exemption is bound to active call/action/session and ends after execution",async()=>{
  await host(buildPolicy({mode:"refuse",packs:[pack],locked:true,memoryBinding:binding}),async(hooks,dispose)=>{
    const call={tool:"mem_wiki",input:{action:"read",wiki_id:"wiki-eval-personal",filename:"design.md"},sessionID:"ses_own",id:"call_1"}
    await hooks["execute.before"](call)
    for(const extra of [{},{source:{type:"tool",id:"call_1"}}]) {
      const e={action:"mem_wiki",sessionID:"ses_own",effect:"allow",...extra};await hooks.evaluate(e);assert.equal(e.effect,"allow")
    }
    for(const change of [{sessionID:"foreign"},{source:{type:"tool",id:"wrong"}},{action:"mem_page"}]) {
      const e={action:"mem_wiki",sessionID:"ses_own",effect:"allow",...change};await hooks.evaluate(e);assert.equal(e.effect,"deny")
    }
    for(const effect of ["deny","ask"]) {const e={action:"mem_wiki",sessionID:"ses_own",effect};await hooks.evaluate(e);assert.equal(e.effect,effect)}
    await hooks["execute.after"]({...call,status:"completed",result:"body"})
    const ended={action:"mem_wiki",sessionID:"ses_own",effect:"allow"};await hooks.evaluate(ended);assert.equal(ended.effect,"deny")
    await hooks["execute.before"]({...call,id:"call_2"});await dispose()
    const closed={action:"mem_wiki",sessionID:"ses_own",effect:"allow"};await hooks.evaluate(closed);assert.equal(closed.effect,"deny")
  })
})

test("M5: backend-proven creation aliases, not output IDs or a space map, authorize the next turn",async()=>{
  const intent=coreMemoryIntent(coreCases.find(s=>s.original_id==="core-forget"),"trial_alias",Date.now()+60000)
  const context={case_id:"core-forget",trial_id:"trial_alias",turn:2,session:"ses_own",active:true}
  const creator={alias:"@created.memory",id:"rec_backend_1",family:"remember",args:{content:"The staging port is 8420.",kind:"fact"},case_id:"core-forget",trial_id:"trial_alias",turn:1,session:"ses_own",status:"stored"}
  const policy=buildPolicy({mode:"commit",packs:[pack],memoryBinding:{...binding,record_spaces:{rec_backend_1:"spc-eval-personal"}},commit:{mem_revise:{memory:"revise",allow:["spc-eval-personal"]}},memoryIntent:intent,memoryContext:context})
  const scope={schema:"oc-mem-scopes/1",fixture:"mem-synthetic-v1",case_id:"core-forget",trial_id:"trial_alias",record_spaces:{rec_backend_1:"spc-eval-personal"},wiki_spaces:{}}
  const old=process.env.EVALS_MEM_SCOPE_MAP
  try {
    await host(policy,async(hooks,dispose,root)=>{
      const file=join(root,"scope.json");process.env.EVALS_MEM_SCOPE_MAP=file
      const call={tool:"mem_revise",input:{action:"forget",id:"rec_backend_1"},id:"call_forget",sessionID:"ses_own"}
      for(const creators of [[],[{...creator,status:"queued"}],[{...creator,trial_id:"trial_other"}],[{...creator,args:{content:"Another fact",kind:"fact"}}]]) {
        writeFileSync(file,JSON.stringify({...scope,creators}));await assert.rejects(async()=>hooks["execute.before"](call),/intent/)
      }
      // Tool result text cannot change backend authority.
      await hooks["execute.after"]({tool:"mem_recall",input:{query:"id"},sessionID:"ses_own",id:"call_read",status:"completed",result:'{"id":"rec_backend_1"}'})
      writeFileSync(file,JSON.stringify({...scope,creators:[]}));await assert.rejects(async()=>hooks["execute.before"](call),/intent/)
      writeFileSync(file,JSON.stringify({...scope,creators:[creator]}));await hooks["execute.before"](call)
      const e={sessionID:"ses_own",action:"memory.forget",effect:"allow",source:{type:"tool",id:"call_forget"}};await hooks.evaluate(e);assert.equal(e.effect,"allow")
      await hooks["execute.after"]({...call,status:"completed",result:"Forgotten"})
      await assert.rejects(async()=>hooks["execute.before"]({...call,input:{action:"forget",id:"rec_unrelated"}}),/scope|intent/)
    })
  } finally {if(old===undefined)delete process.env.EVALS_MEM_SCOPE_MAP;else process.env.EVALS_MEM_SCOPE_MAP=old}
})

test("M5: an explicitly requested page move binds both source and destination; immutable intent cannot be widened by its caller",async()=>{
  const input={action:"move",path:"projects/quartz",to:"projects/renamed"}
  const intent={schema:"oc-mem-intent/1",case_id:"synthetic-move",trial_id:"trial_move",expires_at:Date.now()+60000,turns:[{index:1,calls:[{family:"page",args:structuredClone(input)}]}]}
  const policy=buildPolicy({mode:"commit",packs:[pack],memoryBinding:binding,commit:{mem_page:{memory:"page",allow:["spc-eval-personal"]}},memoryIntent:intent,memoryContext:{case_id:"synthetic-move",trial_id:"trial_move",turn:1,session:"ses_own",active:true}})
  intent.turns[0].calls[0].args.to="projects/other"
  await host(policy,async h=>{
    const call={tool:"mem_page",input,sessionID:"ses_own",id:"call_move"};await h["execute.before"](call);await h["execute.after"]({...call,status:"completed",result:"Moved"})
    for(const changed of [{...input,to:"projects/other"},{...input,path:"projects/unrelated"}])await assert.rejects(async()=>h["execute.before"]({...call,input:changed}),/intent/)
  })
})

test("M5: closing the native turn sidecar revokes an already-active permission context",async()=>{
  const intent={schema:"oc-mem-intent/1",case_id:"synthetic-lifetime",trial_id:"trial_life",expires_at:Date.now()+60000,turns:[{index:1,calls:[{family:"page",args:{action:"write",path:"projects/quartz",content:"Quartz."}}]},{index:2,calls:[]}]}
  const context={case_id:intent.case_id,trial_id:intent.trial_id,turn:1,session:"ses_own",active:true}
  const policy=buildPolicy({mode:"commit",packs:[pack],memoryBinding:binding,commit:{mem_page:{memory:"page",allow:["spc-eval-personal"]}},memoryIntent:intent})
  const old=process.env.EVALS_MEM_TURN_STATE
  try {
    await host(policy,async(h,dispose,root)=>{
      const file=join(root,"turn.json");process.env.EVALS_MEM_TURN_STATE=file;writeFileSync(file,JSON.stringify(context))
      const call={tool:"mem_page",sessionID:"ses_own",id:"call_life",input:{action:"write",path:"projects/quartz",content:"Quartz."}};await h["execute.before"](call)
      const evaluation=()=>({action:"mem_page",sessionID:"ses_own",source:{type:"tool",id:"call_life"},effect:"allow"})
      const active=evaluation();await h.evaluate(active);assert.equal(active.effect,"allow")
      writeFileSync(file,JSON.stringify({...context,active:false}));const ended=evaluation();await h.evaluate(ended);assert.equal(ended.effect,"deny")
      writeFileSync(file,JSON.stringify({...context,turn:2}));const later=evaluation();await h.evaluate(later);assert.equal(later.effect,"deny")
    })
  } finally {if(old===undefined)delete process.env.EVALS_MEM_TURN_STATE;else process.env.EVALS_MEM_TURN_STATE=old}
})
test("M4: generic plugin permission behavior is unchanged",async()=>{
  const demo={id:"demo",tools:[{name:"save",permission:"demo_save",class:"write"},{name:"read",permission:"demo_read",class:"read"}]}
  await host(buildPolicy({mode:"refuse",packs:[demo]}),async(hooks)=>{
    const read={action:"demo_read",sessionID:"ses_any",effect:"allow"};await hooks.evaluate(read);assert.equal(read.effect,"allow")
    const write={action:"demo_save",sessionID:"ses_any",effect:"allow"};await hooks.evaluate(write);assert.equal(write.effect,"deny")
    const denied={action:"demo_read",sessionID:"ses_any",effect:"deny"};await hooks.evaluate(denied);assert.equal(denied.effect,"deny")
  })
})

test("M5: sealed trial/turn intent permits the named payload, not another operation/path/destination/session or later lifetime",async()=>{
  const intent={schema:"oc-mem-intent/1",case_id:"synthetic-page",trial_id:"trial_1",expires_at:Date.now()+60000,turns:[{index:1,calls:[{family:"page",args:{action:"write",path:"projects/quartz",content:"Quartz."}}]}]}
  const context={case_id:"synthetic-page",trial_id:"trial_1",turn:1,session:"ses_own",active:true}
  const policy=buildPolicy({mode:"commit",packs:[pack],locked:true,memoryBinding:binding,commit:{mem_page:{memory:"page",allow:["spc-eval-personal"]}},memoryIntent:intent,memoryContext:context})
  await host(policy,async(hooks,dispose)=>{
    const event=(input,sessionID="ses_own")=>({tool:"mem_page",input,sessionID,id:"call_page"})
    const intended={action:"write",path:"projects/quartz",content:"Quartz."}
    await hooks["execute.before"](event(intended))
    const e={action:"mem_page",sessionID:"ses_own",effect:"allow"};await hooks.evaluate(e);assert.equal(e.effect,"allow")
    await hooks["execute.after"]({...event(intended),status:"completed",result:"Stored."})
    for(const input of [
      {action:"delete",path:"projects/quartz",confirm:true},
      {action:"delete",path:"projects/unrelated",confirm:true},
      {action:"move",path:"projects/quartz",to:"projects/unrelated"},
      {...intended,path:"projects/unrelated"},{...intended,content:"Other payload"},
      {...intended,space:"shared"},{...intended,to:"projects/unrelated"},
    ])await assert.rejects(async()=>hooks["execute.before"](event(input)),/intent/)
    await assert.rejects(async()=>hooks["execute.before"](event(intended,"ses_foreign")),/intent/)
    await dispose();await assert.rejects(async()=>hooks["execute.before"](event(intended)),/disposed/)
  })
  for(const changed of [
    {memoryContext:{...context,turn:2}}, {memoryContext:{...context,trial_id:"trial_other"}},
    {memoryContext:{...context,case_id:"other-case"}}, {memoryContext:{...context,active:false}},
    {memoryIntent:{...intent,expires_at:1}},
  ])await host({...policy,...changed},async(h)=>{await assert.rejects(async()=>h["execute.before"]({tool:"mem_page",input:{action:"write",path:"projects/quartz",content:"Quartz."},sessionID:"ses_own",id:"call_1"}),/intent/)})
})
