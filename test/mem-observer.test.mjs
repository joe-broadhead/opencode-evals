import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeObserver } from '../src/run/mem-observer/observer.mjs'
import { controls,domain,native,scope } from './support/mem-observer.mjs'
import { readFileSync } from 'node:fs'

test('opt-in wrapper delegates once with original references; trusted open/seal persist an entered scope',async()=>{
  const input={query:'same'},result={content:'answer'},context={...native,signal:new AbortController().signal}
  let executions=0
  const host=domain(async (args,ctx)=>{executions++;assert.equal(args,input);assert.equal(ctx,context);return result})
  const ctl=controls(),observer=createNativeObserver(ctl.options)
  await observer.install(host.api)
  assert.equal((await observer.ready()).state,'ready')
  assert.equal((await observer.open(ctl.openProof)).state,'open')
  assert.equal(await host.dispatch(input,context),result)
  const sealed=await observer.seal(ctl.sealProof)
  assert.equal(executions,1)
  assert.equal(sealed.enteredScopeSealed,true)
  assert.equal(sealed.coverage,'entered-executor')
  assert.equal(Object.hasOwn(sealed,'complete'),false)
  assert.equal(sealed.occurrences.length,1)
  assert.deepEqual(sealed.occurrences[0].native,{sessionID:native.sessionID,messageID:native.messageID,id:native.id})
  assert.deepEqual(sealed.occurrences[0].scope,scope)
  assert.deepEqual(sealed.occurrences[0].input,{available:true,value:input})
  assert.deepEqual(sealed.occurrences[0].result,{available:true,value:result})
  assert.equal(sealed.journal.sha256,ctl.digest())
  assert.equal(sealed.journal.count,ctl.bytes().toString().trim().split('\n').length)
  assert.equal(sealed.journal.persistedVerified,true)
  await observer.close()
})

test('captured native schema failure remains a negative audit fact with no executor occurrence',async()=>{
  const captured=readFileSync(new URL('./fixtures/mem-observer-2.2.6/observer.txt',import.meta.url),'utf8').trim().split('\n').map(JSON.parse)
  const source=captured.filter(r=>r.id==='owned_schema_carrier' && r.tool==='probe_inner')
  let executed=0
  const {ctl,host,observer}=await opened(async()=>{executed++;return {content:'never'}})
  // Replay actual captured payloads into the offline seam, explicitly not a native run.
  for(const r of source) {
    const phase=r.kind==='native-before'?'before':'after'
    for(const hook of host.hooks[phase])await hook({...r,...native,tool:'mem_recall'})
  }
  const sealed=await observer.seal(ctl.sealProof)
  assert.equal(executed,0)
  assert.equal(sealed.occurrences.length,0)
  assert.equal(sealed.enteredScopeSealed,false)
  assert.match(sealed.audit[1].error.value.message,/Expected string/)
  await observer.close()
})

test('cancel and original rejection survive logging failure; pending zero does not seal cancellation',async()=>{
  const controller=new AbortController(),reason=new Error('owned rejection')
  const {ctl,host,observer}=await opened(async()=>{controller.abort();throw reason})
  const context={...native,signal:controller.signal}
  await host.before({query:'cancel'},context)
  await assert.rejects(host.execute({query:'cancel'},context),e=>e===reason)
  assert.equal(observer.status().pending,0)
  assert.ok(observer.status().health.issues.includes('cancelled'))
  assert.equal((await observer.seal(ctl.sealProof)).enteredScopeSealed,false)
  await observer.close()

  const failed=await opened(async()=>{throw reason},{journal:{append(){throw new Error('disk failed')},read(){return Buffer.alloc(0)}}})
  await assert.rejects(failed.host.execute({query:'x'}),e=>e===reason)
  assert.ok(failed.observer.status().health.issues.includes('journal-append-failed'))
  assert.equal(failed.observer.status().occurrences[0].status,'rejected')
  await failed.observer.close()
})

test('snapshots cannot change executor values, later evidence, or invoke serialization accessors',async()=>{
  const input={query:'before'},result={content:'before'}
  const {ctl,host,observer}=await opened(async arg=>{arg.query='after';return result})
  await host.before(input)
  assert.equal(await host.execute(input),result)
  await host.after(input,result)
  result.content='after'
  const observed=observer.status()
  assert.equal(observed.occurrences[0].input.value.query,'before')
  assert.equal(observed.occurrences[0].result.value.content,'before')
  observed.occurrences[0].input.value.query='tampered'
  assert.equal(observer.status().occurrences[0].input.value.query,'before')
  assert.equal((await observer.seal(ctl.sealProof)).enteredScopeSealed,false)
  await observer.close()

  let getters=0,executed=0
  const unavailable={get query(){getters++;return 'x'}}
  const other=await opened(async args=>{executed++;assert.equal(args,unavailable);return result})
  assert.equal(await other.host.execute(unavailable),result)
  assert.equal(getters,0);assert.equal(executed,1)
  assert.equal(other.observer.status().occurrences[0].input.available,false)
  assert.ok(other.observer.status().health.issues.includes('snapshot-unavailable'))
  await other.observer.close()
})

test('foreign native scope, scope loss, reload and close are sticky revocations, not new implicit scopes',async()=>{
  for(const action of ['foreign','reload','close','revoke']) {
    const {ctl,host,observer}=await opened(async()=>({content:'unchanged'}))
    if(action==='reload')host.replay()
    if(action==='close')await observer.close()
    if(action==='revoke')observer.invalidate('activation-changed')
    await host.dispatch({query:'x'},action==='foreign'?{...native,sessionID:'ses_foreign'}:native)
    const sealed=await observer.seal(ctl.sealProof)
    assert.equal(sealed.enteredScopeSealed,false,action)
    assert.equal(sealed.scope.activation_id,scope.activation_id)
    await observer.close()
  }
})

test('unavailable authority, inventory qualification, or actual inventory prevents readiness/open',async()=>{
  for(const options of [{verifyAuthority:undefined},{qualifyInventory:undefined},{qualifyInventory:async()=>({ready:true})},{qualifyInventory:async({inventoryHash})=>({inventoryHash,generation:'g',promiseTools:[],auditFirst:true,transformsFinal:true,textOnly:true})}]) {
    const ctl=controls(options),observer=createNativeObserver(ctl.options),host=domain(async()=>({content:'x'}))
    await observer.install(host.api)
    assert.notEqual((await observer.ready()).state,'ready')
    assert.notEqual((await observer.open(ctl.openProof)).state,'open')
    await observer.close()
  }
  for(const change of [{input:{type:'string'}},{output:{type:'string'}},{id:'missing'}]) {
    const ctl=controls(),observer=createNativeObserver(ctl.options),host=domain(async()=>({content:'x'}))
    await observer.install(host.api);host.replace(change)
    assert.notEqual((await observer.ready()).state,'ready')
    await observer.close()
  }
  const ctl=controls(),observer=createNativeObserver(ctl.options),host=domain(async()=>({content:'x'}))
  await observer.install(host.api);await observer.ready()
  assert.notEqual((await observer.open({...scope})).state,'open')
  assert.equal(observer.status().scope,null)
  await observer.close()
})

test('independent persisted bytes must match count/hash, even when the append sink claims success',async()=>{
  const {ctl,host,observer}=await opened(async()=>({content:'ok'}),{journal:{append(){},read(){return Buffer.alloc(0)}}})
  await host.dispatch({query:'x'})
  const status=await observer.seal(ctl.sealProof)
  assert.equal(status.enteredScopeSealed,false)
  assert.equal(status.journal.persistedVerified,false)
  assert.ok(status.health.issues.includes('persisted-journal-mismatch'))
  await observer.close()
})

test('an entry racing trusted seal invalidates the scope, not a revised zero certificate',async()=>{
  let release,sealStarted
  const started=new Promise(resolve=>sealStarted=resolve)
  const {ctl,host,observer}=await opened(async()=>({content:'late'}),{
    verifyAuthority:async({action})=>{
      if(action==='seal'){sealStarted();await new Promise(resolve=>release=resolve)}
      return {scope,generation:'generation-one',quiescent:true}
    },
  })
  const sealing=observer.seal(ctl.sealProof)
  await started
  await host.dispatch({query:'late'})
  release()
  assert.equal((await sealing).enteredScopeSealed,false)
  await observer.close()
})

test('serialization failures retain outcome identity and sticky health, including successful unsupported results',async()=>{
  const cyclic={};cyclic.self=cyclic
  for(const result of [{content:'ok',extra:1n},{content:'ok',extra:cyclic},{content:[{type:'image',uri:'synthetic'}]},{content:'ok',output:{transformed:true}}]) {
    let count=0
    const {host,observer}=await opened(async()=>{count++;return result})
    assert.equal(await host.execute({query:'x'}),result)
    assert.equal(count,1)
    assert.equal(observer.status().health.ok,false)
    assert.equal(observer.status().occurrences[0].status,'returned')
    await observer.close()
  }
})

test('distinct supplied reservation identity is evidence only; invalid reservations cannot confer authority',async()=>{
  let grantReads=0,executions=0
  const reservation={grant_id:'grant-one',reservation_id:'use-one'}
  const {ctl,host,observer}=await opened(async()=>{executions++;return {content:'ok'}},{readReservation(){grantReads++;return reservation}})
  await host.dispatch({query:'x'})
  const status=await observer.seal(ctl.sealProof)
  assert.deepEqual(status.occurrences[0].reservation,{available:true,value:reservation})
  assert.notEqual(status.occurrences[0].observerOccurrence,reservation.reservation_id)
  assert.equal(grantReads,1);assert.equal(executions,1)
  await observer.close()
  const bad=await opened(async()=>({content:'ok'}),{readReservation:()=>({pass:true})})
  await bad.host.dispatch({query:'x'})
  assert.equal((await bad.observer.seal(bad.ctl.sealProof)).enteredScopeSealed,false)
  await bad.observer.close()
})

test('ready inspects final inventory again after asynchronous qualification; unsupported mutations cannot become ready',async()=>{
  const host=domain(async()=>({content:'ok'}))
  const ctl=controls({qualifyInventory:async({inventoryHash})=>{
    host.replace({output:{type:'string'}})
    return {generation:'g',inventoryHash,promiseTools:['mem_recall'],auditFirst:true,transformsFinal:true,textOnly:true}
  }})
  const observer=createNativeObserver(ctl.options)
  await observer.install(host.api)
  assert.notEqual((await observer.ready()).state,'ready')
  await observer.close()
})

test('close attempts every registration disposal even when one fails',async()=>{
  let disposed=0
  const ctl=controls(),host=domain(async()=>({content:'ok'}))
  for(const name of ['hook','transform']) {
    const original=host.api[name]
    host.api[name]=async(...args)=>{
      const registration=await original(...args)
      return {async dispose(){disposed++;await registration.dispose();if(name==='transform')throw new Error('dispose failure')}}
    }
  }
  const observer=createNativeObserver(ctl.options)
  await observer.install(host.api)
  await observer.close()
  assert.equal(disposed,3)
  assert.equal(observer.status().state,'closed')
  assert.ok(observer.status().health.issues.includes('registration-disposal-failed'))
})

test('trusted runner/guard numeric incarnation is retained separately from observer identity',async()=>{
  const bound={...scope,incarnation:7}
  const {ctl,observer}=await opened(async()=>({content:'unused'}),{verifyAuthority:async()=>({scope:bound,generation:'generation-one',quiescent:true})})
  const sealed=await observer.seal(ctl.sealProof)
  assert.equal(sealed.enteredScopeSealed,true)
  assert.equal(sealed.scope.incarnation,7)
  assert.equal(typeof sealed.observerID,'string')
  await observer.close()
})

test('unsupported asynchronous recorder failures are latched without an unhandled rejection',async()=>{
  for(const journal of [
    {append:async()=>{throw new Error('async append failed')},read:()=>Buffer.alloc(0)},
    {append(){},read:async()=>{throw new Error('async read failed')}},
  ]) {
    const result={content:'unchanged'}
    const {ctl,host,observer}=await opened(async()=>result,{journal})
    assert.equal(await host.dispatch({query:'x'}),result)
    assert.equal((await observer.seal(ctl.sealProof)).enteredScopeSealed,false)
    await new Promise(resolve=>setImmediate(resolve))
    await observer.close()
  }
})

test('pending work and unverified quiescence cannot produce a zero/settled certificate',async()=>{
  let resolve
  const {ctl,host,observer}=await opened(()=>new Promise(r=>resolve=r))
  const call=host.dispatch({query:'pending'})
  await new Promise(r=>setImmediate(r))
  assert.equal((await observer.seal(ctl.sealProof)).enteredScopeSealed,false)
  resolve({content:'later'});await call
  assert.equal(observer.status().pending,0)
  assert.equal(observer.status().enteredScopeSealed,false)
  await observer.close()
  const denied=await opened(async()=>({content:'unused'}),{verifyAuthority:async({action})=>({scope,generation:'generation-one',quiescent:action!=='seal'})})
  assert.equal((await denied.observer.seal(denied.ctl.sealProof)).enteredScopeSealed,false)
  await denied.observer.close()
})

async function opened(execute,overrides={}) {
  const ctl=controls(overrides),host=domain(execute),observer=createNativeObserver(ctl.options)
  await observer.install(host.api);await observer.ready();await observer.open(ctl.openProof)
  return {ctl,host,observer}
}

test('sequential and concurrent identical inputs use closure IDs, not native carrier or completion order',async()=>{
  const releases=[]
  const {ctl,host,observer}=await opened((input,ctx)=>new Promise(resolve=>releases.push({resolve,input,ctx})))
  const input={query:'identical'}
  const first=host.dispatch(input),second=host.dispatch(input)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(observer.status().pending,2)
  const initial=observer.status().occurrences
  assert.notEqual(initial[0].observerOccurrence,initial[1].observerOccurrence)
  assert.deepEqual(initial[0].native,initial[1].native)
  const two={content:'second'},one={content:'first'}
  releases[1].resolve(two);assert.equal(await second,two)
  releases[0].resolve(one);assert.equal(await first,one)
  const third=host.dispatch(input)
  await new Promise(resolve=>setImmediate(resolve))
  releases[2].resolve({content:'third'});await third
  const sealed=await observer.seal(ctl.sealProof)
  assert.equal(sealed.enteredScopeSealed,true)
  assert.equal(new Set(sealed.occurrences.map(o=>o.observerOccurrence)).size,3)
  assert.deepEqual(sealed.occurrences.map(o=>o.result.value.content),['first','second','third'])
  assert.deepEqual(sealed.records.filter(r=>r.kind==='returned').map(r=>r.result.value.content),['second','first','third'])
  await observer.close()
})

test('zero-entered scope requires trusted open/seal, but late entry revokes the live certificate',async()=>{
  const {ctl,host,observer}=await opened(async()=>({content:'late'}))
  const sealed=await observer.seal(ctl.sealProof)
  assert.equal(sealed.enteredScopeSealed,true)
  assert.equal(sealed.occurrences.length,0)
  await host.dispatch({query:'late'})
  assert.equal(observer.status().enteredScopeSealed,false)
  assert.ok(observer.status().health.issues.includes('entry-outside-open-scope'))
  assert.equal(observer.status().occurrences.length,1)
  await observer.close()
})

test('pending zero cannot hide missing native after or altered native output',async()=>{
  for (const mode of ['missing-after','altered-output','missing-before']) {
    const {ctl,host,observer}=await opened(async()=>({content:'original'}))
    const input={query:'x'}
    if(mode!=='missing-before')await host.before(input)
    const result=await host.execute(input)
    if(mode!=='missing-after')await host.after(input,mode==='altered-output'?{content:'rewritten'}:result)
    assert.equal(observer.status().pending,0)
    const sealed=await observer.seal(ctl.sealProof)
    assert.equal(sealed.enteredScopeSealed,false,mode)
    assert.ok(sealed.health.issues.includes('native-coverage-mismatch'),mode)
    await observer.close()
  }
})
