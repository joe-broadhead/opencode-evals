import {test} from "node:test"
import assert from "node:assert/strict"
import {coreMemoryIntent} from "../src/run/mem-intent-plan.mjs"
import {nativeOperationPlan} from "../src/run/mem-operation-plan.mjs"
import {discoveryCases,discoveryIntent} from "../packs/mem/discovery-plan.mjs"

test("opt-in wiki alternatives spend one create use, with an independent created-object write",()=>{
  const intent=coreMemoryIntent({original_id:"core-wiki-write",prompts:["create","append","read"]},"trial_a",123456)
  const before=structuredClone(intent),plan=nativeOperationPlan(intent)
  assert.deepEqual(intent,before)
  assert.equal(intent.schema,"oc-mem-intent/1")
  assert.equal(plan.schema,"oc-mem-operation-uses/1")
  assert.deepEqual(plan.turns.map(t=>t.uses.map(u=>[u.id,u.maxUses,u.alternatives.length])),[
    [["wiki.create",1,2],["wiki.write",1,1]],[["wiki.append",1,1]],[]
  ])
  assert.equal(plan.turns[0].uses[1].alternatives[0].args.wiki_id,"@created.wiki")
  assert.equal(nativeOperationPlan({...intent,turns:[{index:1,calls:[...intent.turns[0].calls,intent.turns[0].calls[0]]}]}),null)
})

test("discovery grants are the twelve literal requested mutations, not a write flag",()=>{
  const names=["commit-mem-memory","commit-mem-page","commit-mem-commitment","commit-mem-wiki-write","deep-mem-sources","deep-mem-jobs"]
  for(const name of names)for(const suffix of ["","-p"]){
    const spec=discoveryCases.find(s=>s.id===name+suffix),intent=discoveryIntent(spec,"trial_d",123456)
    const plan=nativeOperationPlan(intent)
    assert.equal(plan.turns[0].uses.length,1,name+suffix)
    assert.equal(plan.turns[0].uses[0].maxUses,1)
    assert.deepEqual(plan.turns[0].uses[0].alternatives,intent.turns[0].calls)
    const duplicate=structuredClone(intent);duplicate.turns[0].calls.push(duplicate.turns[0].calls[0])
    assert.equal(nativeOperationPlan(duplicate),null)
    const changed=structuredClone(intent);changed.turns[0].calls[0].args.extra="grant"
    assert.equal(nativeOperationPlan(changed),null)
  }
  const forged=discoveryIntent({...discoveryCases[0],id:"commit-mem-memory",write:true,binding:{tool:"remember",args:{content:"other",kind:"fact"}}},"trial_d",123456)
  assert.equal(nativeOperationPlan(forged),null)
  assert.equal(nativeOperationPlan({...forged,case_id:"unknown"}),null)
  for(const spec of discoveryCases.filter(s=>!s.write)){
    assert.deepEqual(nativeOperationPlan(discoveryIntent(spec,"trial_d",123456)).turns[0].uses,[])
  }
})
