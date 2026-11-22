import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryCases} from '../packs/mem/discovery-plan.mjs';
import {discoveryFlow,normalizedDiscovery} from './support/mem-discovery-flow.mjs';
import {projectMemoryRecording} from '../src/grade/adapters/mem-recording.mjs';
import {events} from '../src/trace/normalise.mjs';

const refresh=f=>{f.recording=projectMemoryRecording(f.rawLines,f.recording.source,f.journal)};
// Known-schema observations remain evidence of local contradictions, not execution credit.
for(const s of discoveryCases)for(const missing of ['complete','call_id','carrier_call_id','tool']){
  for(const attack of ['none','status','output','args']){
    if(missing==='tool'&&attack==='args')continue; // Action identity is required for payload classification.
    test(`${s.id}: ${attack} with absent ${missing}`,()=>{
      const f=discoveryFlow(s,'execute'),c=f.journal.calls.at(-1);
      if(attack==='status')c.status='error';
      if(attack==='output')c.output=JSON.stringify({error:{code:'denied'}});
      if(attack==='args')c.args.scope={all:true};
      if(missing==='complete')delete f.journal.complete;else delete c[missing];
      refresh(f);
      assert.equal(f.grade().verdict,attack==='none'?'BLOCKED':'FAIL');
    });
  }
}

for(const s of discoveryCases)for(const field of ['complete','call_id','carrier_call_id','tool','args','status','output'])for(const form of ['absent','malformed']){
  test(`${s.id}: journal ${field} ${form} without a separate contradiction`,()=>{
    const f=discoveryFlow(s,'execute'),target=field==='complete'?f.journal:f.journal.calls.at(-1);
    if(form==='absent')delete target[field];else target[field]=[];
    refresh(f);assert.equal(f.grade().verdict,form==='absent'?'BLOCKED':'FAIL');
  });
}

for(const s of discoveryCases)for(const mode of ['direct','execute'])for(const attack of ['none','status','output','mutation']){
  test(`${s.id} ${mode}: optional read is not write permission (${attack})`,()=>{
    const f=discoveryFlow(s,mode);
    const calls=f.journal?structuredClone(f.journal.calls):f.rawLines.map(JSON.parse).filter(r=>r.type==='tool_use').map(r=>({tool:r.part.tool,args:r.part.state.input,status:r.part.state.status,output:r.part.state.output}));
    const optional={tool:'mem_page',args:{action:'list'},status:'completed',output:JSON.stringify({status:'read',records:[]})};
    if(attack==='status')optional.status='error';
    if(attack==='output')optional.output=JSON.stringify({error:'denied'});
    if(attack==='mutation'){optional.tool='mem_remember';optional.args={content:'Unrequested',kind:'fact'}}
    const n=normalizedDiscovery([optional,...calls],s,mode);
    Object.assign(f,n);f.capture.discovery.turns=[n.turn];
    if(attack!=='none'){
      // Missing metadata on a different invocation cannot erase the optional call's failure.
      if(f.journal){delete f.journal.calls.at(-1).carrier_call_id;refresh(f)}
      else {const rows=f.rawLines.map(JSON.parse);delete rows.at(-2).part.callID;f.rawLines=rows.map(JSON.stringify);refresh(f);f.trace=events({rawLines:f.rawLines});f.head.privacy.raw.sha256=f.recording.raw_sha256}
    }
    assert.equal(f.grade().verdict,attack==='none'?'PASS':'FAIL');
  });
}

for(const s of discoveryCases)for(const input of ['absent','null','empty','malformed']){
  test(`${s.id}: actual direct input ${input}`,()=>{
    const f=discoveryFlow(s),rows=f.rawLines.map(JSON.parse),state=rows[0].part.state;
    if(input==='absent')delete state.input;
    else state.input=input==='null'?null:input==='empty'?{}:[];
    f.rawLines=rows.map(JSON.stringify);refresh(f);
    f.trace=events({rawLines:f.rawLines});f.head.privacy.raw.sha256=f.recording.raw_sha256;
    assert.equal(f.grade().verdict,['absent','null'].includes(input)?'BLOCKED':'FAIL');
  });
}

for(const s of discoveryCases)for(const mode of ['direct','execute']){
  for(const collection of ['outer','nested','both'])for(const missing of ['none','other requests','turns','permission'])for(const attack of ['canonical','wire','duplicate']){
    test(`${s.id} ${mode}: extra ${attack} write in ${collection}, absent ${missing}`,()=>{
      const f=discoveryFlow(s,mode);
      const template=s.write?f.capture.requests.at(-1):discoveryFlow(discoveryCases.find(c=>c.family==='memory')).capture.requests.at(-1);
      for(const rows of [collection!=='nested'&&f.capture.requests,collection!=='outer'&&f.capture.discovery.requests].filter(Boolean)){
        const extra=structuredClone(template);extra.context.case_id=s.id;
        if(attack!=='duplicate')extra[attack==='canonical'?'input':'wire_input'].unauthorized='extra payload';
        rows.push(extra);
      }
      if(missing==='other requests'){
        if(collection==='outer')delete f.capture.discovery.requests;
        else if(collection==='nested')delete f.capture.requests;
        // Both collections retain the contradiction; do not delete the attack itself.
        else delete f.capture.discovery.requests;
      }
      if(missing==='turns')delete f.capture.discovery.turns;
      if(missing==='permission')delete f.capture.discovery.permission;
      assert.equal(f.grade().verdict,'FAIL');
    });
  }
}
