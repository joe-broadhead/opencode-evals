import {test} from "node:test"
import assert from "node:assert/strict"
import {discoveryCases} from "../packs/mem/discovery-plan.mjs"
import {discoveryFlow as observedFlow} from "./support/mem-discovery-flow.mjs"
import {projectMemoryRecording} from "../src/grade/adapters/mem-recording.mjs"
import {memoryTurn} from "../src/run/mem-turns.mjs"
import {events} from "../src/trace/normalise.mjs"

const spec=discoveryCases.find(s=>s.id==="commit-mem-memory")
function discoveryFlow(spec,mode){
  const flow=observedFlow(spec,mode)
  flow.capture.discovery.turns=[memoryTurn({code:0,stdout:flow.rawLines.join("\n")},{index:1,prompt:spec.prompt})]
  return flow
}
const detail=flow=>flow.grade().items.find(i=>i.id==="MEM-CT02").detail
function reproject(flow){
  const source=flow.recording.source
  if(flow.journal)flow.journal.raw_sha256=projectMemoryRecording(flow.rawLines,source).raw_sha256
  flow.recording=projectMemoryRecording(flow.rawLines,source,flow.journal)
  flow.head.privacy.raw.sha256=flow.recording.raw_sha256
  flow.trace=events({rawLines:flow.rawLines})
}

test("independent Code Mode journal is not vetoed by source-only turn diagnostics",()=>{
  const flow=discoveryFlow(spec,"execute")
  assert.equal(flow.capture.discovery.turns[0].calls[0].args_source,"source")
  assert.equal(flow.recording.execution_complete,true)
  assert.equal(flow.grade().verdict,"PASS")
})

test("zero source sites do not assert an empty execution inventory",()=>{
  const flow=discoveryFlow(spec,"execute")
  const rows=flow.rawLines.map(JSON.parse)
  rows[0].part.state.input.code="return suppliedOperation()"
  flow.rawLines=rows.map(JSON.stringify);reproject(flow)
  flow.capture.discovery.turns=[memoryTurn({code:0,stdout:flow.rawLines.join("\n")},{index:1,prompt:spec.prompt})]
  assert.equal(flow.capture.discovery.turns[0].calls.length,0)
  assert.equal(flow.capture.discovery.turns[0].calls_complete,false)
  assert.equal(flow.grade().verdict,"PASS")
  flow.recording=projectMemoryRecording(flow.rawLines,flow.recording.source)
  assert.equal(flow.grade().verdict,"BLOCKED")
})

test("source diagnostics cannot hide an actual direct capture's contradictory output",()=>{
  const flow=discoveryFlow(spec,"direct")
  flow.capture.discovery.turns[0].calls[0].output=JSON.stringify({status:"stored",record:{id:"different"}})
  const diagnostic=discoveryFlow(spec,"execute").capture.discovery.turns[0].calls[0]
  flow.capture.discovery.turns[0].calls.push(diagnostic)
  const grade=flow.grade()
  assert.equal(grade.verdict,"FAIL")
  assert.match(grade.items.find(i=>i.id==="MEM-CT02").detail,/private proof output contradicts actual recording/)
})

test("an unidentified actual capture beside diagnostics remains unavailable, not silently ignored",()=>{
  const flow=discoveryFlow(spec,"execute")
  flow.capture.discovery.turns[0].calls.push({
    tool:"mem_remember",args:structuredClone(spec.binding.args),status:"completed",
    output:flow.recording.calls[0].output,args_source:"native_guard",
  })
  assert.equal(flow.grade().verdict,"BLOCKED")
})

test("duplicated actual capture identity cannot hide a contradictory copy beside diagnostics",()=>{
  const flow=discoveryFlow(spec,"execute"),call=flow.recording.calls[0]
  const captured={tool:call.tool,args:call.args,status:call.status,output:call.output,call_id:call.call_id,args_source:"native_guard"}
  flow.capture.discovery.turns[0].calls.push(captured,{...captured,output:'{"status":"stored","record":{"id":"other"}}'})
  assert.equal(flow.grade().verdict,"FAIL")
})

for(const [label,mutate,want]of [
  ["missing journal",f=>{f.journal=null},"BLOCKED"],
  ["incomplete empty journal",f=>{f.journal.calls=[];f.journal.complete=false},"BLOCKED"],
  ["complete empty journal",f=>{f.journal.calls=[]},"FAIL"],
  ["actual missing input",f=>{delete f.journal.calls[0].args},"BLOCKED"],
  ["actual explicitly unresolved input",f=>{f.journal.calls[0].args_resolved=false},"FAIL"],
  ["actual error with missing input",f=>{delete f.journal.calls[0].args;f.journal.calls[0].status="error"},"FAIL"],
  ["foreign journal digest",f=>{f.journal.raw_sha256="0".repeat(64)},"FAIL"],
])test(`source diagnostics preserve ${label}`,()=>{
  const flow=discoveryFlow(spec,"execute")
  mutate(flow)
  flow.recording=projectMemoryRecording(flow.rawLines,flow.recording.source,flow.journal)
  assert.equal(flow.grade().verdict,want)
})

test("diagnostic arguments, failure text and apparent mutations cannot veto independently captured success",()=>{
  const flow=discoveryFlow(spec,"execute"),diagnostic=flow.capture.discovery.turns[0].calls[0]
  Object.assign(diagnostic,{tool:"mem_page",args:{action:"delete",path:"unexecuted"},status:"error",output:'{"error":"inert diagnostic"}'})
  flow.capture.discovery.turns[0].calls.push({...diagnostic})
  assert.equal(flow.grade().verdict,"PASS")
})

for(const [label,change,want] of [
  ["unresolved",c=>{c.args_resolved=false},"FAIL"],
  ["absent arguments",c=>{delete c.args},"BLOCKED"],
  ["wrong output",c=>{c.output='{"status":"stored","record":{"id":"other"}}'},"FAIL"],
  ["foreign identity",c=>{c.call_id="foreign"},"FAIL"],
])test(`actual captured ${label} is not classified as source diagnostics`,()=>{
  const flow=discoveryFlow(spec,"execute"),call=flow.recording.calls[0]
  const captured={tool:call.tool,args:call.args,status:call.status,output:call.output,call_id:call.call_id,args_source:"native_guard"}
  change(captured);flow.capture.discovery.turns[0].calls.push(captured)
  assert.equal(flow.grade().verdict,want)
})

test("mixed direct and Code Mode observations reconcile without source-site positional joins",()=>{
  const s=discoveryCases.find(s=>s.id==="deep-mem-wiki-read"),flow=discoveryFlow(s,"execute")
  const raw=flow.rawLines.map(JSON.parse),first=flow.journal.calls[0]
  raw[0].part.tool=first.tool;raw[0].part.state.input=structuredClone(first.args)
  first.call_id=raw[0].part.callID
  flow.rawLines=raw.map(JSON.stringify);reproject(flow)
  flow.capture.discovery.turns=[memoryTurn({code:0,stdout:flow.rawLines.join("\n")},{index:1,prompt:s.prompt})]
  assert.deepEqual(flow.capture.discovery.turns[0].calls.map(c=>c.args_source),["native_event","source"])
  assert.equal(flow.grade().verdict,"PASS")
  flow.capture.discovery.turns[0].calls[0].output='{"status":"read","items":[]}'
  assert.equal(flow.grade().verdict,"FAIL")
  assert.match(detail(flow),/private proof output contradicts actual recording/)
})
