import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryCases} from '../packs/mem/discovery-plan.mjs';
import {discoveryFlow} from './support/mem-discovery-flow.mjs';

for(const s of discoveryCases)for(const mode of ['direct','execute']){
  test(`${s.id} ${mode}: official normalized trace binds private typed arguments without publishing them`,()=>{
    const f=discoveryFlow(s,mode);
    assert.equal(f.grade().verdict,'PASS');
    assert.ok(f.trace.some(c=>c.kind==='tool_call'&&JSON.stringify(c.args)!==JSON.stringify(s.binding.args)));
  });
  for(const [label,mutate,expected] of [
    ['missing digest',f=>delete f.trace.filter(c=>c.kind==='tool_call').at(-1).args_sha256,'BLOCKED'],
    ['malformed digest',f=>f.trace.filter(c=>c.kind==='tool_call').at(-1).args_sha256='not-a-digest','FAIL'],
    ['different digest',f=>f.trace.filter(c=>c.kind==='tool_call').at(-1).args_sha256='0'.repeat(64),'FAIL'],
    ['redacted shape forgery',f=>{const c=f.trace.filter(c=>c.kind==='tool_call').at(-1);delete c.args_sha256;f.capture.discovery.turns[0].calls.at(-1).args=c.args},'FAIL'],
    ['foreign call',f=>f.trace.filter(c=>c.kind==='tool_call').at(-1).tool='mem_foreign','FAIL'],
    ['foreign native session',f=>f.capture.discovery.turns[0].session='ses_foreign','FAIL'],
  ])test(`${s.id} ${mode}: ${label}`,()=>{const f=discoveryFlow(s,mode);mutate(f);assert.equal(f.grade().verdict,expected)});
}
for(const s of discoveryCases.filter(s=>s.write))for(const mode of ['direct','execute']){
  const family=s.family==='wiki-write'?'raw':s.family==='sources'?'sourceRequests':s.family==='jobs'?'jobs':'records';
  const written=f=>f.capture.discovery.state.personal[family].at(-1);
  const mutations=[
    ['extra same-family object',f=>{const a=f.capture.discovery.state.personal;if(family==='raw')a.raw['foreign.md']='Unrequested source';else a[family].push({id:'foreign',body:'Unrequested source'})}],
    ['hidden payload field',f=>{if(family==='raw')f.capture.discovery.state.personal.raw['hidden.md']='hidden';else written(f).hidden={content:'unrequested'}}],
    ['changed preexisting file',f=>f.capture.discovery.state.personal.raw['design.md']='changed preexisting source'],
    ['unrelated version',f=>f.capture.discovery.state.personal.skills[0].version=999],
    ['missing durable family',f=>delete f.capture.discovery.state.personal[family]],
    ['malformed durable family',f=>f.capture.discovery.state.personal[family]=null],
    ['broader actual wire request',f=>f.capture.discovery.requests.find(r=>r.method===s.backend.method).wire_input.destination='foreign'],
  ];
  if(['sources','jobs'].includes(s.family))for(const [key,value] of [['scope',{all:true}],['scope','allaccounts'],['account','foreign'],['template','foreign'],['project','foreign'],['destination','foreign']])mutations.push([`broader ${key} ${JSON.stringify(value)}`,f=>{const obj=written(f);obj[key]=value;const r=f.capture.discovery.requests.find(r=>r.method===s.backend.method);r.output[s.family==='jobs'?'job':'request']={...obj}}]);
  if(family==='records')mutations.push(
    ['unrelated stored version',f=>{written(f).version=2;f.capture.discovery.requests.find(r=>r.method===s.backend.method).output.record.version=2}],
    ['unrequested title',f=>{written(f).title='Foreign title';f.capture.discovery.requests.find(r=>r.method===s.backend.method).output.record.title='Foreign title'}],
    ['unobserved source metadata',f=>{written(f).stated_by='person';f.capture.discovery.requests.find(r=>r.method===s.backend.method).output.record.stated_by='person'}],
  );
  if(s.family==='jobs')mutations.push(['active draft contradiction',f=>{written(f).active=true;f.capture.discovery.requests.find(r=>r.method===s.backend.method).output.job.active=true}]);
  if(s.family==='sources')mutations.push(['confirmed request contradiction',f=>{written(f).state='confirmed';f.capture.discovery.requests.find(r=>r.method===s.backend.method).output.request.state='confirmed'}]);
  if(s.family!=='wiki-write')mutations.push(['unlinked stored ID',f=>{written(f).id='foreign-stored-id';f.capture.discovery.requests.find(r=>r.method===s.backend.method).output[s.family==='sources'?'request':s.family==='jobs'?'job':'record'].id='foreign-stored-id'}]);
  for(const [label,mutate] of mutations)test(`${s.id} ${mode}: exact authorized poststate rejects ${label}`,()=>{const f=discoveryFlow(s,mode);mutate(f);assert.equal(f.grade().verdict,'FAIL')});
}
for(const s of discoveryCases.filter(s=>s.family==='commitment'))for(const mode of ['direct','execute'])test(`${s.id} ${mode}: closed source-owned metadata is bound to content and native session`,()=>{
  const f=discoveryFlow(s,mode,{recordMetadata:{type:'commitment',title:'Send the Quartz draft',stated_by:'person',source:{session:'ses_spec'},fields:{what:'Send the Quartz draft',owner:'user',state:'open'}}});
  assert.equal(f.grade().verdict,'PASS');
  const r=f.capture.discovery.requests.find(r=>r.method===s.backend.method);r.wire_input.record.source.session='foreign';assert.equal(f.grade().verdict,'FAIL');
});
for(const s of discoveryCases.filter(s=>!s.write))for(const mode of ['direct','execute'])for(const family of ['records','raw','skills','codeGraphs','wikiGraphs','sourceRequests','bindings','jobs','providers','templates'])test(`${s.id} ${mode}: read preserves complete ${family} family`,()=>{
  const f=discoveryFlow(s,mode),a=f.capture.discovery.state.personal;
  if(family==='raw')a.raw['hidden.md']='foreign';else a[family].push({id:'foreign',hidden:'extra data'});
  assert.equal(f.grade().verdict,'FAIL');
});
for(const s of discoveryCases.filter(s=>['exact-read','wiki-read','wiki-write','wiki-graph','code','skills','sources','jobs'].includes(s.family)))for(const mode of ['direct','execute'])test(`${s.id} ${mode}: prerequisite observation must share the native lifetime`,()=>{
  const f=discoveryFlow(s,mode);f.capture.discovery.requests[0].context.session='foreign';assert.equal(f.grade().verdict,'FAIL');
});
for(const s of discoveryCases)for(const mode of ['direct','execute']){
  const observation=f=>f.capture.discovery.requests.find(r=>r.method===s.backend.method);
  for(const [label,mutate] of [
    ['retained-data error',f=>observation(f).output.error={code:'denied'}],
    ['retained-data denied',f=>observation(f).status='denied'],
    ['unknown proof status',f=>observation(f).status='mystery'],
    ['wrong successful operation status',f=>observation(f).status=s.write?'read':'stored'],
    ['nested failure',f=>observation(f).output.receipt={result:{status:'error'}}],
    ['nested error',f=>observation(f).output.receipt={error:{code:'denied'}}],
    ['nested unsuccessful code',f=>observation(f).output.receipt={code:403}],
    ['output denied',f=>observation(f).output.status='denied'],
    ['output unknown',f=>observation(f).output.status='mystery'],
    ['output pending',f=>observation(f).output.status='pending'],
    ['output conflicting success',f=>observation(f).output.success=false],
    ['native retained-data error',f=>{const c=f.capture.discovery.turns[0].calls.at(-1);c.output=JSON.stringify({...JSON.parse(c.output),error:{code:'denied'}})}],
    ['denied permission proof',f=>f.capture.discovery.permission.effect='deny'],
    ['unknown permission proof',f=>f.capture.discovery.permission.effect='unknown'],
  ])test(`${s.id} ${mode}: rejects ${label} before accepting truth fields`,()=>{const f=discoveryFlow(s,mode);mutate(f);assert.equal(f.grade().verdict,'FAIL')});
  if(s.family==='sources')test(`${s.id} ${mode}: stored request may await confirmation without becoming a binding`,()=>{const f=discoveryFlow(s,mode);observation(f).output.confirmation={state:'pending'};assert.equal(f.grade().verdict,'PASS');assert.deepEqual(f.capture.discovery.state.personal.bindings,[])});
}
