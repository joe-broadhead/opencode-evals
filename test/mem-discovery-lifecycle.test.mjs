import {test} from "node:test"
import assert from "node:assert/strict"
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {selectMemoryPlan} from "../src/run/mem-case-plan.mjs"
import {stageMemFixture,memCaptureRecord} from "../src/run/mem-fixture.mjs"
import {discoveryCases,renderDiscoveryCase} from "../packs/mem/discovery-plan.mjs"
import {compileCase} from "../src/case/compile.mjs"
import {gradeCase,runView} from "../src/grade/grade.mjs"
import {adapterState} from "../src/grade/adapters/index.mjs"
import {createDiscoveryStore} from "../worlds/mem/discovery-store.mjs"
import {discoveryResponse,discoveryRoute} from "../worlds/mem/discovery-http.mjs"

test("one validated selector separates core/discovery IDs and stages actual finite discovery plans without execution",()=>{
  for(const s of discoveryCases){
    const plan=selectMemoryPlan(s.id,{trial_id:"trial_stage",expires_at:Date.now()+60000})
    assert.equal(plan.kind,"discovery");assert.equal(plan.intent.case_id,s.id);assert.equal(plan.intent.turns[0].calls.length,s.write?1:0)
    const root=mkdtempSync(join(tmpdir(),"discovery-stage-"))
    try{const spec=stageMemFixture({root,tmp:join(root,"tmp")},{discovery:plan.spec,intent:plan.intent});assert.equal(spec.plan.case_id,s.id);assert.equal(existsSync(join(spec.root,"capture.json")),false);assert.match(readFileSync(join(spec.root,"discovery-store.mjs"),"utf8"),/function createDiscoveryStore/);assert.match(readFileSync(spec.entry,"utf8"),/discovery/)}finally{rmSync(root,{recursive:true,force:true})}
  }
  assert.equal(selectMemoryPlan("deep-mem-core-durability",{trial_id:"trial",expires_at:Date.now()+1000}).kind,"core")
  assert.throws(()=>selectMemoryPlan("unknown",{trial_id:"trial",expires_at:Date.now()+1000}),/unknown/)
})
test("all 24 real HTTP method projections reach the same finite backend; gateway owns identity and scope",()=>{
  for(const s of discoveryCases){
    const p=selectMemoryPlan(s.id,{trial_id:"trial_http",expires_at:Date.now()+60000}),store=createDiscoveryStore({spec:s,intent:p.intent})
    const context={case_id:s.id,trial_id:"trial_http",turn:1,session:"ses_http",active:true},invocation={...context,tool:`mem_${s.binding.tool}`,family:s.binding.tool,args:s.binding.args,pass:true,call_id:"call_http"}
    const path=s.backend.method.startsWith("records.")||/^(?:sources|jobs)\./.test(s.backend.method)?`/records/v1/${s.backend.method}`:`/knowledge/v3/${s.backend.method.replaceAll(".","/")}`
    assert.equal(discoveryRoute("POST",path),s.backend.method)
    const req={method:"POST",path,headers:{authorization:"Bearer eval-token","x-mem-space-id":"eval-space-personal"},body:s.backend.input}
    assert.equal(discoveryResponse(store,req,{context,invocation}).status,200,s.id)
    for(const headers of [{authorization:"Bearer real"},{...req.headers,"x-records-role":"owner"},{...req.headers,"x-tdai-user-id":"another-user"},{...req.headers,"x-mem-space-id":"production"}])assert.notEqual(discoveryResponse(store,{...req,headers},{context,invocation}).status,200)
    assert.notEqual(discoveryResponse(store,{...req,path:"/debug/state"},{context,invocation}).status,200)
  }
})
test("finite read contracts reject unknown fields, foreign resources, changed cursor queries and malformed pagination",()=>{
  for(const s of discoveryCases.filter(s=>!s.write)){
    const store=createDiscoveryStore({spec:s,intent:selectMemoryPlan(s.id,{trial_id:"trial_input",expires_at:Date.now()+60000}).intent})
    assert.notEqual(store.request(s.backend.method,{...s.backend.input,unknown:true}).status,200,s.id)
    store.close()
  }
  const s=discoveryCases.find(s=>s.family==="browse"),store=createDiscoveryStore({spec:s,intent:selectMemoryPlan(s.id,{trial_id:"trial_cursor",expires_at:Date.now()+60000}).intent})
  const first=store.request("records.list",{limit:1}).json;assert.equal(first.more,true)
  const second=store.request("records.list",{limit:1,cursor:first.cursor});assert.equal(second.status,200);assert.equal(second.json.more,false);assert.equal(second.json.records[0].body,"Quartz other fact. QREC-OTHER-28.")
  for(const input of [{limit:2,cursor:first.cursor},{limit:1,status:"all",cursor:first.cursor},{limit:1,cursor:first.cursor.replace("personal","shared")},{limit:1,cursor:"discovery:personal:NaN"}])assert.notEqual(store.request("records.list",input).status,200)
  for(const [method,input]of [["skill.versions",{skill_id:"skill-quartz",pagination:{limit:49,offset:0}}],["skill.versions",{skill_id:"skill-quartz",pagination:{limit:50,offset:-1}}],["wiki.graph",{wiki_id:"wiki-eval-shared"}],["code-graph.callers",{code_graph_id:"unknown",symbol:"parseInvoice"}]])assert.notEqual(store.request(method,input).status,200)
  store.close()
})
test("native capture handoff attaches only supplied turns to actual finite-store bytes and requires teardown confirmation",async()=>{
  for(const s of discoveryCases){
    const p=selectMemoryPlan(s.id,{trial_id:"trial_capture",expires_at:Date.now()+60000}),root=mkdtempSync(join(tmpdir(),"discovery-native-"))
    try{
      const stage=stageMemFixture({root,tmp:join(root,"tmp")},{discovery:s,intent:p.intent}),store=createDiscoveryStore({spec:s,intent:p.intent})
      const context={case_id:s.id,trial_id:"trial_capture",turn:1,session:"ses_capture",active:true},invocation={...context,tool:`mem_${s.binding.tool}`,args:s.binding.args,pass:true}
      const reply=store.request(s.backend.method,s.backend.input,{context,invocation})
      writeFileSync(join(stage.root,"capture.json"),JSON.stringify(store.capture()));store.close()
      const turns=[{index:1,prompt:s.prompt,session:"ses_capture",exit:0,timedOut:false,text:s.answer,calls:[{tool:invocation.tool,args:invocation.args,status:"completed",output:JSON.stringify(reply.json)}]}]
      // Synthetic trial.gone stand-in, never a claim that a real container ran.
      await assert.rejects(()=>memCaptureRecord(stage,{gone:async()=>false},turns),/removal unverified/)
      const file=await memCaptureRecord(stage,{gone:async()=>true},turns),capture=JSON.parse(file.text)
      assert.deepEqual(capture.discovery.state,store.capture().after)
      assert.deepEqual(capture.discovery.turns,turns)
      const grade=gradeCase(compileCase(`${s.id}.md`,renderDiscoveryCase(s)),runView([{schema:"oc-trace/1"},{kind:"tool_call",seq:1,tool:invocation.tool,args:invocation.args,via:"direct"}],{state:adapterState("mem",[file]),text:s.answer,guardLog:[{kind:"guard_start",case_id:s.id,trial_id:"trial_capture"}]}))
      assert.equal(grade.verdict,"PASS",`${s.id}: ${JSON.stringify(grade)}`)
    }finally{rmSync(root,{recursive:true,force:true})}
  }
})
test("source-owned record metadata survives the wire projection, while content, target and invented dates cannot change the sealed intent",()=>{
  const s=discoveryCases.find(s=>s.family==="commitment"),p=selectMemoryPlan(s.id,{trial_id:"trial_wire",expires_at:Date.now()+60000})
  const context={case_id:s.id,trial_id:"trial_wire",turn:1,session:"ses_wire",active:true},invocation={...context,tool:"mem_commitments",args:s.binding.args,pass:true}
  const store=createDiscoveryStore({spec:s,intent:p.intent})
  const record={...s.backend.input.record,type:"commitment",title:s.binding.args.what,stated_by:"person",source:{session:"ses_wire"},fields:{what:s.binding.args.what,owner:"user",state:"open"}}
  const reply=store.request("records.put",{record},{context,invocation});assert.equal(reply.status,200)
  assert.equal(reply.json.record.fields.what,s.binding.args.what);assert.equal(reply.json.record.fields.state,"open")
  assert.equal(reply.json.record.source.session,"ses_wire")
  const before=store.capture().after
  for(const changed of [{...record,body:"Wrong body"},{...record,fields:{...record.fields,due:"2030-01-01"}},{...record,source:{session:"foreign"}},{...record,path:"projects/foreign"}])assert.notEqual(store.request("records.put",{record:changed},{context,invocation}).status,200)
  assert.deepEqual(store.capture().after,before);store.close()
})
test("548 public client projections use code search limit, real wiki rows and bounded skill offsets, not guessed parameter aliases",()=>{
  const s=discoveryCases.find(s=>s.family==="code"),store=createDiscoveryStore({spec:s,intent:selectMemoryPlan(s.id,{trial_id:"trial_client",expires_at:Date.now()+60000}).intent})
  assert.equal(store.request("code-graph.search",{code_graph_id:"code-quartz",query:"parseInvoice",limit:20}).status,200)
  assert.notEqual(store.request("code-graph.search",{code_graph_id:"code-quartz",query:"parseInvoice",top_k:20}).status,200)
  const rows=store.request("wiki.list",{}).json.items;assert.equal(rows.length,1);assert.equal(rows[0].wiki_id,"wiki-eval-personal")
  const assets=store.request("meta.asset.list-accessible",{asset_type:"llm_wiki"}).json.items;assert.equal(assets.length,1);assert.equal(assets[0].content_ref,"wiki-eval-personal")
  assert.equal(store.request("skill.list",{filters:{},pagination:{limit:100,offset:1}}).json.items.length,0)
  assert.equal(store.request("skill.versions",{skill_id:"skill-quartz",pagination:{limit:50,offset:2}}).json.items.length,0)
  store.close()
})
