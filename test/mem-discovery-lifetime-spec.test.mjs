import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryCases,discoveryIntent} from '../packs/mem/discovery-plan.mjs';
import {createDiscoveryStore} from '../worlds/mem/discovery-store.mjs';
import {discoveryResponse} from '../worlds/mem/discovery-http.mjs';
const context=s=>({case_id:s.id,trial_id:'lifetime_trial',turn:1,session:'ses_lifetime',active:true});
const path=s=>s.backend.method.startsWith('records.')||/^(sources|jobs)\./.test(s.backend.method)?`/records/v1/${s.backend.method}`:`/knowledge/v3/${s.backend.method.replaceAll('.','/')}`;
const variants=[
  ['missing',null],['foreign case',{case_id:'foreign'}],['foreign trial',{trial_id:'foreign'}],
  ['inactive',{active:false}],['wrong turn',{turn:2}],['missing session',{session:null}],['empty session',{session:''}],
  ['expired',{},'allow',true],['deny',{},'deny'],['ask declined',{},'ask-declined'],['closed',{},'allow',false,true],
];
for(const s of discoveryCases)for(const via of ['store','http']){
  for(const [label,change,effect='allow',expired=false,closed=false] of variants)test(`${s.id} ${via}: ${label} returns no content and changes no durable state`,()=>{
    const store=createDiscoveryStore({spec:s,intent:discoveryIntent(s,'lifetime_trial',Date.now()+(expired?-1000:60000)),permission:{effect}});
    const ctx=change===null?null:{...context(s),...change},invocation={...context(s),tool:`mem_${s.binding.tool}`,args:s.binding.args,pass:true};
    if(closed)store.close();
    const before=store.capture().after;
    const r=via==='store'?store.request(s.backend.method,s.backend.input,{context:ctx,invocation}):discoveryResponse(store,{method:'POST',path:path(s),headers:{authorization:'Bearer eval-token'},body:s.backend.input},{context:ctx,invocation});
    assert.notEqual(r.status,200);assert.deepEqual(store.capture().after,before);
    assert.ok(r.json.error);assert.ok(!JSON.stringify(r.json).match(/QREC|QUARTZ|QCODE|QWIKI|QS-V|quartz-synthetic|design\.md/));
    store.close();
  });
  for(const effect of ['allow','ask-approved'])test(`${s.id} ${via}: ${effect} with legitimate own context remains accepted`,()=>{
    const store=createDiscoveryStore({spec:s,intent:discoveryIntent(s,'lifetime_trial',Date.now()+60000),permission:{effect}}),ctx=context(s),invocation={...ctx,tool:`mem_${s.binding.tool}`,args:s.binding.args,pass:true};
    const r=via==='store'?store.request(s.backend.method,s.backend.input,{context:ctx,invocation}):discoveryResponse(store,{method:'POST',path:path(s),headers:{authorization:'Bearer eval-token','x-tdai-session-id':ctx.session},body:s.backend.input},{context:ctx,invocation});
    assert.equal(r.status,200);store.close();
  });
}
for(const s of discoveryCases.filter(s=>!s.write)){
  test(`${s.id}: HTTP cannot substitute a foreign caller session for the native turn`,()=>{
    const store=createDiscoveryStore({spec:s,intent:discoveryIntent(s,'lifetime_trial',Date.now()+60000)});
    const r=discoveryResponse(store,{method:'POST',path:path(s),headers:{authorization:'Bearer eval-token','x-tdai-session-id':'foreign'},body:s.backend.input},{context:context(s)});
    assert.equal(r.status,403);assert.deepEqual(store.capture().after,s.seed);store.close();
  });
  test(`${s.id}: an established turn cannot switch sessions or borrow a denied native invocation`,()=>{
    const store=createDiscoveryStore({spec:s,intent:discoveryIntent(s,'lifetime_trial',Date.now()+60000)}),ctx=context(s);
    assert.equal(store.request(s.backend.method,s.backend.input,{context:ctx}).status,200);
    for(const change of [{session:'foreign'},{active:false},{case_id:'foreign'},{trial_id:'foreign'},{turn:2},{pass:false}]){
      const invocation={...ctx,tool:`mem_${s.binding.tool}`,args:s.binding.args,pass:true,...change};
      const r=store.request(s.backend.method,s.backend.input,{context:ctx,invocation});assert.equal(r.status,403);assert.ok(r.json.error);assert.deepEqual(store.capture().after,s.seed);
    }
    const foreign=store.request(s.backend.method,s.backend.input,{context:{...ctx,session:'foreign'}});assert.equal(foreign.status,403);assert.ok(foreign.json.error);
    // No holder-current-context fallback: absence stays absence after a successful read.
    assert.equal(store.request(s.backend.method,s.backend.input).status,403);store.close();
  });
}
test('bootstrap metadata routes are exact, bounded, and lifetime checked separately from content',()=>{
  const s=discoveryCases.find(s=>s.family==='exact-read'),store=createDiscoveryStore({spec:s,intent:discoveryIntent(s,'lifetime_trial',Date.now()+60000)});
  for(const [method,path,body] of [['POST','/v1/context',{}],['GET','/v1/spaces',{}],['GET','/v1/grants',{}],['GET','/v1/resources',{}]]){
    const req={method,path,body,headers:{authorization:'Bearer eval-token'}};
    assert.equal(discoveryResponse(store,req).status,403);
    const good=discoveryResponse(store,req,{context:context(s)});assert.equal(good.status,200);assert.ok(!JSON.stringify(good.json).includes('QREC-71'));
  }
  for(const path of ['/v1/grants/foreign','/v1/resources/foreign','/v1/spaces?unknown=true'])assert.notEqual(discoveryResponse(store,{method:'GET',path,headers:{authorization:'Bearer eval-token'}},{context:context(s)}).status,200);
  store.close();
  assert.equal(discoveryResponse(store,{method:'POST',path:'/v1/context',headers:{authorization:'Bearer eval-token'}},{context:context(s)}).status,409);
});
test('a finite store requires a typed native case/trial/turn plan, not a claimed context alone',()=>{
  const s=discoveryCases[0],intent=discoveryIntent(s,'lifetime_trial',Date.now()+60000);
  for(const change of [{schema:'foreign'},{trial_id:undefined},{trial_id:''},{turns:null},{turns:[]},{turns:[{index:2,calls:[]}]},{turns:[{index:1}]}])assert.throws(()=>createDiscoveryStore({spec:s,intent:{...intent,...change}}),/bound discovery plan/);
});
