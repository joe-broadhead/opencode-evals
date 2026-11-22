import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryCases} from '../packs/mem/discovery-plan.mjs';
import {discoveryFlow} from './support/mem-discovery-flow.mjs';
import {projectMemoryRecording} from '../src/grade/adapters/mem-recording.mjs';
import {events} from '../src/trace/normalise.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {renderDiscoveryCase} from '../packs/mem/discovery-plan.mjs';
import {compileCase} from '../src/case/compile.mjs';
import {main} from '../src/cli.mjs';
import {memoryTurn} from '../src/run/mem-turns.mjs';

const foreign={id:'foreign-created',case_id:'foreign',trial_id:'foreign',turn:1,session:'foreign',tool:'mem_remember',args:{content:'foreign',kind:'fact'},status:'stored'};
for(const s of discoveryCases)for(const mode of ['direct','execute'])for(const [label,mutate] of [
  ['outer hidden file',f=>f.capture.after.personal.raw['foreign.md']='UNAUTHORIZED'],
  ['outer denied request',f=>f.capture.requests.at(-1).status='denied'],
  ['outer changed seed',f=>f.capture.before.shared.raw['foreign.md']='FOREIGN'],
  ['extra foreign creator',f=>f.capture.discovery.creators.push(structuredClone(foreign))],
  ['orphan creator',f=>f.capture.discovery.creators.push({...structuredClone(foreign),case_id:s.id,trial_id:'spec_trial',session:'ses_spec',tool:`mem_${s.binding.tool}`,args:structuredClone(s.binding.args)})],
  ['duplicate creator',f=>{const c=f.capture.discovery.creators[0]??foreign;f.capture.discovery.creators.push(structuredClone(c),structuredClone(c))}],
])test(`${s.id} ${mode}: ${label} fails`,()=>{
  const f=discoveryFlow(s,mode);mutate(f);assert.equal(f.grade().verdict,'FAIL');
});

test('even a sole literal returned await without native observations is BLOCKED',()=>{
  for(const s of discoveryCases){
    const f=discoveryFlow(s,'execute');
    f.recording=projectMemoryRecording(f.rawLines,{case_id:s.id,trial:1});
    assert.equal(f.grade().verdict,'BLOCKED');
  }
});

test('a source-derived empty proof is not an authoritative empty native journal',()=>{
  const s=discoveryCases.find(s=>s.family==='exact-read'),f=discoveryFlow(s,'execute'),rows=f.rawLines.map(JSON.parse);
  for(const row of rows)if(row.type==='tool_use')row.part.state.input={code:'return {}'};
  f.rawLines=rows.map(JSON.stringify);f.trace=events({rawLines:f.rawLines});
  f.recording=projectMemoryRecording(f.rawLines,{case_id:s.id,trial:1});f.head.privacy.raw.sha256=f.recording.raw_sha256;
  f.capture.discovery.turns=[memoryTurn({code:0,stdout:f.rawLines.join('\n')},{index:1,prompt:s.prompt})];
  assert.equal(f.grade().verdict,'BLOCKED');
});

test('a scoped complete empty native journal is authoritative and never falls back to source',()=>{
  for(const s of discoveryCases){
    const f=discoveryFlow(s,'execute');
    const journal={schema:'oc-mem-invocations/1',scope:{case_id:s.id,trial:1,trial_id:'spec_trial',turn:1,session:'ses_spec'},raw_sha256:f.recording.raw_sha256,complete:true,calls:[]};
    f.recording=projectMemoryRecording(f.rawLines,{case_id:s.id,trial:1},journal);
    assert.equal(f.grade().verdict,'FAIL');
  }
});

test('journal scope, carrier identity, completeness and independently observed outcomes govern execution',()=>{
  for(const s of discoveryCases)for(const [label,mutate,expected] of [
    ['healthy',()=>{},'PASS'],
    ['incomplete empty',j=>{j.complete=false;j.calls=[]},'BLOCKED'],
    ['incomplete prefix',j=>{j.complete=false;j.calls=j.calls.slice(0,1)},'BLOCKED'],
    ['future journal',j=>j.schema='oc-mem-invocations/2','BLOCKED'],
    ['missing scope',j=>delete j.scope,'BLOCKED'],
    ['missing digest',j=>delete j.raw_sha256,'BLOCKED'],
    ['missing completeness',j=>delete j.complete,'BLOCKED'],
    ['missing call identity',j=>delete j.calls[0].call_id,'BLOCKED'],
    ['foreign case',j=>j.scope.case_id='foreign','FAIL'],
    ['foreign physical trial',j=>j.scope.trial=22,'FAIL'],
    ['foreign semantic trial',j=>j.scope.trial_id='foreign','FAIL'],
    ['foreign session',j=>j.scope.session='foreign','FAIL'],
    ['foreign turn',j=>j.scope.turn=2,'FAIL'],
    ['foreign raw digest',j=>j.raw_sha256='0'.repeat(64),'FAIL'],
    ['orphan carrier',j=>j.calls[0].carrier_call_id='foreign','FAIL'],
    ['duplicate observation',j=>j.calls.push(structuredClone(j.calls[0])),'FAIL'],
    ['native error despite completed carrier',j=>j.calls[0].status='error','FAIL'],
    ['native no data despite healthy carrier',j=>j.calls[0].output='{}','FAIL'],
    ['native args contradict source/proof',j=>j.calls.at(-1).args.scope={all:true},'FAIL'],
    ['incomplete but denied',j=>{j.complete=false;j.calls[0].status='error'},'FAIL'],
  ]){
    const f=discoveryFlow(s,'execute'),j=structuredClone(f.journal);mutate(j);
    f.recording=projectMemoryRecording(f.rawLines,{case_id:s.id,trial:1},j);
    assert.equal(f.grade().verdict,expected,label);
  }
});

test('source sites cannot grant, deny, or count native executions',()=>{
  for(const s of discoveryCases)for(const code of ['return {ok:true};','if(false){await tools.mem.remember({content:"Not executed",kind:"fact"})}','for(const args of supplied){await tools.mem.page(args)}']){
    const f=discoveryFlow(s,'execute'),rows=f.rawLines.map(JSON.parse);
    for(const row of rows)if(row.type==='tool_use')row.part.state.input={code};
    f.rawLines=rows.map(JSON.stringify);
    // Structural provenance follows source; native observations stay frozen and independent.
    f.journal.raw_sha256=projectMemoryRecording(f.rawLines,{case_id:s.id,trial:1}).raw_sha256;
    f.recording=projectMemoryRecording(f.rawLines,{case_id:s.id,trial:1},f.journal);
    f.head.privacy.raw.sha256=f.recording.raw_sha256;
    f.trace=events({rawLines:f.rawLines});
    assert.equal(f.grade().verdict,'PASS');
    f.recording=projectMemoryRecording(f.rawLines,{case_id:s.id,trial:1});
    assert.equal(f.grade().verdict,'BLOCKED');
  }
});

test('an incomplete journal cannot hide independently recorded direct contradictions',()=>{
  const s=discoveryCases.find(s=>s.family==='memory'),f=discoveryFlow(s),rows=f.rawLines.map(JSON.parse);
  rows[0].part.state.input.scope={all:true};f.rawLines=rows.map(JSON.stringify);
  const source={case_id:s.id,trial:1},j={schema:'oc-mem-invocations/1',scope:{...source,trial_id:'spec_trial',turn:1,session:'ses_spec'},raw_sha256:projectMemoryRecording(f.rawLines,source).raw_sha256,complete:false,calls:[]};
  f.recording=projectMemoryRecording(f.rawLines,source,j);f.trace=events({rawLines:f.rawLines});f.head.privacy.raw.sha256=f.recording.raw_sha256;
  delete f.capture.discovery.turns;
  assert.equal(f.grade().verdict,'FAIL');
});

test('multiple native observations can bind one carrier without using source call-site counts',()=>{
  const s=discoveryCases.find(s=>s.family==='exact-read'),f=discoveryFlow(s,'execute');
  const rows=f.rawLines.map(JSON.parse);rows.splice(1,1);f.rawLines=rows.map(JSON.stringify);
  f.journal.calls[1].carrier_call_id=f.journal.calls[0].carrier_call_id;
  f.journal.raw_sha256=projectMemoryRecording(f.rawLines,{case_id:s.id,trial:1}).raw_sha256;
  f.recording=projectMemoryRecording(f.rawLines,{case_id:s.id,trial:1},f.journal);f.trace=events({rawLines:f.rawLines});f.head.privacy.raw.sha256=f.recording.raw_sha256;
  assert.equal(f.grade().verdict,'PASS');
  f.journal.calls.reverse();f.recording=projectMemoryRecording(f.rawLines,{case_id:s.id,trial:1},f.journal);
  assert.equal(f.grade().verdict,'FAIL');
});

test('all supplied creators are closed, unique and linked; missing independent fragments never hide R2',()=>{
  for(const s of discoveryCases)for(const mode of ['direct','execute'])for(const missing of ['permission','journal','nested state','outer state','nested requests','outer requests','native turn']){
    for(const [dependency,attack] of [
      ['outer state',f=>f.capture.after.personal.raw['foreign.md']='UNAUTHORIZED'],
      ['outer requests',f=>f.capture.requests.at(-1).status='denied'],
      [null,f=>f.capture.discovery.creators.push(structuredClone(foreign))],
      [null,f=>f.capture.creators=[structuredClone(foreign)]],
    ]){
      if(missing===dependency)continue;
      const f=discoveryFlow(s,mode);attack(f);
      // Omit only independent fragments; do not remove the attacked evidence itself.
      if(missing==='nested state')delete f.capture.discovery.state;
      if(missing==='nested requests')delete f.capture.discovery.requests;
      if(missing==='native turn')delete f.capture.discovery.turns;
      if(missing==='permission')delete f.capture.discovery.permission;
      if(missing==='outer state')delete f.capture.after;
      if(missing==='outer requests')delete f.capture.requests;
      if(missing==='journal')f.recording=projectMemoryRecording(f.rawLines,{case_id:s.id,trial:1});
      assert.equal(f.grade().verdict,'FAIL',`${s.id} ${mode} missing ${missing} attacked ${dependency??'creator'}`);
    }
  }
});

test('real pure CLI consumes native observations and rejects R2 contradictions without leaking private data',async()=>{
  const root=mkdtempSync(join(tmpdir(),'r2-native-cli-')),cases=join(root,'cases'),traces=join(root,'traces'),raw=join(root,'raw'),native=join(raw,'r2','mem'),out=join(root,'out'),expected=[];
  const scenarios=[
    ['healthy',()=>{},m=> 'PASS'],
    ['outer hidden file',f=>f.capture.after.personal.raw['foreign.md']='UNAUTHORIZED',m=>'FAIL'],
    ['outer denied request',f=>f.capture.requests.at(-1).status='denied',m=>'FAIL'],
    ['foreign creator',f=>f.capture.discovery.creators.push(structuredClone(foreign)),m=>'FAIL'],
    ['no journal',f=>f.journal=null,m=>m==='execute'?'BLOCKED':'PASS'],
    ['complete empty',f=>{f.journal=f.journal??{schema:'oc-mem-invocations/1',scope:{case_id:f.capture.discovery.case_id,trial:1,trial_id:'spec_trial',turn:1,session:'ses_spec'},raw_sha256:f.recording.raw_sha256};f.journal.complete=true;f.journal.calls=[]},m=>'FAIL'],
    ['incomplete empty',f=>{f.journal={schema:'oc-mem-invocations/1',scope:{case_id:f.capture.discovery.case_id,trial:1,trial_id:'spec_trial',turn:1,session:'ses_spec'},raw_sha256:f.recording.raw_sha256,complete:false,calls:[]}},m=>'BLOCKED'],
    ['known contradiction without journal',f=>{f.journal=null;f.capture.requests.at(-1).status='denied'},m=>'FAIL'],
    ['malformed journal',f=>{f.journal={schema:'malformed'}},m=>'FAIL'],
  ];
  try{
    for(const d of [cases,traces,native])mkdirSync(d,{recursive:true});
    for(const s of discoveryCases.filter(s=>['exact-read','sources','jobs'].includes(s.family)&&!s.id.endsWith('-p'))){
      writeFileSync(join(cases,s.id+'.md'),renderDiscoveryCase(s));writeFileSync(join(cases,s.id+'.json'),JSON.stringify(compileCase(s.id+'.md',renderDiscoveryCase(s))));
      for(const [mi,mode] of ['direct','execute'].entries())for(const [vi,[label,mutate,result]] of scenarios.entries()){
        const f=discoveryFlow(s,mode),trial=mi*scenarios.length+vi+1,base=join(native,`${s.id}.t${trial}`);mutate(f);
        writeFileSync(join(traces,`${s.id}.t${trial}.trace.jsonl`),[f.head,...f.trace].map(JSON.stringify).join('\n'));
        writeFileSync(base+'.jsonl',f.rawLines.join('\n'));
        writeFileSync(base+'.files.json',JSON.stringify([{path:'mem-fixture/capture.json',change:'added',text:JSON.stringify(f.capture)}]));
        writeFileSync(base+'.guard.jsonl',JSON.stringify({kind:'guard_start',case_id:s.id,trial_id:'spec_trial'}));
        if(f.journal){const j=structuredClone(f.journal);if(j.scope)j.scope.trial=trial;writeFileSync(base+'.mem-invocations.json',JSON.stringify(j))}
        expected.push({id:s.id,trial,result:result(mode),label});
      }
    }
    const log=console.log;try{console.log=()=>{};await main(['grade','--plugin','mem','--cases',cases,'--traces',traces,'--raw',raw,'--out',out,'--iteration','r2'])}finally{console.log=log}
    const results=JSON.parse(readFileSync(join(out,'verdicts.json')));assert.equal(results.length,54);
    for(const r of results){const e=expected.find(e=>e.id===r.case&&e.trial===r.trial);assert.equal(r.verdict,e.result,e.label);assert.equal(JSON.stringify(r).includes('ses_spec'),false)}
  }finally{rmSync(root,{recursive:true,force:true});assert.equal(existsSync(root),false)}
});
