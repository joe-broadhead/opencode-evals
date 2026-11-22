// Offline plan/selection seam: no service, plugin, provider or runtime execution.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {discoveryCases,discoverySuiteHash,discoveryIntent,immutableDiscoveryClone} from '../packs/mem/discovery-plan.mjs'
import {selectMemoryPlan} from '../src/run/mem-case-plan.mjs'
import {stageDiscoveryFixture} from '../src/run/mem-discovery-stage.mjs'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

const lifetime=trial_id=>({trial_id,expires_at:Date.now()+60000})
const hash=()=>createHash('sha256').update(JSON.stringify(discoveryCases)).digest('hex')
const pinned='554d9680206ceb0de74626eac67c3948008500c3fe40c3cf542383ef8cb3148b'
function frozenTree(value){
  if(!value||typeof value!=='object')return
  assert.ok(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype,'only immutable plain contract data, not Map/Set/typed arrays')
  assert.ok(Object.isFrozen(value))
  for(const child of Object.values(value))frozenTree(child)
}
test('reviewer two-trial payload counterexample cannot change later intent or the suite digest',()=>{
  const first=selectMemoryPlan('commit-mem-memory',lifetime('trial_alias_1'))
  const original=first.spec.binding.args.content
  let mutationError,second,changedHash
  try{
    try{first.spec.binding.args.content='Reviewer in-memory changed payload.'}catch(e){mutationError=e}
    second=selectMemoryPlan(first.spec.id,lifetime('trial_alias_2'))
    changedHash=hash()
  }finally{
    // Restore only on the unfixed baseline, so a red probe does not contaminate later tests.
    if(first.spec.binding.args.content!==original)first.spec.binding.args.content=original
  }
  assert.ok(mutationError instanceof TypeError)
  assert.notEqual(first.spec,second.spec)
  assert.notEqual(first.spec.binding.args,second.spec.binding.args)
  assert.equal(second.intent.turns[0].calls[0].args.content,'Quartz uses green labels.')
  assert.equal(changedHash,pinned)
  assert.equal(discoverySuiteHash,pinned)
})
test('all canonical and selected nested contract data are frozen private per-trial snapshots',()=>{
  frozenTree(discoveryCases)
  for(const canonical of discoveryCases){
    const first=selectMemoryPlan(canonical.id,lifetime('trial_first'))
    const second=selectMemoryPlan(canonical.id,lifetime('trial_second'))
    frozenTree(first);frozenTree(second)
    assert.deepEqual(first.spec,canonical)
    assert.notEqual(first.spec,canonical)
    assert.notEqual(first.spec.seed.personal,second.spec.seed.personal)
    assert.notEqual(first.spec.binding.args,second.spec.binding.args)
    for(const selected of [first,second]){
      assert.throws(()=>{selected.spec.seed.personal.raw['design.md']='foreign'},TypeError)
      assert.throws(()=>{selected.spec.seed.personal.providers[0].enabled=true},TypeError)
      assert.throws(()=>{selected.spec.seed.personal.templates[0].grants.push('all')},TypeError)
      assert.throws(()=>{selected.spec.seed.personal.templates[0].budgets.calls=100},TypeError)
      assert.throws(()=>{selected.spec.prompts.push('foreign')},TypeError)
      if(selected.spec.backend.input.record)assert.throws(()=>{selected.spec.backend.input.record.body='foreign body'},TypeError)
      if(selected.spec.backend.input.files)assert.throws(()=>{selected.spec.backend.input.files[0].content='foreign body'},TypeError)
      if(selected.spec.binding.args.content)assert.throws(()=>{selected.spec.binding.args.content='foreign body'},TypeError)
      if(selected.spec.binding.args.bind)assert.throws(()=>{selected.spec.binding.args.bind.account='foreign'},TypeError)
      if(selected.spec.binding.args.job)assert.throws(()=>{selected.spec.binding.args.job.account='foreign'},TypeError)
      if(selected.spec.write)assert.throws(()=>{selected.intent.turns[0].calls[0].args.space='shared'},TypeError)
    }
    assert.deepEqual(first.spec,canonical)
    assert.deepEqual(second.spec,canonical)
  }
  assert.equal(hash(),pinned)
})
test('known IDs cannot mint broader intents from changed caller specs or relabeled contracts',()=>{
  for(const canonical of discoveryCases){
    const supplied=structuredClone(canonical)
    supplied.binding.args.space='shared'
    supplied.write=true
    assert.throws(()=>discoveryIntent(supplied,'trial_forged',Date.now()+60000),/unknown|changed/)
    const relabeled=structuredClone(canonical)
    relabeled.id=discoveryCases.find(s=>s.id!==canonical.id).id
    assert.throws(()=>discoveryIntent(relabeled,'trial_relabeled',Date.now()+60000),/unknown|changed/)
    const intent=discoveryIntent(structuredClone(canonical),'trial_valid',Date.now()+60000)
    frozenTree(intent)
    assert.equal(intent.case_id,canonical.id)
    assert.deepEqual(intent.turns[0].calls,canonical.write?[{family:canonical.binding.tool,args:canonical.binding.args}]:[])
  }
  assert.throws(()=>discoveryIntent({id:'unknown'},'trial_unknown',Date.now()+60000),/unknown/)
})
test('staged plans accept legitimate selected snapshots, isolate mutable inputs and freeze nested spec/permission/intent',()=>{
  for(const canonical of discoveryCases){
    const selected=selectMemoryPlan(canonical.id,lifetime('trial_stage'))
    const root=mkdtempSync(join(tmpdir(),'s2s4-stage-'))
    try{
      const suppliedIntent=structuredClone(selected.intent)
      const staged=stageDiscoveryFixture(root,selected.spec,suppliedIntent)
      frozenTree(staged)
      assert.deepEqual(staged.spec,canonical)
      assert.notEqual(staged.spec,selected.spec)
      assert.notEqual(staged.intent,suppliedIntent)
      const disk=JSON.parse(readFileSync(join(root,'discovery-plan.json'),'utf8'))
      assert.deepEqual(staged,disk)
      suppliedIntent.trial_id='foreign'
      assert.equal(staged.intent.trial_id,'trial_stage')
      assert.throws(()=>{staged.permission.effect='deny'},TypeError)
      assert.throws(()=>{staged.spec.seed.personal.providers[0].account='foreign'},TypeError)
      assert.throws(()=>{staged.spec.binding.args.space='shared'},TypeError)
      assert.throws(()=>{staged.spec.backend.input.unknown=true},TypeError)
      assert.deepEqual(JSON.parse(readFileSync(join(root,'discovery-plan.json'),'utf8')),disk)
    }finally{rmSync(root,{recursive:true,force:true})}
  }
  const forged=structuredClone(discoveryCases[0]);forged.binding.args.content='broader payload'
  assert.throws(()=>stageDiscoveryFixture('unused',forged,{case_id:forged.id}),/unknown|changed|unbound/)
})
test('immutable clones preserve supported data types and refuse mutable exotic containers',()=>{
  const original={values:[undefined,-0,null,true,'value'],nested:{number:42}}
  const snapshot=immutableDiscoveryClone(original)
  assert.deepEqual(snapshot,original)
  assert.notEqual(snapshot.values,original.values)
  frozenTree(snapshot)
  for(const value of [new Map([['key',{}]]),new Set(['value']),new Uint8Array([1]),new Date(0),new ArrayBuffer(2)]){
    assert.throws(()=>immutableDiscoveryClone({value}),/unsupported mutable/)
  }
})
