import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryCases} from '../packs/mem/discovery-plan.mjs';
import {discoveryFlow} from './support/mem-discovery-flow.mjs';
import {projectMemoryRecording} from '../src/grade/adapters/mem-recording.mjs';
import {events} from '../src/trace/normalise.mjs';

for(const s of discoveryCases.filter(s=>s.write))for(const mode of ['direct','execute'])for(const variant of [
  'healthy','single args absent','surplus','surplus args absent','surplus payload absent','surplus output absent','surplus status absent','surplus identity absent','backend inventories absent','optional read','known error',
])test(`${s.id} ${mode}: ${variant}`,()=>{
  const f=discoveryFlow(s,mode),rows=f.rawLines.map(JSON.parse);
  let raw=rows.at(-2),proof=f.capture.discovery.turns[0].calls.at(-1),observed=f.journal?.calls.at(-1);
  const surplus=!['healthy','single args absent'].includes(variant);
  if(surplus){
    raw=structuredClone(raw);raw.part.callID='extra_call';raw.part.id='extra_part';rows.splice(-1,0,raw);
    proof=structuredClone(proof);f.capture.discovery.turns[0].calls.push(proof);
    if(f.journal){observed={...structuredClone(observed),call_id:'extra_observation',carrier_call_id:'extra_call'};f.journal.calls.push(observed)}
  }
  let expected=variant==='healthy'?'PASS':'FAIL';
  if(['single args absent','surplus args absent','known error'].includes(variant)){
    if(observed)delete observed.args;else delete raw.part.state.input;
    if(variant==='single args absent'||variant==='surplus args absent'&&s.family!=='memory')expected='BLOCKED';
  }
  if(variant==='surplus payload absent'){
    // Retain only supplied mutation discriminators, not expected payload content.
    const args=s.family==='memory'?{}:s.family==='sources'?{action:'sources',bind:{}}:s.family==='jobs'?{action:'jobs',job:{op:'draft'}}:{action:s.binding.args.action};
    if(observed)observed.args=args;else raw.part.state.input=args;
    proof.args=args;
  }
  if(variant==='surplus output absent'){if(observed)delete observed.output;else delete raw.part.state.output}
  if(variant==='surplus status absent'){if(observed)delete observed.status;else delete raw.part.state.status;expected='BLOCKED'}
  if(variant==='surplus identity absent'){if(observed)delete observed.call_id;else delete raw.part.callID;expected='BLOCKED'}
  if(variant==='backend inventories absent'){delete f.capture.requests;delete f.capture.discovery.requests;expected='BLOCKED'}
  if(variant==='known error'){if(observed)observed.status='error';else raw.part.state.status='error'}
  if(variant==='optional read'){
    const tool=s.family==='memory'?'mem_recall':`mem_${s.binding.tool}`;
    const args=s.family==='memory'?{query:'Quartz'}:s.family==='sources'?{action:'sources'}:s.family==='jobs'?{action:'jobs',job:{op:'templates'}}:{action:'list'};
    const output=JSON.stringify({status:'read',records:[]});Object.assign(proof,{tool,args,output});
    if(observed){Object.assign(observed,{tool,args,output});raw.part.state.input={code:`return await tools.mem.${tool.slice(4)}(${JSON.stringify(args)})`}}
    else{raw.part.tool=tool;raw.part.state.input=args}
    raw.part.state.output=output;expected='PASS';
  }
  f.rawLines=rows.map(JSON.stringify);
  if(f.journal)f.journal.raw_sha256=projectMemoryRecording(f.rawLines,f.recording.source).raw_sha256;
  f.recording=projectMemoryRecording(f.rawLines,f.recording.source,f.journal);f.trace=events({rawLines:f.rawLines});f.head.privacy.raw.sha256=f.recording.raw_sha256;
  assert.equal(f.grade().verdict,expected);
});
