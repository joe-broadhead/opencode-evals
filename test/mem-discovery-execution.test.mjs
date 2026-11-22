// Synthetic backend calls + native compiler/grader. No host, listener, model, or runtime catalog.
import {test} from "node:test"
import assert from "node:assert/strict"
import {discoveryCases,renderDiscoveryCase,discoveryIntent} from "../packs/mem/discovery-plan.mjs"
import {createDiscoveryStore} from "../worlds/mem/discovery-store.mjs"
import {compileCase} from "../src/case/compile.mjs"
import {gradeCase,runView} from "../src/grade/grade.mjs"
import {adapterState} from "../src/grade/adapters/index.mjs"
import {normalizedDiscovery} from "./support/mem-discovery-flow.mjs"

function exercise(spec,{fault,space="personal",method=spec.backend.method,tool=spec.binding.tool,args=spec.binding.args,text=spec.answer,permission="allow"}={}){
  const trial_id="trial_unit",session="ses_discovery",context={case_id:spec.id,trial_id,turn:1,session,active:true}
  const intent=discoveryIntent(spec,trial_id,Date.now()+60000)
  const store=createDiscoveryStore({spec,intent,permission:{effect:permission},fault}),calls=[]
  const finish=response=>{
    const capture=store.capture();capture.discovery.turns=[{index:1,prompt:spec.prompt,session,exit:0,timedOut:false,text,calls}]
    const c=compileCase(`${spec.id}.md`,renderDiscoveryCase(spec))
    const grade=(via="direct",guardLog=[{kind:"guard_start",case_id:spec.id,trial_id}])=>gradeCase(c,runView([{schema:"oc-trace/1"},...normalizedDiscovery(calls,spec,via,session).trace],{state:adapterState("mem",[{path:"mem-fixture/capture.json",change:"added",text:JSON.stringify(capture)}]),text,guardLog}))
    return {grade,response,capture,store}
  }
  if(["deny","ask-declined"].includes(permission)){
    // A denied flow stops before attempting to derive identifiers from forbidden lookups.
    const invocation={...context,tool:`mem_${tool}`,args:structuredClone(args),pass:true}
    const response=store.request(method,spec.backend.input,{space,context,invocation})
    calls.push({tool:invocation.tool,args:invocation.args,status:"completed",output:JSON.stringify(response.json)})
    return finish(response)
  }
  const lookup=(tool,args,method,input)=>{const r=store.request(method,input,{context});assert.equal(r.status,200,`${spec.id} prerequisite ${method}`);calls.push({tool:`mem_${tool}`,args,status:"completed",output:JSON.stringify(r.json)});return r.json}
  let input=structuredClone(spec.backend.input),derived=structuredClone(spec.binding.args)
  if(spec.family==="exact-read"){
    const hits=lookup("recall",{query:"Quartz",in:"memories",types:["fact"]},"records.search",{query:"Quartz",kinds:["memory"],types:["fact"],status:"current",limit:20}).hits
    const record=hits.find(r=>r.title==="Quartz fact");assert.ok(record?.id,"no fallback ID when lookup evidence is absent")
    input={ids:[record.id]};derived={id:record.id}
  }
  if(["wiki-read","wiki-write","wiki-graph","code"].includes(spec.family)){
    const type=spec.family==="code"?"code-graph":"wiki",items=lookup("wiki",{action:"list",type},type==="wiki"?"wiki.list":"code-graph.list",{}).items
    const row=items.find(i=>i.name===(type==="wiki"?"Quartz wiki":"Quartz repository")),id=type==="wiki"?row?.wiki_id:row?.code_graph_id;assert.ok(id,"no fallback wiki/graph ID")
    if(spec.family==="code"){
      const nodes=lookup("code",{action:"search",graph_id:id,query:"parseInvoice"},"code-graph.search",{code_graph_id:id,query:"parseInvoice",limit:20}).nodes
      const node=nodes.find(n=>n.name==="parseInvoice");assert.ok(node?.id,"no fallback symbol")
      input={code_graph_id:id,symbol:node.id};derived={action:"callers",graph_id:id,symbol:node.id}
    }else{input.wiki_id=id;derived.wiki_id=id}
  }
  if(spec.family==="skills"){
    const items=lookup("spaces",{action:"skills",skill:{op:"list"}},"skill.list",{filters:{},pagination:{limit:100,offset:0}}).items
    const row=items.find(i=>i.name==="Quartz");assert.ok(row?.skill_id,"no fallback skill ID");input.skill_id=row.skill_id;derived.skill.id=row.skill_id
  }
  if(spec.family==="sources"){
    const rows=lookup("spaces",{action:"sources"},"sources.list",{}).sources,row=rows.find(r=>r.source==="gmail")
    assert.ok(row?.account,"account must be forwarded public metadata");input={source:row.source,account:row.account};derived={action:"sources",bind:{...input}}
  }
  if(spec.family==="jobs"){
    const row=lookup("spaces",{action:"jobs",job:{op:"templates"}},"jobs.templates",{}).templates.find(t=>t.connector==="slack")
    assert.ok(row?.id);assert.match(row.name,/quartz-synthetic/);input={template:row.id,project:"quartz",account:"quartz-synthetic"};derived={action:"jobs",job:{op:"draft",...input}}
  }
  if(args===spec.binding.args)args=derived
  const native={tool:`mem_${tool}`,args:structuredClone(args),status:"completed",output:"unit output"}
  const invocation={...context,tool:native.tool,family:tool,args:native.args,pass:true,call_id:"call_1"}
  const response=store.request(method,input,{space,context,invocation})
  native.output=JSON.stringify(response.json)
  calls.push(native)
  return finish(response)
}

test("24 discovery plans reach finite backend truth and native grading in direct and inner-call conditions",()=>{
  assert.equal(discoveryCases.length,24)
  for(const s of discoveryCases){const r=exercise(s);assert.equal(r.response.status,200,s.id);for(const via of ["direct","execute"])assert.equal(r.grade(via).verdict,"PASS",`${s.id} ${via}: ${JSON.stringify(r.grade(via))}`)}
})
test("each case rejects no-op, wrong space/action/body, partial, denied, queued, unsupported and metadata-only proof",()=>{
  for(const s of discoveryCases){
    for(const fault of ["noop","partial","denied","queued","unsupported","metadata-only"]){const r=exercise(s,{fault});for(const via of ["direct","execute"])assert.equal(r.grade(via).verdict,"FAIL",`${s.id} ${fault} ${via}`);r.store.close()}
    for(const change of [{space:"shared"},{method:"unknown.operation"},{tool:"status",args:{}},{args:{}},{text:"Done. Everything is active and complete."}]){const r=exercise(s,change);for(const via of ["direct","execute"])assert.equal(r.grade(via).verdict,"FAIL",`${s.id} ${JSON.stringify(change)} ${via}`);r.store.close()}
  }
})
test("source requests and job drafts are real scoped fake mutations, never account binding, activation, or answer-derived state",()=>{
  for(const s of discoveryCases.filter(s=>["sources","jobs"].includes(s.family))){
    const r=exercise(s),before=r.capture.before,after=r.capture.after
    assert.notDeepEqual(after.personal,before.personal);assert.deepEqual(after.shared,before.shared)
    assert.deepEqual(after.personal.bindings,[])
    if(s.family==="sources")assert.equal(after.personal.sourceRequests[0].state,"requested")
    else{assert.equal(after.personal.jobs[0].status,"draft");assert.equal(after.personal.jobs[0].next_due,null);assert.equal(after.personal.jobs[0].active,false)}
    assert.notEqual(r.store.request("sources.bind",{},{}).status,200);assert.notEqual(r.store.request("jobs.activate",{},{}).status,200)
  }
})
test("case aliases are visible through forwarded inventory/template metadata, never a confirmed binding, and closed stores reject later work",()=>{
  for(const s of discoveryCases.filter(s=>["sources","jobs"].includes(s.family))){
    const intent=discoveryIntent(s,"trial_lookup",Date.now()+60000),store=createDiscoveryStore({spec:s,intent})
    const context={case_id:s.id,trial_id:"trial_lookup",turn:1,session:"ses_lookup",active:true}
    const read=store.request(s.family==="sources"?"sources.list":"jobs.templates",{},{context})
    if(s.family==="sources"){assert.equal(read.json.sources[0].account,"quartz-synthetic");assert.equal(read.json.sources[0].enabled,false);assert.notEqual(read.json.sources[0].status,"confirmed");assert.equal(store.capture().after.personal.bindings.length,0)}
    else assert.match(read.json.templates[0].name,/Quartz.*quartz-synthetic/)
    store.close();const frozen=store.capture();assert.notEqual(store.request(s.backend.method,s.backend.input).status,200);assert.deepEqual(store.capture(),frozen)
  }
})
test("faults target the required operation, leaving actual scoped lookup results available; unknown drafts have no version or diff",()=>{
  const s=discoveryCases.find(s=>s.family==="jobs"),intent=discoveryIntent(s,"trial_fault",Date.now()+60000)
  const store=createDiscoveryStore({spec:s,intent,fault:"noop"})
  const context={case_id:s.id,trial_id:"trial_fault",turn:1,session:"ses_fault",active:true}
  assert.equal(store.request("jobs.templates",{},{context}).json.templates[0].id,"slack-threads-project")
  for(const method of ["jobs.get","jobs.versions","jobs.diff"]){const reply=store.request(method,{job_id:"unknown"},{context});assert.equal(reply.status,404);assert.ok(!reply.json.version)}
  store.close()
})
test("each discovery grade needs its own guard frame, backend context and unchanged unrelated durable families",()=>{
  for(const s of discoveryCases){
    const r=exercise(s)
    assert.equal(r.grade("direct",[]).verdict,"FAIL",`${s.id}: no guard frame`)
    for(const guardLog of [[{kind:"guard_start",case_id:"foreign",trial_id:"trial_unit"}],[{kind:"guard_start",case_id:s.id,trial_id:"foreign"}]])assert.equal(r.grade("direct",guardLog).verdict,"FAIL")
    const p=r.capture.discovery,before=structuredClone(p)
    const main=p.requests.find(q=>q.method===s.backend.method);main.context.session="foreign"
    assert.equal(r.grade().verdict,"FAIL",`${s.id}: foreign backend session`)
    r.capture.discovery=structuredClone(before);r.capture.discovery.state.shared.raw["leak.md"]="private body"
    assert.equal(r.grade().verdict,"FAIL",`${s.id}: shared mutation`)
    r.capture.discovery=structuredClone(before);r.capture.discovery.state.personal.bindings.push({source:"gmail",status:"confirmed",enabled:true})
    assert.equal(r.grade().verdict,"FAIL",`${s.id}: unexpected binding`)
    r.capture.discovery=structuredClone(before)
    if(s.write&&s.family!=="wiki-write"){r.capture.discovery.creators=[];assert.equal(r.grade().verdict,"FAIL",`${s.id}: unlinked identity`)}
    r.store.close()
  }
})
test("fake permission allow and approved asks persist exact writes; deny and declined asks leave all durable state unchanged",()=>{
  for(const s of discoveryCases.filter(s=>s.write))for(const permission of ["allow","deny","ask-approved","ask-declined"]){
    const r=exercise(s,{permission}),allowed=["allow","ask-approved"].includes(permission)
    assert.equal(r.grade().verdict,allowed?"PASS":"FAIL",`${s.id} ${permission}`)
    if(!allowed)assert.deepEqual(r.capture.after,r.capture.before)
    r.store.close()
  }
})
