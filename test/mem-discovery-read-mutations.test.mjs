import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryCases} from '../packs/mem/discovery-plan.mjs';
import {discoveryFlow,normalizedDiscovery} from './support/mem-discovery-flow.mjs';
import {projectMemoryRecording} from '../src/grade/adapters/mem-recording.mjs';
import {events} from '../src/trace/normalise.mjs';

function refresh(f,raw){
  f.rawLines=raw.map(JSON.stringify);
  if(f.journal)f.journal.raw_sha256=projectMemoryRecording(f.rawLines,f.recording.source).raw_sha256;
  f.recording=projectMemoryRecording(f.rawLines,f.recording.source,f.journal);
  f.trace=events({rawLines:f.rawLines});f.head.privacy.raw.sha256=f.recording.raw_sha256;
}

for(const s of discoveryCases.filter(s=>!s.write))for(const mode of ['direct','execute'])for(const prefix of ['mem_','mem.'])for(const variant of [
  'remember args absent','page export','page export inventories absent','status absent','identity absent','inventories absent','page action absent','optional read',
])test(`${s.id} ${mode} ${prefix}: ${variant}`,()=>{
  const f=discoveryFlow(s,mode),calls=structuredClone(f.capture.discovery.turns[0].calls);
  const exporting=variant.startsWith('page export'),page=exporting||['page action absent','optional read'].includes(variant);
  calls.push({tool:prefix+(page?'page':'remember'),args:page?{action:exporting?'export':'list'}:{content:'Extra',kind:'fact'},status:'completed',output:JSON.stringify({status:variant==='optional read'?'read':'stored'})});
  const n=normalizedDiscovery(calls,s,mode);Object.assign(f,n);f.capture.discovery.turns=[n.turn];
  const raw=f.rawLines.map(JSON.parse),proof=f.capture.discovery.turns[0].calls.at(-1),actual=f.journal?.calls.at(-1)??raw.at(-2).part.state;
  if(!exporting&&variant!=='optional read'){
    delete proof.args;delete actual[mode==='direct'?'input':'args'];
  }
  if(variant==='status absent'){delete proof.status;delete actual.status}
  if(variant==='identity absent'){
    if(f.journal)delete actual.call_id;else delete raw.at(-2).part.callID;
  }
  if(variant.endsWith('inventories absent')){delete f.capture.requests;delete f.capture.discovery.requests}
  refresh(f,raw);
  assert.equal(f.grade().verdict,exporting||variant==='remember args absent'?'FAIL':variant==='optional read'?'PASS':'BLOCKED');
});

for(const s of discoveryCases.filter(s=>!s.write))test(`${s.id}: source-only mutation text is not an invocation`,()=>{
  const f=discoveryFlow(s,'execute'),raw=f.rawLines.map(JSON.parse);
  const operations=JSON.stringify(f.journal.calls),observations=JSON.stringify(f.recording.calls),scope=structuredClone(f.journal.scope);
  raw.at(-2).part.state.input.code+='; // tools.mem.remember({content:"Unauthorized",kind:"fact"})';
  // C1: the complete independent journal, not the extra source site, defines actual coverage.
  refresh(f,raw);
  assert.equal(JSON.stringify(f.journal.calls),operations);
  assert.equal(JSON.stringify(f.recording.calls),observations);
  assert.deepEqual(f.journal.scope,scope);
  assert.equal(f.journal.complete,true);assert.equal(f.recording.execution_complete,true);
  assert.equal(f.grade().verdict,'PASS');
});
