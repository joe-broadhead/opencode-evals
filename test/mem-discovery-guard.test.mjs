// Typed public hook seam. Source-schema fixture metadata, not an OpenCode catalog observation.
import {test} from "node:test"
import assert from "node:assert/strict"
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {guardPlugin} from "../src/run/guard/index.ts"
import {buildPolicy} from "../src/run/guard/policy.mjs"
import {resolveCommitPlan} from "../src/run/commit-plan.mjs"
import {discoveryCases,discoveryIntent} from "../packs/mem/discovery-plan.mjs"
import {createDiscoveryStore} from "../worlds/mem/discovery-store.mjs"
import {memoryReply} from "../src/run/guard/mem-permissions.mjs"
import {memoryCall} from "../src/run/guard/mem-targets.mjs"
const binding={schema:"oc-mem-contained/1",fixture:"mem-synthetic-v1",backend:"container",origin:"http://127.0.0.1:4617"}
const pack={id:"mem",pluginId:"mem",tools:["remember","page","commitments","spaces","wiki","read","code"].map(name=>({name,permission:`mem_${name}`,class:["read","code"].includes(name)?"read":"write"}))}
async function host(calls,run,{mode="commit",tools=pack.tools,case_id=calls[0]?.args.action==="sources"?"deep-mem-sources":calls[0]?.args.action==="jobs"?"deep-mem-jobs":"deep-mem-skills",expires_at=Date.now()+60000}={}){
  const root=mkdtempSync(join(tmpdir(),"discovery-hooks-")),hooks={},replies=[];let dispose
  const old=process.env.EVALS_GUARD_OUT;process.env.EVALS_GUARD_OUT=join(root,"guard.jsonl")
  const previousReceipt=process.env.EVALS_MEM_ACTIVE_CALL;process.env.EVALS_MEM_ACTIVE_CALL=join(root,"active-call.json")
  try{
    const families=["remember","page","commitments","spaces","wiki"],commit=resolveCommitPlan({actions:families.map(f=>`mem_${f}`),writes:Object.fromEntries(families.map(f=>[`mem_${f}`,{memory:f,allow:["@mem.personal"]}]))},new Map([["mem.personal",["spc-eval-personal"]]]))
    const policy=buildPolicy({mode,packs:[{...pack,tools}],locked:true,memoryBinding:binding,commit:commit.writes,memoryReplies:Object.fromEntries(families.map(f=>[`mem_${f}`,"once"])),memoryIntent:{schema:"oc-mem-intent/1",case_id,trial_id:"trial_1",expires_at,turns:[{index:1,calls}]},memoryContext:{case_id,trial_id:"trial_1",turn:1,session:"ses_own",active:true}})
    const file=join(root,"guard.json");writeFileSync(file,JSON.stringify(policy));dispose=await guardPlugin({define:x=>x},file).setup({tool:{hook:async(n,f)=>{hooks[n]=f}},permission:{hook:async(n,f)=>{hooks[n]=f},reply:async r=>replies.push(r)},event:{subscribe:async function*(){}}})
    await run(hooks,{policy,receipt:()=>JSON.parse(readFileSync(join(root,"active-call.json"),"utf8"))})
  }finally{await dispose?.();if(old===undefined)delete process.env.EVALS_GUARD_OUT;else process.env.EVALS_GUARD_OUT=old;if(previousReceipt===undefined)delete process.env.EVALS_MEM_ACTIVE_CALL;else process.env.EVALS_MEM_ACTIVE_CALL=previousReceipt;rmSync(root,{recursive:true,force:true})}
}
test("discovery graph/spaces/read/code reads share active classification; deny/ask and foreign identity do not leak",async()=>{
  await host([],async h=>{
    let sequence=0
    for(const [tool,input]of [
      ["mem_wiki",{action:"graph",wiki_id:"wiki-eval-personal"}],
      ["mem_spaces",{action:"skills",skill:{op:"versions",id:"skill-quartz"}}],
      ["mem_spaces",{action:"sources"}],
      ["mem_spaces",{action:"jobs",job:{op:"templates"}}],
      ["mem_read",{id:"rec_01KABCDE1234567890ABCDEFGH"}],
      ["mem_code",{action:"callers",graph_id:"code-quartz",symbol:"parseInvoice"}],
    ]){
      const call={tool,input,sessionID:"ses_own",id:`call_${++sequence}`};await h["execute.before"](call)
      for(const effect of ["allow","ask","deny"]){const e={action:tool,sessionID:"ses_own",source:{type:"tool",id:call.id},effect};await h.evaluate(e);assert.equal(e.effect,effect)}
      for(const change of [{sessionID:"foreign"},{source:{type:"tool",id:"foreign"}}]){const e={action:tool,sessionID:"ses_own",effect:"allow",...change};await h.evaluate(e);assert.equal(e.effect,"deny")}
      await h["execute.after"]({...call,status:"completed",result:"read"});const e={action:tool,sessionID:"ses_own",effect:"allow"};await h.evaluate(e);assert.equal(e.effect,"deny")
      await assert.rejects(async()=>h["execute.before"]({...call,input:{...input,readOnly:true}}))
    }
    for(const input of [{action:"skills",skill:{op:"versions",id:"skill-quartz",extra:true}},{action:"jobs",job:{op:"run_now",id:"job_1"}},{action:"sources",unbind:{source:"gmail"}},{action:"sources",bind:{source:"gmail",account:"quartz-synthetic"},confirm:true}])await assert.rejects(async()=>h["execute.before"]({tool:"mem_spaces",input,sessionID:"ses_own",id:"bad"}))
  })
})
test("read/code exemptions require trusted registered-tool policy metadata, not just valid input or a caller readOnly flag",async()=>{
  await host([],async h=>{
    await assert.rejects(async()=>h["execute.before"]({tool:"mem_code",input:{action:"callers",graph_id:"code-quartz",symbol:"parseInvoice"},sessionID:"ses_own",id:"unregistered"}))
  },{mode:"refuse",tools:pack.tools.filter(t=>!["read","code"].includes(t.name))})
})
test("spaces writes cannot gain authority from an arbitrary sealed case or account declaration",async()=>{
  const args={action:"sources",bind:{source:"gmail",account:"quartz-synthetic"}}
  for(const [case_id,input]of [["unregistered-case",args],["deep-mem-sources",{action:"sources",bind:{source:"gmail",account:"unrequested-account"}}]])await host([{family:"spaces",args:input}],async h=>{
    await assert.rejects(async()=>h["execute.before"]({tool:"mem_spaces",input,sessionID:"ses_own",id:"bad-case"}))
  },{case_id})
})
test("source request and inactive draft require exact nested personal intent, not another operation/account/project/template",async()=>{
  for(const intended of [{action:"sources",bind:{source:"gmail",account:"quartz-synthetic"}},{action:"jobs",job:{op:"draft",template:"slack-threads-project",project:"quartz",account:"quartz-synthetic"}}])await host([{family:"spaces",args:intended}],async h=>{
    const call={tool:"mem_spaces",input:intended,sessionID:"ses_own",id:"write_1"};await h["execute.before"](call)
    const e={action:"mem_spaces",sessionID:"ses_own",source:{type:"tool",id:"write_1"},effect:"allow"};await h.evaluate(e);assert.equal(e.effect,"allow")
    const denied={...e,effect:"deny"};await h.evaluate(denied);assert.equal(denied.effect,"deny")
    await h["execute.after"]({...call,status:"completed",result:"pending"})
    const nested=intended.bind?"bind":"job"
    for(const input of [{...intended,space:"shared"},{...intended,[nested]:{...intended[nested],account:"foreign"}},{...intended,[nested]:{...intended[nested],project:"foreign"}},{...intended,[nested]:{...intended[nested],template:"foreign"}},{...intended,[nested]:{...intended[nested],extra:true}},{action:"jobs",job:{op:"activate",id:"job_1"}}])await assert.rejects(async()=>h["execute.before"]({...call,input}))
    await assert.rejects(async()=>h["execute.before"]({...call,sessionID:"foreign"}))
    const foreign={...e,sessionID:"foreign",effect:"allow"};await h.evaluate(foreign);assert.equal(foreign.effect,"deny")
  })
})
test("all twelve discovery writes use actual public-hook receipts and bounded replies at the finite store seam, then lose authority after the call",async()=>{
  for(const s of discoveryCases.filter(s=>s.write)){
    const intent=discoveryIntent(s,"trial_1",Date.now()+60000)
    await host(intent.turns[0].calls,async(h,{policy,receipt})=>{
      const call={tool:`mem_${s.binding.tool}`,input:s.binding.args,sessionID:"ses_own",id:"integrated_1"}
      await h["execute.before"](call)
      const actual=receipt();assert.equal(actual.tool,call.tool);assert.deepEqual(actual.args,s.binding.args)
      policy.memoryContext=actual // Synthetic host state follows the actual emitted incarnation.
      const active=new Map([["ses_own:integrated_1",{tool:call.tool,input:call.input,sessionID:call.sessionID,classification:memoryCall(call.tool,call.input,binding),pass:true,target:"spc-eval-personal",context:actual}]])
      // Synthetic permission resources; real host resource projection is a runtime gate, not asserted here.
      const ask={id:"ask_1",sessionID:"ses_own",action:call.tool,source:{type:"tool",id:call.id},resources:["spc-eval-personal"]}
      assert.equal(memoryReply(policy,ask,active),"once",s.id)
      for(const change of [{effect:"deny"},{sessionID:"foreign"},{source:{type:"tool",id:"foreign"}}])assert.notEqual(memoryReply(policy,{...ask,...change},active),"once")
      const store=createDiscoveryStore({spec:s,intent})
      assert.equal(store.request(s.backend.method,s.backend.input,{context:actual,invocation:actual}).status,200,s.id)
      const evaluation={...ask,effect:"ask"};await h.evaluate(evaluation);assert.equal(evaluation.effect,"ask");assert.equal(receipt(),null)
      await h["execute.after"]({...call,status:"completed",result:"Stored in finite fake"});assert.equal(receipt(),null)
      const before=store.capture().after
      assert.notEqual(store.request(s.backend.method,s.backend.input,{context:actual,invocation:receipt()}).status,200)
      assert.deepEqual(store.capture().after,before);store.close()
      for(const input of [{...s.binding.args,local:true},{...s.binding.args,readOnly:true}])await assert.rejects(async()=>h["execute.before"]({...call,input}))
    },{case_id:s.id})
  }
})
test("expired discovery lifetimes do not exempt wiki graphs, spaces reads or writes",async()=>{
  const input={action:"sources",bind:{source:"gmail",account:"quartz-synthetic"}}
  await host([{family:"spaces",args:input}],async h=>{
    for(const [tool,args]of [["mem_spaces",input],["mem_spaces",{action:"sources"}],["mem_wiki",{action:"graph",wiki_id:"wiki-eval-personal"}]]){
      await assert.rejects(async()=>h["execute.before"]({tool,input:args,sessionID:"ses_own",id:"expired"}))
      const evaluation={action:tool,sessionID:"ses_own",source:{type:"tool",id:"expired"},effect:"allow"};await h.evaluate(evaluation);assert.equal(evaluation.effect,"deny")
    }
  },{expires_at:Date.now()-1})
})
