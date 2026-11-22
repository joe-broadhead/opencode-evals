// Actual raw recordings are frozen independently before private-proof mutations.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoveryCases,renderDiscoveryCase} from '../packs/mem/discovery-plan.mjs';
import {discoveryFlow} from './support/mem-discovery-flow.mjs';
import {projectMemoryRecording} from '../src/grade/adapters/mem-recording.mjs';
import {events} from '../src/trace/normalise.mjs';
import {extractInnerCalls} from '../src/trace/innerArgs.mjs';
import {compileCase} from '../src/case/compile.mjs';
import {gradeCase,runView} from '../src/grade/grade.mjs';
import {adapterState} from '../src/grade/adapters/index.mjs';
import {main} from '../src/cli.mjs';
import {memoryTurn} from '../src/run/mem-turns.mjs';

function actual(f,mutate,{keepTrace=false,keepHead=false}={}){
  const rows=f.rawLines.map(JSON.parse);mutate(rows);
  const source=f.recording.source;
  f.rawLines=rows.map(JSON.stringify);f.recording=projectMemoryRecording(f.rawLines,source);
  if(!keepTrace)f.trace=events({rawLines:f.rawLines});
  if(!keepHead)f.head={schema:'oc-trace/1',privacy:{raw:{sha256:f.recording.raw_sha256}}};
}
function grade(s,f,{guardLog=[{kind:'guard_start',case_id:s.id,trial_id:'spec_trial'}],text=f.recording?.text??null}={}){
  return gradeCase(compileCase(s.id+'.md',renderDiscoveryCase(s)),runView([f.head,...f.trace],{memoryRecording:f.recording,text,guardLog,state:adapterState('mem',[{path:'mem-fixture/capture.json',change:'added',text:JSON.stringify(f.capture)}])}));
}
const verdict=(r,expected)=>{assert.equal(r.verdict,expected);assert.equal(r.items.find(i=>i.id==='MEM-CT02').results[0].state,expected==='PASS'?'ok':expected==='BLOCKED'?'unverifiable':'fail')};

test('actual private answer, session, and invocation status independently contradict healthy fixture proof',()=>{
  const s=discoveryCases.find(s=>s.family==='exact-read');
  for(const mode of ['direct','execute'])for(const mutate of [
    rows=>{rows.at(-1).part.text='Incorrect actual result'},
    rows=>{for(const r of rows)r.sessionID='ses_foreign_actual'},
    rows=>{const r=rows.find(r=>r.type==='tool_use');r.part.state.status='error';r.part.state.output='Invocation failed'},
    rows=>{rows.find(r=>r.type==='tool_use').part.state.output='{}'},
  ]){const f=discoveryFlow(s,mode);actual(f,mutate);verdict(grade(s,f),'FAIL')}
});

test('every discovery case has direct and inner positives through actual pure CLI grade, with private contradictions kept independent',async()=>{
  const root=mkdtempSync(join(tmpdir(),'discovery-recording-cli-')),cases=join(root,'cases'),traces=join(root,'traces'),raw=join(root,'raw'),native=join(raw,'lineage','mem'),out=join(root,'out'),expected=[];
  try{
    for(const dir of [cases,traces,native])mkdirSync(dir,{recursive:true});
    for(const s of discoveryCases){
      writeFileSync(join(cases,s.id+'.md'),renderDiscoveryCase(s));writeFileSync(join(cases,s.id+'.json'),JSON.stringify(compileCase(s.id+'.md',renderDiscoveryCase(s))));
      const variants=[['healthy',null,'PASS'],['wrong actual answer',rows=>{rows.at(-1).part.text='Incorrect actual result'},'FAIL'],['foreign actual session',rows=>{for(const r of rows)r.sessionID='ses_foreign_actual'},'FAIL'],['failed actual invocation',rows=>{rows[0].part.state.status='error';rows[0].part.state.output='Invocation failed'},'FAIL']];
      for(const [mi,mode]of ['direct','execute'].entries())for(const [vi,[label,mutate,result]]of variants.entries()){
        const trial=mi*variants.length+vi+1,f=discoveryFlow(s,mode);if(mutate)actual(f,mutate);
        const base=join(native,`${s.id}.t${trial}`);
        writeFileSync(join(traces,`${s.id}.t${trial}.trace.jsonl`),[f.head,...f.trace].map(JSON.stringify).join('\n'));
        writeFileSync(base+'.jsonl',f.rawLines.join('\n'));
        writeFileSync(base+'.files.json',JSON.stringify([{path:'mem-fixture/capture.json',change:'added',text:JSON.stringify(f.capture)}]));
        writeFileSync(base+'.guard.jsonl',JSON.stringify({kind:'guard_start',case_id:s.id,trial_id:'spec_trial'}));
        expected.push({id:s.id,trial,label,result});
      }
    }
    const old=console.log;try{console.log=()=>{};await main(['grade','--plugin','mem','--cases',cases,'--traces',traces,'--raw',raw,'--out',out,'--iteration','lineage'])}finally{console.log=old}
    const results=JSON.parse(readFileSync(join(out,'verdicts.json')));
    assert.equal(results.length,192);
    for(const r of results){const row=expected.find(x=>x.id===r.case&&x.trial===r.trial);assert.ok(row);assert.equal(r.verdict,row.result,`${row.label} classification`)}
  }finally{rmSync(root,{recursive:true,force:true});assert.equal(existsSync(root),false)}
});

test('recorded order, identity, digest, outcome and attributed execution are independently bound',()=>{
  const s=discoveryCases.find(s=>s.family==='exact-read');
  for(const mode of ['direct','execute']){
    for(const [label,mutate,options,expected='FAIL']of [
      ['wrong order',rows=>{[rows[0],rows[1]]=[rows[1],rows[0]]}],
      ['duplicate actual call identity',rows=>{rows[1].part.callID=rows[0].part.callID}],
      ['duplicate actual part identity',rows=>{rows[1].part.id=rows[0].part.id}],
      ['replayed call',rows=>{rows.splice(1,0,structuredClone(rows[0]))}],
      ['call identity changed after trace capture',rows=>{rows[0].part.callID='different_actual_identity'},{keepHead:true}],
      ['actual source with missing identity',rows=>{delete rows[0].part.callID},null,'BLOCKED'],
    ]){const f=discoveryFlow(s,mode);actual(f,mutate,options??{});assert.equal(grade(s,f).verdict,expected,label)}
    for(const [label,mutate,expected]of [
      ['projection absent',f=>f.recording=null,'BLOCKED'],
      ['recording source digest absent',f=>delete f.head.privacy.raw.sha256,'BLOCKED'],
      ['projection identity digest mismatch',f=>f.recording.calls[0].identity_sha256='0'.repeat(64),'FAIL'],
      ['proof identity mismatch',f=>f.capture.discovery.turns[0].calls[0].call_id='foreign_call','FAIL'],
      ['public outcome contradicts actual result',f=>{f.trace.find(e=>e.kind==='tool_result').status='error'},'FAIL'],
      ['public result replay',f=>{f.trace.push({...f.trace.find(e=>e.kind==='tool_result')})},'FAIL'],
      ['actual argument digest mismatch',f=>f.recording.calls[0].args_sha256='0'.repeat(64),'FAIL'],
    ]){const f=discoveryFlow(s,mode);mutate(f);assert.equal(grade(s,f).verdict,expected,label)}
    if(mode==='execute'){
      const f=discoveryFlow(s,mode);
      actual(f,rows=>{rows[0].part.state.input.code=`if (false) { ${rows[0].part.state.input.code.replace('return ','')} }`});
      verdict(grade(s,f),'BLOCKED'); // A syntactic site plus a returned body is not proof of that call executing.
    }
  }
});

test('available contradictions dominate every independently missing fragment without expected replacements',()=>{
  let compared=0;
  for(const s of discoveryCases)for(const mode of ['direct','execute']){
    const main=f=>f.capture.discovery.requests.find(r=>r.method===s.backend.method);
    const attacks=[
      ['shared durable write',f=>f.capture.discovery.state.shared.raw['foreign.md']='Unrequested',['state','seed']],
      ['unrelated personal write',f=>f.capture.discovery.state.personal.bindings.push({source:'foreign'}),['state','seed']],
      ['explicit unresolved invocation',f=>f.capture.discovery.turns[0].calls.at(-1).args_resolved=false,['native']],
      ['closed invocation payload',f=>f.capture.discovery.turns[0].calls.at(-1).args.scope={all:true},['native']],
      ['seed mismatch',f=>f.capture.discovery.before.shared.raw['design.md']='Changed seed',['seed']],
      ['error-bearing backend output',f=>main(f).output.error={code:'denied'},['requests']],
      ['denied backend status',f=>main(f).status='denied',['requests']],
      ['foreign backend session',f=>main(f).context.session='foreign_backend',['requests']],
      ['foreign actual session',f=>actual(f,rows=>{for(const row of rows)row.sessionID='foreign_actual'}),[]],
      ['closed actual invocation payload',f=>actual(f,rows=>{
        const row=rows.filter(r=>r.type==='tool_use').at(-1);
        if(mode==='direct')row.part.state.input.scope={all:true};
        else{const site=extractInnerCalls(row.part.state.input.code)[0],args={...site.args,scope:{all:true}};row.part.state.input.code=`return await tools.mem.${site.name}(${JSON.stringify(args)})`}
      }),[]],
      ['failed actual invocation',f=>actual(f,rows=>{rows[0].part.state.status='error';rows[0].part.state.output='Invocation failed'}),[]],
    ];
    if(s.write)attacks.push(['closed stored payload',f=>{
      const a=f.capture.discovery.state.personal;
      if(s.family==='wiki-write')a.raw['foreign.md']='Unrequested';
      else a[s.family==='sources'?'sourceRequests':s.family==='jobs'?'jobs':'records'].at(-1).scope={all:true};
    },s.family==='wiki-write'?['state','seed']:['state']]);
    if(s.write&&s.family!=='wiki-write')attacks.push(['foreign creator session',f=>{f.capture.discovery.creators[0].session='foreign_creator'},[]]);
    const removals=[
      ['guard',null,{guardLog:null}],['text',null,{text:null}],
      ['answer',f=>delete f.capture.discovery.turns[0].text,{}],
      ['requests',f=>delete f.capture.discovery.requests,{}],
      ['native',f=>delete f.capture.discovery.turns,{}],
      ['state',f=>delete f.capture.discovery.state,{}],
      ['seed',f=>delete f.capture.discovery.before,{}],
    ];
    for(const [label,attack,depends]of attacks)for(const [fragment,remove,options]of removals){
      if(depends.includes(fragment))continue; // The omitted combinations remove the contradiction itself.
      const f=discoveryFlow(s,mode);attack(f);remove?.(f);
      assert.equal(grade(s,f,options).verdict,'FAIL',`${label} with unavailable ${fragment}`);compared++;
    }
  }
  assert.equal(compared,3496);
});

test('ordinary trace, verdict, and enumerable run view never export the private projection or canaries',()=>{
  const s=discoveryCases.find(s=>s.family==='exact-read'),canary='R1_PRIVATE_CANARY_UNREGISTERED_71932';
  for(const mode of ['direct','execute']){
    const f=discoveryFlow(s,mode);
    actual(f,rows=>{for(const r of rows){r.sessionID=canary;if(r.type==='tool_use'){r.part.callID=canary+r.part.id;r.part.state.output=JSON.stringify({private_value:canary})}else r.part.text=canary}});
    const view=runView([f.head,...f.trace],{memoryRecording:f.recording});
    assert.equal(Object.keys(view).includes('memoryRecording'),false);
    assert.equal(JSON.stringify(f.trace).includes(canary),false);
    assert.equal(JSON.stringify(grade(s,f)).includes(canary),false);
  }
});

test('present malformed nested proof fragments fail without dereferencing unavailable or invalid values',()=>{
  for(const family of ['wiki-read','code','wiki-graph']){
    const s=discoveryCases.find(s=>s.family===family),f=discoveryFlow(s);
    const out=f.capture.discovery.requests.find(r=>r.method===s.backend.method).output;
    out[family==='wiki-read'?'items':'nodes']=[null];
    verdict(grade(s,f,{guardLog:null}),'FAIL');
  }
  const s=discoveryCases[0],f=discoveryFlow(s);f.capture.discovery.turns[0].text={invalid:true};verdict(grade(s,f),'FAIL');
});

test('unattributed multi-site Code Mode source is unavailable lineage, not asserted execution',()=>{
  const s=discoveryCases.find(s=>s.family==='exact-read'),f=discoveryFlow(s,'execute');
  actual(f,rows=>{
    const r=rows.filter(r=>r.type==='tool_use').at(-1),call=r.part.state.input.code.replace('return ','');
    r.part.state.input.code=`const a = ${call}; const b = ${call}; return {};`;
    r.part.state.output='{}';
  });
  f.capture.discovery.turns=[memoryTurn({code:0,stdout:f.rawLines.join('\n')},{index:1,prompt:s.prompt})];
  verdict(grade(s,f),'BLOCKED');
});
