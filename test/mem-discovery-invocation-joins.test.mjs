import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryCases} from '../packs/mem/discovery-plan.mjs';
import {discoveryFlow} from './support/mem-discovery-flow.mjs';
import {projectMemoryRecording} from '../src/grade/adapters/mem-recording.mjs';
import {events} from '../src/trace/normalise.mjs';

function refresh(f){
  const source=f.recording.source;
  if(f.journal)f.journal.raw_sha256=projectMemoryRecording(f.rawLines,source).raw_sha256;
  f.recording=projectMemoryRecording(f.rawLines,source,f.journal);
  f.trace=events({rawLines:f.rawLines});f.head.privacy.raw.sha256=f.recording.raw_sha256;
}

for(const s of discoveryCases)for(const missing of ['complete','call_id','carrier_call_id'])for(const [label,output,expected] of [
  ['plain error','{"error":"denied"}','FAIL'],
  ['prefix error','Result:\n{"error":"denied"}','FAIL'],
  ['suffix nested error','{"result":{"status":"failed"}}\nCompleted.','FAIL'],
  ['fenced error','```json\n{"ok":false}\n```','FAIL'],
  ['success with prose','Error examples are documented.\n{"status":"read","records":[]}\nNo error occurred.','BLOCKED'],
  ['quoted error content',JSON.stringify({status:'read',body:'Example: {"error":"denied"}'}),'BLOCKED'],
  ['absent output',undefined,'BLOCKED'],
])test(`${s.id}: ${label} with missing ${missing}`,()=>{
  const f=discoveryFlow(s,'execute');
  if(missing==='complete')delete f.journal.complete;else delete f.journal.calls.at(-1)[missing];
  if(output===undefined)delete f.journal.calls.at(-1).output;else f.journal.calls.at(-1).output=output;
  refresh(f);assert.equal(f.grade().verdict,expected);
});

for(const s of discoveryCases)test(`${s.id}: future journal error fields remain uninterpreted`,()=>{
  const f=discoveryFlow(s,'execute');f.journal.schema='oc-mem-invocations/2';f.journal.calls.at(-1).output='Result:\n{"error":"denied"}';
  refresh(f);assert.equal(f.grade().verdict,'BLOCKED');
});
function directJournal(f){
  f.journal={schema:'oc-mem-invocations/1',scope:{...f.recording.source,trial_id:'spec_trial',turn:1,session:'ses_spec'},raw_sha256:f.recording.raw_sha256,complete:true,calls:f.rawLines.map(JSON.parse).filter(r=>r.type==='tool_use').map(r=>({call_id:r.part.callID,carrier_call_id:r.part.callID,tool:r.part.tool,args:r.part.state.input,status:r.part.state.status,output:r.part.state.output}))};
}

for(const s of discoveryCases)for(const mode of ['direct','execute'])for(const index of [0,-1])test(`${s.id} ${mode}: absent raw identity at ${index} cannot join another unidentified proof call`,()=>{
  const f=discoveryFlow(s,mode),rows=f.rawLines.map(JSON.parse);
  delete rows.filter(r=>r.type==='tool_use').at(index).part.callID;f.rawLines=rows.map(JSON.stringify);
  refresh(f);assert.equal(f.grade().verdict,'BLOCKED');
});

for(const s of discoveryCases)for(const field of ['args','status','output'])for(const missing of ['raw','journal','both'])for(const failure of [false,true]){
  if(missing==='both'&&failure)continue; // No supplied value remains to contradict the other copy.
  test(`${s.id}: direct ${field} absent from ${missing}, opposite failure ${failure}`,()=>{
    const f=discoveryFlow(s);directJournal(f);
    const rows=f.rawLines.map(JSON.parse),raw=rows.at(-2).part.state,journal=f.journal.calls.at(-1),rawKey=field==='args'?'input':field;
    if(missing!=='journal')delete raw[rawKey];
    if(missing!=='raw')delete journal[field];
    if(failure){
      const target=missing==='raw'?journal:raw,key=missing==='raw'?field:rawKey;
      if(field==='args')target[key]={...target[key],scope:{all:true}};
      else target[key]=field==='status'?'error':'{"error":"denied"}';
    }
    f.rawLines=rows.map(JSON.stringify);refresh(f);
    assert.equal(f.grade().verdict,failure?'FAIL':'BLOCKED');
  });
}

for(const s of discoveryCases.filter(s=>s.write))for(const mode of ['direct','execute'])for(const missing of ['none','outer','nested','both']){
  test(`${s.id} ${mode}: surplus actual write with ${missing} backend inventory absent`,()=>{
    const f=discoveryFlow(s,mode),rows=f.rawLines.map(JSON.parse),extra=structuredClone(rows.at(-2));
    extra.part.callID='extra_call';extra.part.id='extra_part';rows.splice(-1,0,extra);f.rawLines=rows.map(JSON.stringify);
    f.capture.discovery.turns[0].calls.push(structuredClone(f.capture.discovery.turns[0].calls.at(-1)));
    if(f.journal)f.journal.calls.push({...structuredClone(f.journal.calls.at(-1)),call_id:'extra_invocation',carrier_call_id:'extra_call'});
    if(['outer','both'].includes(missing))delete f.capture.requests;
    if(['nested','both'].includes(missing))delete f.capture.discovery.requests;
    refresh(f);assert.equal(f.grade().verdict,missing==='both'?'BLOCKED':'FAIL');
  });
}

for(const s of discoveryCases)for(const mode of ['direct','execute'])for(const field of ['args','status','output'])for(const index of [0,-1])for(const wrong of [false,true]){
  test(`${s.id} ${mode}: missing ${field} at ${index}, independent output contradiction ${wrong}`,()=>{
    const f=discoveryFlow(s,mode);
    if(f.journal){
      delete f.journal.calls.at(index)[field];
      if(wrong)f.journal.calls.at(-1).output='{"status":"read","records":[]}';
    }else{
      const rows=f.rawLines.map(JSON.parse),calls=rows.filter(r=>r.type==='tool_use');
      delete calls.at(index).part.state[field==='args'?'input':field];
      if(wrong)calls.at(-1).part.state.output='{"status":"read","records":[]}';
      f.rawLines=rows.map(JSON.stringify);
    }
    refresh(f);assert.equal(f.grade().verdict,wrong?'FAIL':'BLOCKED');
  });
}
