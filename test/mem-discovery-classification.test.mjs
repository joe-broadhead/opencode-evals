// Synthetic evidence availability controls through the actual clause registry and native grader.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryCases,renderDiscoveryCase} from '../packs/mem/discovery-plan.mjs';
import {compileCase} from '../src/case/compile.mjs';
import {gradeCase,runView} from '../src/grade/grade.mjs';
import {adapterState} from '../src/grade/adapters/index.mjs';
import {discoveryFlow} from './support/mem-discovery-flow.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {main} from '../src/cli.mjs';

function grade(s,f,options={}){
  const files=Object.hasOwn(options,'files')?options.files:[{path:'mem-fixture/capture.json',change:'added',text:JSON.stringify(f.capture)}];
  const state=Object.hasOwn(options,'state')?options.state:adapterState('mem',files);
  const guardLog=Object.hasOwn(options,'guardLog')?options.guardLog:[{kind:'guard_start',case_id:s.id,trial_id:'spec_trial'}];
  return gradeCase(compileCase(s.id+'.md',renderDiscoveryCase(s)),runView([{schema:'oc-trace/1'},...f.trace],{state,files,guardLog,text:Object.hasOwn(options,'text')?options.text:s.answer}));
}
function verdict(result,expected,blocked=['MEM-CT02']){
  assert.equal(result.verdict,expected);
  const item=result.items.find(i=>i.id==='MEM-CT02');
  assert.equal(item.state,expected==='BLOCKED'?'blocked':expected==='FAIL'?'fail':'pass');
  assert.equal(item.results[0].state,expected==='BLOCKED'?'unverifiable':expected==='FAIL'?'fail':'ok');
  if(expected==='BLOCKED'){
    assert.deepEqual(result.failed_blockers,[]);assert.deepEqual(result.blocked,blocked);
    assert.match(item.detail,/unavailable/);assert.ok(item.detail.length<300);
  }
}

test('S3 reviewer missing-capture probe is BLOCKED, not product failure or success',()=>{
  const s=discoveryCases[0];
  // Same missingCapture construction as the independent integration probe, with the corrected expectation.
  const result=gradeCase(compileCase('missing.md',renderDiscoveryCase(s)),runView([{schema:'oc-trace/1'}],{text:s.answer}));
  assert.equal(result.verdict,'BLOCKED');
  const item=result.items.find(i=>i.id==='MEM-CT02');
  assert.equal(item.state,'blocked');assert.equal(item.results[0].state,'unverifiable');
  assert.deepEqual(result.failed_blockers,[]);assert.deepEqual(result.blocked,['MEM-CT02']);
});

for(const s of discoveryCases)for(const mode of ['direct','execute']){
  const main=f=>f.capture.discovery.requests.find(r=>r.method===s.backend.method);
  for(const [label,mutate,options={}] of [
    ['state dependency unavailable',null,{state:null}],
    ['official recording text unavailable',null,{text:null}],
    ['capture absent from complete file inventory',null,{files:[]}],
    ['capture text unavailable',null,{files:[{path:'mem-fixture/capture.json',change:'added'}]}],
    ['discovery capture absent',f=>delete f.capture.discovery],
    ['unsupported recording version',f=>f.capture.discovery.schema='oc-mem-discovery-proof/0'],
    ['unsupported suite version',f=>f.capture.discovery.suite='mem-discovery/1'],
    ['seed artifact absent',f=>delete f.capture.discovery.before],
    ['poststate artifact absent',f=>delete f.capture.discovery.state],
    ['backend recording absent',f=>delete f.capture.discovery.requests],
    ['native recording absent',f=>delete f.capture.discovery.turns],
    ['native call recording absent',f=>delete f.capture.discovery.turns[0].calls],
    ['native session artifact absent',f=>delete f.capture.discovery.turns[0].session],
    ['native exit artifact absent',f=>delete f.capture.discovery.turns[0].exit],
    ['native call status absent',f=>delete f.capture.discovery.turns[0].calls.at(-1).status],
    ['trial identity artifact absent',f=>delete f.capture.discovery.trial_id],
    ['native answer artifact absent',f=>delete f.capture.discovery.turns[0].text],
    ['private arguments absent',f=>delete f.capture.discovery.turns[0].calls.at(-1).args],
    ['permission recording absent',f=>delete f.capture.discovery.permission],
    ['guard recording unavailable',null,{guardLog:null}],
    ['observation output absent',f=>delete main(f).output],
    ['observation input absent',f=>delete main(f).input],
    ['observation wire artifact absent',f=>delete main(f).wire_input],
    ['observation context absent',f=>delete main(f).context],
    ['observation transport status absent',f=>delete main(f).http_status],
  ])test(`${s.id} ${mode}: ${label} is unavailable, not a product verdict`,()=>{const f=discoveryFlow(s,mode);mutate?.(f);verdict(grade(s,f,options),'BLOCKED',options.text===null&&s.legacy_answer_contract?['MEM-CT02','MEM-RT01']:['MEM-CT02'])});
  if(s.write&&s.family!=='wiki-write')test(`${s.id} ${mode}: creator recording unavailable differs from recorded empty creators`,()=>{const f=discoveryFlow(s,mode);delete f.capture.discovery.creators;verdict(grade(s,f),'BLOCKED')});
  for(const [label,mutate,options={}] of [
    ['healthy complete native recording has no calls',f=>{f.capture.discovery.turns[0].calls=[];f.trace.length=0}],
    ['healthy complete backend recording omits expected operation',f=>f.capture.discovery.requests=[]],
    ['wrong answer in complete recording',f=>f.capture.discovery.turns[0].text='Wrong answer'],
    ['recorded empty answer',f=>f.capture.discovery.turns[0].text=''],
    ['recorded empty backend response',f=>main(f).output={}],
    ['foreign native session',f=>f.capture.discovery.turns[0].session='foreign'],
    ['inactive native identity',f=>main(f).context.active=false],
    ['known case mismatch',f=>f.capture.discovery.case_id='foreign'],
    ['known scope mismatch',f=>main(f).space='shared'],
    ['malformed supplied discovery capture',f=>f.capture.discovery=[]],
    ['malformed schema',f=>f.capture.discovery.schema='malformed'],
    ['malformed native recording',f=>f.capture.discovery.turns={}],
    ['recorded failed native execution',f=>f.capture.discovery.turns[0].exit=1],
    ['error retaining expected truth',f=>main(f).output.error={code:'denied'}],
    ['denied retaining expected truth',f=>main(f).status='denied'],
    ['denied permission observation',f=>f.capture.discovery.permission.effect='deny'],
    ['malformed supplied capture JSON',null,{files:[{path:'mem-fixture/capture.json',change:'added',text:'{invalid JSON'}]}],
    ['foreign supplied capture envelope',f=>f.capture.fixture='foreign'],
    ['explicit empty guard recording',null,{guardLog:[]}],
  ])test(`${s.id} ${mode}: ${label} remains product FAIL`,()=>{const f=discoveryFlow(s,mode);mutate?.(f);verdict(grade(s,f,options),'FAIL')});
  for(const [label,mutate,expected] of [
    ['missing argument digest',f=>delete f.trace.filter(c=>c.kind==='tool_call').at(-1).args_sha256,'BLOCKED'],
    ['malformed supplied digest',f=>f.trace.filter(c=>c.kind==='tool_call').at(-1).args_sha256='malformed','FAIL'],
    ['established digest mismatch',f=>f.trace.filter(c=>c.kind==='tool_call').at(-1).args_sha256='0'.repeat(64),'FAIL'],
    ['digest mismatch with partial poststate capture',f=>{delete f.capture.discovery.state;f.trace.filter(c=>c.kind==='tool_call').at(-1).args_sha256='0'.repeat(64)},'FAIL'],
    ['missing digest cannot hide known output contradiction',f=>{delete f.trace.filter(c=>c.kind==='tool_call').at(-1).args_sha256;main(f).output.status='unknown'},'FAIL'],
    ['missing digest cannot hide a known scope effect',f=>{delete f.trace.filter(c=>c.kind==='tool_call').at(-1).args_sha256;f.capture.discovery.state.shared.raw['foreign.md']='Unrequested'},'FAIL'],
    ['missing digest cannot hide a known wrong answer',f=>{delete f.trace.filter(c=>c.kind==='tool_call').at(-1).args_sha256;f.capture.discovery.turns[0].text='Wrong answer'},'FAIL'],
    ['missing seed cannot hide a denied observation',f=>{delete f.capture.discovery.before;main(f).status='denied'},'FAIL'],
    ['partial state cannot hide a foreign native session',f=>{delete f.capture.discovery.state;f.capture.discovery.turns[0].session='foreign'},'FAIL'],
    ['partial state cannot hide a known wrong answer',f=>{delete f.capture.discovery.state;f.capture.discovery.turns[0].text='Wrong answer'},'FAIL'],
  ])test(`${s.id} ${mode}: ${label} has an exact native classification`,()=>{const f=discoveryFlow(s,mode);mutate(f);verdict(grade(s,f),expected)});
}

test('pure CLI grade preserves S3 classifications from actual synthetic artifact files',async()=>{
  const root=mkdtempSync(join(tmpdir(),'discovery-s3-grade-')),s=discoveryCases.find(s=>s.family==='exact-read'),iteration='s3-unit';
  const cases=join(root,'cases'),traces=join(root,'traces'),raw=join(root,'raw'),native=join(raw,iteration,'mem'),out=join(root,'results');
  try{
    for(const dir of [cases,traces,native])mkdirSync(dir,{recursive:true});
    writeFileSync(join(cases,s.id+'.md'),renderDiscoveryCase(s));
    writeFileSync(join(cases,s.id+'.json'),JSON.stringify(compileCase(s.id+'.md',renderDiscoveryCase(s))));
    const scenarios=[
      ['missing capture','BLOCKED',null,'no-capture'],
      ['missing discovery capture','BLOCKED',f=>delete f.capture.discovery],
      ['unavailable raw recording','BLOCKED',null,'no-raw'],
      ['unavailable guard recording','BLOCKED',null,'no-guard'],
      ['unavailable state artifact','BLOCKED',f=>delete f.capture.discovery.state],
      ['unavailable trace digest','BLOCKED',f=>delete f.trace.filter(c=>c.kind==='tool_call').at(-1).args_sha256],
      ['healthy recording with no calls','FAIL',f=>{f.capture.discovery.turns[0].calls=[];f.trace.length=0}],
      ['healthy recording without operation','FAIL',f=>f.capture.discovery.requests=[]],
      ['digest contradiction','FAIL',f=>f.trace.filter(c=>c.kind==='tool_call').at(-1).args_sha256='0'.repeat(64)],
      ['complete normalized positive','PASS'],
      ['error retaining expected truth','FAIL',f=>f.capture.discovery.requests.at(-1).output.error={code:'denied'}],
    ];
    for(const [index,[,expected,mutate,missing]]of scenarios.entries()){
      const trial=index+1,f=discoveryFlow(s),calls=structuredClone(f.capture.discovery.turns[0].calls);mutate?.(f);
      const base=join(native,`${s.id}.t${trial}`);
      writeFileSync(join(traces,`${s.id}.t${trial}.trace.jsonl`),[{schema:'oc-trace/1',trial,run_id:`s3-unit/${s.id}#t${trial}`},...f.trace].map(JSON.stringify).join('\n'));
      if(missing!=='no-capture')writeFileSync(base+'.files.json',JSON.stringify([{path:'mem-fixture/capture.json',change:'added',text:JSON.stringify(f.capture)}]));
      if(missing!=='no-guard')writeFileSync(base+'.guard.jsonl',JSON.stringify({kind:'guard_start',case_id:s.id,trial_id:'spec_trial'}));
      if(missing!=='no-raw')writeFileSync(base+'.jsonl',[...calls.map(c=>({type:'tool_use',sessionID:'ses_spec',part:{tool:c.tool,state:{input:c.args,output:c.output,status:c.status}}})),{type:'text',sessionID:'ses_spec',part:{text:s.answer}}].map(JSON.stringify).join('\n'));
    }
    await main(['grade','--plugin','mem','--cases',cases,'--traces',traces,'--raw',raw,'--out',out,'--iteration',iteration]);
    const results=JSON.parse(readFileSync(join(out,'verdicts.json')));
    assert.equal(results.length,scenarios.length);
    for(const [i,result]of results.entries())verdict(result,scenarios[i][1]);
  }finally{rmSync(root,{recursive:true,force:true})}
});

test('supplied malformed recording fragments remain FAIL even when the state adapter rejects the capture',()=>{
  const s=discoveryCases[0];
  for(const [mutate,options={}]of [
    [f=>f.capture.requests={}],
    [f=>f.capture.after=[]],
    [f=>f.capture.after.personal.raw=[]],
    [f=>f.capture.discovery.turns[0].calls.push(null)],
    [f=>f.capture.discovery.creators.push(null)],
    [null,{guardLog:[null]}],
    [null,{files:{malformed:true}}],
  ]){const f=discoveryFlow(s);mutate?.(f);verdict(grade(s,f,options),'FAIL')}
});

test('unavailable registered contract or unsupported outer codec is BLOCKED without invented truth',()=>{
  const s=discoveryCases[0],f=discoveryFlow(s);
  const c=compileCase('unavailable.md',renderDiscoveryCase(s).replace(`memory-discovery:${s.id}`,'memory-discovery:deep-mem-unregistered'));
  verdict(gradeCase(c,runView([{schema:'oc-trace/1'}],{text:s.answer})),'BLOCKED');
  f.capture.schema='oc-mem-capture/0';verdict(grade(s,f),'BLOCKED');
});

test('a missing backend method artifact does not prove that the complete execution omitted the operation',()=>{
  const s=discoveryCases[0],f=discoveryFlow(s);
  delete f.capture.discovery.requests.at(-1).method;
  verdict(grade(s,f),'BLOCKED');
});
