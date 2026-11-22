import {test} from "node:test"
import assert from "node:assert/strict"
import {discoveryCases} from "../packs/mem/discovery-plan.mjs"
import {discoveryFlow} from "./support/mem-discovery-flow.mjs"
import {projectMemoryRecording} from "../src/grade/adapters/mem-recording.mjs"
import {memoryTurn} from "../src/run/mem-turns.mjs"
import {events} from "../src/trace/normalise.mjs"

const deadWrite='if(false) await tools.mem.page({action:"delete",path:"unexecuted"}); '
function refresh(f,raw){
  f.rawLines=raw.map(JSON.stringify)
  if(f.journal)f.journal.raw_sha256=projectMemoryRecording(f.rawLines,f.recording.source).raw_sha256
  f.recording=projectMemoryRecording(f.rawLines,f.recording.source,f.journal)
  f.head.privacy.raw.sha256=f.recording.raw_sha256
  f.trace=events({rawLines:f.rawLines})
}
function sourceFlow(id,prefix=deadWrite,mixed=false){
  const spec=discoveryCases.find(s=>s.id===id),f=discoveryFlow(spec,"execute"),raw=f.rawLines.map(JSON.parse)
  if(mixed){
    const call=f.journal.calls[0]
    raw[0].part.tool=call.tool;raw[0].part.state.input=structuredClone(call.args)
    call.call_id=raw[0].part.callID
  }
  const actual=JSON.stringify(f.journal.calls),backend=JSON.stringify(f.capture)
  const carrier=raw.find(r=>r.part?.tool==="execute")
  carrier.part.state.input.code=prefix+carrier.part.state.input.code
  refresh(f,raw)
  assert.equal(JSON.stringify(f.journal.calls),actual,"source edit preserves actual operation bytes")
  assert.equal(JSON.stringify(f.capture),backend,"source edit preserves backend/state evidence")
  assert.equal(f.recording.execution_complete,true)
  assert.equal(f.recording.calls.length,f.journal.calls.length)
  f.capture.discovery.turns=[memoryTurn({code:0,stdout:f.rawLines.join("\n")},{index:1,prompt:spec.prompt})]
  return f
}

test("dead source write has no required outcome when the actual journal is complete",()=>{
  const f=sourceFlow("commit-mem-memory")
  assert.equal(f.recording.calls.length,1)
  assert.ok(f.trace.some(e=>e.kind==="note"&&e.note==="inner-counts-not-attributable"))
  assert.equal(f.grade().verdict,"PASS")
})

const deadRead='if(false) await tools.mem.page({action:"list"}); '
for(const [id,prefix]of [["commit-mem-memory",deadRead],["deep-mem-code",deadRead],["deep-mem-code",deadWrite]]){
  test(`${id}: a dead source ${prefix===deadRead?"read":"write"} does not change actual coverage`,()=>{
    assert.equal(sourceFlow(id,prefix).grade().verdict,"PASS")
  })
}
for(const prefix of [deadRead,deadWrite])test(`mixed direct/inner observations tolerate a dead source ${prefix===deadRead?"read":"write"}`,()=>{
  const f=sourceFlow("deep-mem-code",prefix,true)
  assert.equal(f.recording.direct_calls.length,1)
  assert.equal(f.recording.calls.length,3)
  assert.equal(f.grade().verdict,"PASS")
})

for(const [label,change,want]of [
  ["missing inner carrier status",(f,raw)=>{delete raw[1].part.state.status},"BLOCKED"],
  ["failed inner carrier",(f,raw)=>{raw[1].part.state.status="error"},"FAIL"],
  ["missing direct status",(f,raw)=>{delete raw[0].part.state.status;delete f.journal.calls[0].status},"BLOCKED"],
  ["failed direct call",(f,raw)=>{raw[0].part.state.status="error";f.journal.calls[0].status="error"},"FAIL"],
  ["missing actual inner status",f=>{delete f.journal.calls.at(-1).status},"BLOCKED"],
  ["missing actual identity",f=>{delete f.journal.calls.at(-1).call_id},"BLOCKED"],
  ["incomplete journal",f=>{f.journal.complete=false},"BLOCKED"],
  ["absent journal",f=>{f.journal=null},"BLOCKED"],
  ["failed actual inner call",f=>{f.journal.calls.at(-1).status="error"},"FAIL"],
  ["backend rejection",f=>{for(const rows of [f.capture.requests,f.capture.discovery.requests])rows.at(-1).http_status=403},"FAIL"],
])test(`dead source site cannot hide mixed-flow ${label}`,()=>{
  const f=sourceFlow("deep-mem-code",deadWrite,true),raw=f.rawLines.map(JSON.parse)
  change(f,raw);refresh(f,raw)
  assert.equal(f.grade().verdict,want)
})

for(const [label,change]of [
  ["parent",(f,c)=>{c.parent_seq=9999}],
  ["argument digest",(f,c)=>{c.args_sha256="0".repeat(64)}],
  ["omitted source row",(f,c)=>{f.trace=f.trace.filter(e=>e!==c)}],
  ["duplicate source result",(f,c)=>{for(let i=0;i<2;i++)f.trace.push({kind:"tool_result",seq:900+i,for_seq:c.seq,status:"ok"})}],
])test(`source diagnostics still require structural binding: ${label}`,()=>{
  const f=sourceFlow("commit-mem-memory"),call=f.trace.find(e=>e.kind==="tool_call"&&e.parent_seq!==undefined)
  assert.ok(call);change(f,call)
  assert.equal(f.grade().verdict,"FAIL")
})
