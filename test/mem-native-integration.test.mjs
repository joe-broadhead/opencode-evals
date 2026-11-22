// Offline native/public-hook seams only. No listener, host, model or source tool runs.
import {test} from "node:test"
import assert from "node:assert/strict"
import {goldCore} from "./mem-core.test.mjs"
import {memoryTurn,nativeMemoryCalls,withMemoryActivation} from "../src/run/mem-turns.mjs"
import {memoryCoreEvidence} from "../src/grade/adapters/mem-core.mjs"
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {guardPlugin} from "../src/run/guard/index.ts"
import {buildPolicy,installGuard} from "../src/run/guard/policy.mjs"
import {stageMemFixture} from "../src/run/mem-fixture.mjs"
import {pathToFileURL} from "node:url"
import {createBaselineProof} from "../worlds/mem/baseline-proof.mjs"
import {baselineObservationIdentity} from "../worlds/mem/baseline-entry.mjs"
import {baselineScopeHeaders} from "../worlds/mem/baseline-routing.mjs"
import {coreMemoryIntent} from "../src/run/mem-intent-plan.mjs"
import {coreCases} from "../packs/mem/core.mjs"
const binding={schema:"oc-mem-contained/1",fixture:"mem-synthetic-v1",backend:"container",origin:"http://127.0.0.1:4617"}
async function hooksFor(intent,run){
  const root=mkdtempSync(join(tmpdir(),"mem-integrate-")),hooks={},saved={}
  for(const[k,v]of Object.entries({EVALS_GUARD_OUT:join(root,"guard.jsonl"),EVALS_MEM_TURN_STATE:join(root,"turn.json"),EVALS_MEM_ACTIVE_CALL:join(root,"active-call.json")})){saved[k]=process.env[k];process.env[k]=v}
  const write=context=>writeFileSync(join(root,"turn.json"),JSON.stringify(context)),receipt=()=>JSON.parse(readFileSync(join(root,"active-call.json"),"utf8"))
  const context={case_id:intent.case_id,trial_id:intent.trial_id,turn:1,session:"ses_own",active:true}
  const families=["page","wiki","spaces"],policy=buildPolicy({mode:"commit",packs:[{id:"mem",pluginId:"mem",tools:families.map(name=>({name,permission:`mem_${name}`,class:"write"}))}],memoryBinding:binding,commit:Object.fromEntries(families.map(f=>[`mem_${f}`,{memory:f,allow:["spc-eval-personal"]}])),memoryIntent:intent,memoryReplies:{mem_wiki:"once",mem_spaces:"once"}})
  let dispose;write(context)
  try{const file=join(root,"guard.json");writeFileSync(file,JSON.stringify(policy));dispose=await guardPlugin({define:x=>x},file).setup({tool:{hook:async(n,f)=>{hooks[n]=f}},permission:{hook:async(n,f)=>{hooks[n]=f}},event:{subscribe:async function*(){}}});await run(hooks,{root,context,write,receipt,dispose})}
  finally{await dispose?.();for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v}rmSync(root,{recursive:true,force:true})}
}
const body="The gateway resolves context before routing.\n\nThe control plane uses PostgreSQL for PITR."
const event=(tool,input,output=body)=>JSON.stringify({type:"tool_use",sessionID:"ses_second",part:{tool,state:{input,status:"completed",output}}})
const turn=code=>memoryTurn({code:0,stdout:event("execute",{code})},{index:3,prompt:"Read"})
function gradeRead(calls){const g=goldCore("wiki-write","PostgreSQL","PostgreSQL");g.core.turns[2].calls=calls;return memoryCoreEvidence(g.s.original_id,{calls:g.core.turns.flatMap(t=>t.calls),state:{mem:{capture:{core:g.core}}}})}
test("M3 unresolved source spreads, aliases and computed arguments cannot prove a required typed action",()=>{
  for(const args of ['{action:"read",...unknown}','{...unknown,action:"read"}','{action:"read",resource:{...unknown}}','{action:"read",[key]:"status"}','input']){
    const t=turn(`const input={action:"read"}; return await tools.mem.wiki(${args})`)
    assert.equal(t.calls[0].args_resolved,false,args)
    assert.equal(gradeRead(t.calls).state,"unverifiable",args)
  }
})
test("M3 closed literals ignore source comments/string noise and check the root action, while actual native read arguments pass",()=>{
  const code='const noise="tools.mem.wiki({action: \'status\'})"; /* tools.mem.wiki({action:"status"}) */ return await tools.mem.wiki({action:"read",wiki_id:"wiki-eval-1",filename:"README.md"})'
  const t=turn(code);assert.equal(t.calls.length,1);assert.equal(t.calls[0].args_resolved,true);assert.equal(gradeRead(t.calls).state,"ok",JSON.stringify(gradeRead(t.calls)))
  for(const args of [{action:"status",nested:{action:"read"}},{action:"status",comment:'action:"read"'}])assert.equal(gradeRead([{tool:"mem_wiki",args,status:"completed",output:"PostgreSQL"}]).state,"fail")
  const actual=memoryTurn({code:0,stdout:event("mem_wiki",{action:"read",wiki_id:"wiki-eval-1",filename:"README.md"})},{index:3,prompt:"Read"});assert.equal(gradeRead(actual.calls).state,"ok")
  const noise=turn('return /tools.mem.wiki({action:"read",wiki_id:"wiki-eval-1",filename:"README.md"})/');assert.notEqual(gradeRead(noise.calls).state,"ok")
})
test("M4 closing a native turn permanently revokes its calls, even after replay, repeated close or reused call IDs",async()=>{
  const input={action:"write",path:"projects/quartz",content:"Quartz."},intent={schema:"oc-mem-intent/1",case_id:"sealed-case",trial_id:"trial_life",expires_at:Date.now()+60000,turns:[{index:1,calls:[{family:"page",args:input}]},{index:2,calls:[]},{index:3,calls:[]}]}
  await hooksFor(intent,async(h,{context,write})=>{
    const call={tool:"mem_page",input,sessionID:"ses_own",id:"old"},check=async(id,effect="allow",sessionID="ses_own",action="mem_page")=>{const e={action,sessionID,source:{type:"tool",id},effect};await h.evaluate(e);return e.effect}
    await h["execute.before"](call);assert.equal(await check("old"),"allow")
    write({...context,active:false});assert.equal(await check("old"),"deny");assert.equal(await check("old"),"deny")
    write({...context,turn:2});assert.equal(await check("old"),"deny")
    write(context);assert.equal(await check("old"),"deny");await assert.rejects(async()=>h["execute.before"]({...call,id:"replay"}))
    write({...context,turn:3});const read={tool:"mem_wiki",input:{action:"graph",wiki_id:"wiki-eval-personal"},sessionID:"ses_own",id:"fresh"};await h["execute.before"](read)
    assert.equal(await check("fresh","allow","ses_own","mem_wiki"),"allow");assert.equal(await check("fresh","deny","ses_own","mem_wiki"),"deny")
    await h["execute.after"]({...read,status:"completed",result:"read"});await assert.rejects(async()=>h["execute.before"](read))
    assert.equal(await check("fresh","allow","foreign","mem_wiki"),"deny")
  })
})
test("H2 public hooks emit bounded read receipts that bind actual HTTP sessions, clear on deny/ask/completion, and never borrow missing identity",async()=>{
  const intent={schema:"oc-mem-intent/1",case_id:"core-wiki-write",trial_id:"trial_read",expires_at:Date.now()+60000,turns:[{index:1,calls:[]}]}
  await hooksFor(intent,async(h,{context,receipt})=>{
    const call={tool:"mem_wiki",input:{action:"read",wiki_id:"wiki-eval-personal",filename:"README.md"},sessionID:"ses_own",id:"read1"}
    await h["execute.before"](call);const r=receipt();assert.equal(r.family,"wiki");assert.equal(r.call_id,"read1");assert.equal(r.expires_at,intent.expires_at);assert.equal(typeof r.incarnation,"number")
    const initial={knowledge:[{knowledge_id:"wiki-eval-personal",team_id:"local",raw:{"README.md":body}}]},proof=createBaselineProof(initial,{},intent)
    for(const session of ["ses_own","foreign",null]){
      const headers=baselineScopeHeaders({mode:"local"},{authorization:"Bearer eval-token",...(session?{"x-tdai-session-id":session}:{})},{})
      assert.equal(headers["x-tdai-session-id"],session??undefined)
      proof.observe({path:"/v3/wiki/raw/read",input:{wiki_id:"wiki-eval-personal",filenames:["README.md"]},response:{status:200,json:{data:{items:[{filename:"README.md",content:body}]}}},before:initial,after:initial,space:"personal",...baselineObservationIdentity(headers,context,r)})
      assert.equal(proof.operations.at(-1).binding,session==="ses_own"?"bound":"unbound")
    }
    const deny={action:"mem_wiki",sessionID:"ses_own",source:{type:"tool",id:"read1"},effect:"deny"};await h.evaluate(deny);assert.equal(deny.effect,"deny");assert.equal(receipt(),null)
    await h["execute.after"]({...call,status:"completed",result:body});assert.equal(receipt(),null)
    const next={...call,id:"read2"};await h["execute.before"](next);assert.ok(receipt())
    const ask={...deny,source:{type:"tool",id:"read2"},effect:"ask"};await h.evaluate(ask);assert.equal(ask.effect,"ask");assert.equal(receipt(),null)
    await h["execute.after"]({...next,status:"error",result:"cancelled"});assert.equal(receipt(),null)
    proof.observe({path:"/v3/wiki/raw/read",input:{wiki_id:"wiki-eval-personal",filenames:["README.md"]},response:{status:200,json:{data:{items:[{filename:"README.md",content:body}]}}},before:initial,after:initial,space:"personal",...baselineObservationIdentity({"x-tdai-session-id":"ses_own"},context,receipt())});assert.equal(proof.operations.at(-1).binding,"unbound")
  })
})
test("actual scoped hook arguments outrank unresolved source text, without deriving trace arguments from expected values or the answer",async()=>{
  const intent={schema:"oc-mem-intent/1",case_id:"core-wiki-write",trial_id:"trial_args",expires_at:Date.now()+60000,turns:[{index:1,calls:[]}]}
  await hooksFor(intent,async(h,{root,context})=>{
    const call={tool:"mem_wiki",input:{action:"read",wiki_id:"actual-observed-wiki",filename:"README.md"},sessionID:"ses_own",id:"native1"}
    await h["execute.before"](call);await h["execute.after"]({...call,status:"completed",result:"actual observed output"})
    const records=readFileSync(join(root,"guard.jsonl"),"utf8").trim().split("\n").map(JSON.parse),observed=nativeMemoryCalls(records,context)
    assert.equal(observed.length,1);assert.deepEqual(observed[0].args,call.input);assert.equal(observed[0].output,"actual observed output")
    const result=memoryTurn({code:0,stdout:event("execute",{code:'return await tools.mem.wiki({...unknown})'}),memoryCalls:observed},{index:1,prompt:"Read"})
    assert.equal(result.calls.length,1);assert.equal(result.calls[0].args_resolved,true);assert.equal(result.calls[0].args.wiki_id,"actual-observed-wiki")
    assert.deepEqual(nativeMemoryCalls(records,{...context,session:"foreign"}),[])
  })
})
test("M6 sealed core wiki presentation reaches public permission and observed creator linkage with actual CRLF bytes",async()=>{
  const intent=coreMemoryIntent(coreCases.find(s=>s.original_id==="core-wiki-write"),"trial_markdown",Date.now()+60000)
  await hooksFor(intent,async(h,{root,context,write,receipt})=>{
    const first="Core Notes\r\n==========\r\n\r\n> **The gateway resolves context before routing.**",decision="> **The control plane uses PostgreSQL for PITR.**",last=first+"\r\n\r\n"+decision,id="wiki_actual_md"
    const empty={knowledge:[]},row={knowledge_id:id,name:"Core Notes",team_id:"local",type:"llm_wiki",raw:{}},created={knowledge:[row]},initial={knowledge:[{...row,raw:{"README.md":first}}]},after={knowledge:[{...row,raw:{"README.md":last}}]},proof=createBaselineProof(empty,{},intent)
    const call={tool:"mem_wiki",input:{action:"create",name:"Core Notes",filename:"README.md",content:first},sessionID:"ses_own",id:"md-create"}
    await h["execute.before"](call);const v=receipt()
    const observe=(path,input,before,after,json)=>proof.observe({path,input,before,after,response:{status:200,json:{data:json}},space:"personal",...baselineObservationIdentity({"x-tdai-session-id":"ses_own"},context,v)})
    observe("/v3/wiki/create",{name:"Core Notes"},empty,created,{wiki_id:id})
    observe("/v3/wiki/raw/write",{wiki_id:id,files:[{filename:"README.md",content:first}]},created,initial,{items:[{filename:"README.md",status:"written"}]})
    assert.equal(proof.creators.length,1);assert.equal(proof.creators[0].args.content,first);assert.equal(proof.operations[1].body,first)
    await h["execute.after"]({...call,status:"completed",result:"Created"})
    const scopeFile=join(root,"scope.json"),old=process.env.EVALS_MEM_SCOPE_MAP;process.env.EVALS_MEM_SCOPE_MAP=scopeFile
    try{
      writeFileSync(scopeFile,JSON.stringify({schema:"oc-mem-scopes/1",fixture:"mem-synthetic-v1",case_id:intent.case_id,trial_id:intent.trial_id,record_spaces:{},wiki_spaces:{[id]:"spc-eval-personal"},creators:proof.creators}));write({...context,turn:2})
      const append={...call,id:"md-append",input:{action:"append",wiki_id:id,filename:"README.md",content:decision}}
      await h["execute.before"](append);assert.equal(receipt().args.content,decision)
      await h["execute.after"]({...append,status:"completed",result:"Appended"})
      for(const [i,input]of [{...append.input,content:decision+"\nNew instruction."},{...append.input,wiki_id:"wiki-other"},{...append.input,filename:"other.md"},{...append.input,extra:true}].entries())await assert.rejects(async()=>h["execute.before"]({...append,id:`bad-md-${i}`,input}))
    }finally{if(old===undefined)delete process.env.EVALS_MEM_SCOPE_MAP;else process.env.EVALS_MEM_SCOPE_MAP=old}
  })
})
test("native activation finally closes and clears receipts on success, client error, cancellation and close-write outage",async()=>{
  for(const mode of ["success","client-error","cancelled","close-error"]){
    const states=[];let cleared=0
    const promise=withMemoryActivation({write:active=>{states.push(active);if(!active&&mode==="close-error")throw new Error("close outage")},clear:()=>cleared++,client:async()=>{if(["client-error","cancelled"].includes(mode))throw new Error(mode);return {code:0}},observations:()=>[]})
    if(mode==="success")assert.equal((await promise).code,0);else await assert.rejects(()=>promise)
    assert.deepEqual(states,[true,false]);assert.equal(cleared,1)
  }
})
test("generic non-Memory restrictions retain deny-on-unasked-write and leave asks unsettled",async()=>{
  const root=mkdtempSync(join(tmpdir(),"generic-guard-")),hooks={};let dispose
  try{const file=join(root,"guard.json");writeFileSync(file,JSON.stringify(buildPolicy({mode:"refuse",packs:[{id:"other",pluginId:"other",tools:[{name:"send",permission:"other_send",class:"write"}]}]})))
    dispose=await guardPlugin({define:x=>x},file).setup({tool:{hook:async(n,f)=>{hooks[n]=f}},permission:{hook:async(n,f)=>{hooks[n]=f}},event:{subscribe:async function*(){}}})
    await hooks["execute.before"]({tool:"other_send",input:{destination:"anywhere"},id:"generic",sessionID:"ses_other"})
    for(const [effect,expected]of [["allow","deny"],["ask","ask"],["deny","deny"]]){const e={action:"other_send",sessionID:"ses_other",effect};await hooks.evaluate(e);assert.equal(e.effect,expected)}
  }finally{await dispose?.();rmSync(root,{recursive:true,force:true})}
})
test("isolated guard and baseline copies use the same reviewed presentation validator with no missing external imports",async()=>{
  const root=mkdtempSync(join(tmpdir(),"mem-stage-payload-"))
  try{
    const spec=coreCases.find(s=>s.original_id==="core-wiki-write"),intent=coreMemoryIntent(spec,"trial_stage",Date.now()+60000),dir=installGuard(root,buildPolicy({packs:[]}))
    const guard=await import(pathToFileURL(join(dir,"mem-intents.mjs")));assert.equal(typeof guard.memoryIntentAllows,"function")
    const stage=stageMemFixture({root,tmp:join(root,"tmp")},{core:spec,intent})
    const recorder=await import(pathToFileURL(join(stage.root,"baseline-proof.mjs")));assert.equal(typeof recorder.createBaselineProof,"function")
    const payload=await import(pathToFileURL(join(stage.root,"mem-intent-plan.mjs")))
    assert.equal(payload.coreWikiIntentPayloadMatches(intent.turns[0].calls[1].args,{...intent.turns[0].calls[1].args,content:"# Core Notes\r\n\r\nThe gateway resolves context before routing."}),true)
  }finally{rmSync(root,{recursive:true,force:true})}
})
test("actual public-hook calls and pure HTTP observations satisfy the core wiki oracle across a fresh-session Code Mode read",async()=>{
  const spec=coreCases.find(s=>s.original_id==="core-wiki-write"),intent=coreMemoryIntent(spec,"trial_native_e2e",Date.now()+60000)
  await hooksFor(intent,async(h,{root,context,write,receipt})=>{
    const empty={atoms:[],records:[],commitments:[],knowledge:[],conversations:[],scenarios:{},core:{},skills:[],assets:[],teamMembers:[],agents:[],acl:[],usage:{},jobs:[],curated:{},failures:{},seq:0,wikiFiles:[]},ctl={resources:[],grants:[],controlLog:[]}
    const proof=createBaselineProof(empty,ctl,intent),id="wiki_actual_native",first="# Core Notes\r\n\r\nThe gateway resolves context before routing.",decision="The control plane uses PostgreSQL for PITR.",last=first+"\r\n\r\n"+decision
    const row={knowledge_id:id,name:"Core Notes",type:"llm_wiki",team_id:"local",raw:{}},created={...empty,knowledge:[row]},initial={...empty,knowledge:[{...row,raw:{"README.md":first}}]},after={...empty,knowledge:[{...row,raw:{"README.md":last}}],wikiFiles:[{team_id:"local",wiki:"Core Notes",wiki_id:id,filename:"README.md",content:last}]}
    const scopeFile=join(root,"scope-e2e.json"),oldScope=process.env.EVALS_MEM_SCOPE_MAP,turns=[]
    const observe=(c,path,input,before,after,data)=>proof.observe({path,input,before,after,response:{status:200,json:{data}},space:"personal",...baselineObservationIdentity(baselineScopeHeaders({mode:"local"},{authorization:"Bearer eval-token","x-tdai-session-id":c.session},input),c,receipt())})
    const finish=async(call,c,output)=>{await h["execute.after"]({...call,status:"completed",result:output});const records=readFileSync(join(root,"guard.jsonl"),"utf8").trim().split("\n").map(JSON.parse),calls=nativeMemoryCalls(records,c);turns.push({index:c.turn,prompt:spec.prompts[c.turn-1],session:c.session,exit:0,timedOut:false,text:c.turn===3?'\u007b"value":"PostgreSQL"}':"Stored.",calls})}
    try{
      const create={tool:"mem_wiki",input:{action:"create",name:"Core Notes",filename:"README.md",content:first},sessionID:context.session,id:"e2e-create"}
      await h["execute.before"](create);observe(context,"/v3/wiki/create",{name:"Core Notes"},empty,created,{wiki_id:id});observe(context,"/v3/wiki/raw/write",{wiki_id:id,files:[{filename:"README.md",content:first}]},created,initial,{items:[{filename:"README.md",status:"written"}]});await finish(create,context,"Created.")
      process.env.EVALS_MEM_SCOPE_MAP=scopeFile;writeFileSync(scopeFile,JSON.stringify({schema:"oc-mem-scopes/1",fixture:"mem-synthetic-v1",case_id:intent.case_id,trial_id:intent.trial_id,record_spaces:{},wiki_spaces:{[id]:"spc-eval-personal"},creators:proof.creators}))
      const c2={...context,turn:2};write(c2);const append={tool:"mem_wiki",input:{action:"append",wiki_id:id,filename:"README.md",content:decision},sessionID:c2.session,id:"e2e-append"}
      await h["execute.before"](append);observe(c2,"/v3/wiki/raw/write",{wiki_id:id,files:[{filename:"README.md",content:last}]},initial,after,{items:[{filename:"README.md",status:"written"}]});await finish(append,c2,"Appended.")
      const c3={...context,turn:3,session:"ses_new"};write(c3);const read={tool:"mem_wiki",input:{action:"read",wiki_id:id,filename:"README.md"},sessionID:c3.session,id:"e2e-read"}
      await h["execute.before"](read);observe(c3,"/v3/wiki/raw/read",{wiki_id:id,filenames:["README.md"]},after,after,{items:[{filename:"README.md",content:last}]});await finish(read,c3,last)
      const result=memoryTurn({code:0,stdout:event("execute",{code:'return await tools.mem.wiki({...resolvedByHost})'}),memoryCalls:turns[2].calls},{index:3,prompt:spec.prompts[2]});turns[2].calls=result.calls
      const core={case_id:spec.original_id,trial_id:intent.trial_id,seed:{},proof_schema:"oc-mem-durable-proof/2",before:proof.before,state:proof.state(after,ctl),operations:proof.operations,effects:[{method:"wiki.raw.write",space:"personal",status:"stored"}],requests:[{method:"/v3/wiki/raw/read",verb:"POST",space:"personal",status:"read",output:last}],turns}
      const grade=()=>memoryCoreEvidence(spec.original_id,{calls:turns.flatMap(t=>t.calls),state:{mem:{capture:{core}}}})
      assert.equal(grade().state,"ok",JSON.stringify(grade()));assert.equal(core.state.knowledge[0].raw["README.md"],last)
      core.operations.at(-1).request_session=null;core.operations.at(-1).binding="unbound";assert.equal(grade().state,"fail")
    }finally{if(oldScope===undefined)delete process.env.EVALS_MEM_SCOPE_MAP;else process.env.EVALS_MEM_SCOPE_MAP=oldScope}
  })
})
