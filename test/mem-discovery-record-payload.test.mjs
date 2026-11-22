import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryCases} from '../packs/mem/discovery-plan.mjs';
import {discoveryFlow} from './support/mem-discovery-flow.mjs';

const specs=discoveryCases.filter(s=>['memory','page','commitment'].includes(s.family));
for(const s of specs)for(const mode of ['direct','execute']){
  for(const [label,value,expected] of [['absent',undefined,'BLOCKED'],['null',null,'BLOCKED'],['array',[],'FAIL'],['string','wire','FAIL'],['number',0,'FAIL'],['boolean',false,'FAIL']])test(`${s.id} ${mode}: wire envelope ${label}`,()=>{
    const f=discoveryFlow(s,mode);
    for(const rows of [f.capture.requests,f.capture.discovery.requests]){
      if(label==='absent')delete rows.at(-1).wire_input;else rows.at(-1).wire_input=value;
    }
    assert.equal(f.grade().verdict,expected);
  });
  for(const record of ['present','absent','null','array'])for(const [label,value] of [
    ['absent',undefined],['true',true],['false',false],['null',null],['string','true'],['number',1],['array',[]],['object',{}],
  ])for(const extra of [false,true])test(`${s.id} ${mode}: record ${record}, upsert ${label}, extra key ${extra}`,()=>{
    const f=discoveryFlow(s,mode);
    for(const rows of [f.capture.requests,f.capture.discovery.requests]){
      const wire=rows.at(-1).wire_input;
      if(record==='absent')delete wire.record;
      if(record==='null')wire.record=null;
      if(record==='array')wire.record=[];
      if(label==='absent')delete wire.upsert_path;else wire.upsert_path=value;
      if(extra)wire.unauthorized='synthetic forbidden payload';
    }
    const invalid=extra||record==='array'||label!=='absent'&&!(s.family==='page'&&value===true);
    assert.equal(f.grade().verdict,invalid?'FAIL':record==='present'?'PASS':'BLOCKED');
  });
  for(const session of ['present','absent'])for(const [label,mutate,expected] of [
    ['valid source',()=>{},'PASS'],
    ['source absent',r=>delete r.source,'PASS'],
    ['source extra key',r=>r.source.unauthorized=true,'FAIL'],
    ['source invalid session',r=>r.source.session=7,'FAIL'],
    ['source array',r=>r.source=[],'FAIL'],
    ['source null with sibling violation',r=>{r.source=null;r.unauthorized=true},'FAIL'],
    ['source absent with sibling violation',r=>{delete r.source;r.unauthorized=true},'FAIL'],
    ['unknown record type',r=>r.type='unrecognized','FAIL'],
    ['invalid stated_by',r=>r.stated_by=[],'FAIL'],
  ])test(`${s.id} ${mode}: ${label}, native session ${session}`,()=>{
    // The optional source-absence control starts without metadata in every evidence copy.
    const f=discoveryFlow(s,mode,label==='source absent'?{}:{recordMetadata:{source:{session:'ses_spec'}}});
    for(const rows of [f.capture.requests,f.capture.discovery.requests])mutate(rows.at(-1).wire_input.record);
    if(session==='absent')delete f.capture.discovery.turns[0].session;
    assert.equal(f.grade().verdict,expected==='PASS'&&session==='absent'?'BLOCKED':expected);
  });
}
