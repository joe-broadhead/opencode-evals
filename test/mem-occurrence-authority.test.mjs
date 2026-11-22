// Private trusted runner/executor seam; no host, plugin source, listener or transport.
import {test} from "node:test"
import assert from "node:assert/strict"
import {coreMemoryIntent} from "../src/run/mem-intent-plan.mjs"
import {nativeOperationPlan} from "../src/run/mem-operation-plan.mjs"
import {createNativeAuthority} from "../src/run/guard/mem-native-authority.mjs"
import {createBaselineProof} from "../worlds/mem/baseline-proof.mjs"
import {discoveryCases,discoveryIntent} from "../packs/mem/discovery-plan.mjs"

function fixture(case_id="core-durability",suppliedIntent=null) {
  const intent=suppliedIntent??coreMemoryIntent({original_id:case_id,prompts:["one","two","three"]},"trial_a",Date.now()+60000)
  let activation={schema:"oc-mem-native-activation/1",case_id,trial_id:"trial_a",trial:1,turn:1,session:"ses_a",activation_id:"activation_a",incarnation:1,generation:"generation_a",active:true}
  let scopes={schema:"oc-mem-scopes/1",fixture:"mem-synthetic-v1",case_id,trial_id:"trial_a",record_spaces:{},wiki_spaces:{},creators:[]},completion=null
  const policy={mode:"commit",memoryIntent:intent,memoryOperationPlan:nativeOperationPlan(intent),memoryBinding:{schema:"oc-mem-contained/1",fixture:"mem-synthetic-v1",backend:"container",origin:"http://127.0.0.1:4617"},memoryReplies:{mem_remember:"once",mem_wiki:"once"},writes:["remember","revise","page","wiki","commitments","spaces"].map(f=>({names:[`mem_${f}`,`mem.${f}`],memory:f,allow:["spc-eval-personal"]}))}
  const authority=createNativeAuthority(policy,{readActivation:()=>structuredClone(activation),readScopes:()=>structuredClone(scopes),readCompletion:()=>structuredClone(completion)})
  const proof=authority.open()
  const request=(occurrence,tool="mem_remember",input=intent.turns[0].calls[0].args)=>({occurrence,tool,input,native:{sessionID:"ses_a",messageID:"message_a",id:"carrier_a"}})
  return {authority,proof,request,policy,get activation(){return activation},set activation(v){activation=v},get scopes(){return scopes},set completion(v){completion=v}}
}

test("predelegate reservation is one-use despite fresh occurrences and repeated carriers",async()=>{
  const f=fixture(),a=f.authority
  let effects=0,receipt
  const result=await a.execute(f.request("one"),async execution=>{
    receipt=execution.receipt()
    assert.equal(receipt.operation_id,"memory.remember")
    assert.ok(receipt.reservation_id)
    effects++
    await assert.rejects(a.execute(f.request("concurrent"),()=>{effects++}),/concurrent|consumed/)
    return "stored"
  })
  assert.equal(result,"stored")
  await assert.rejects(a.execute(f.request("fresh"),()=>{effects++}),/consumed/)
  assert.equal(effects,1)
  assert.equal(a.readReservation({scope:a.verifyAuthority({action:"open",proof:f.proof,generation:"generation_a"}).scope,native:f.request("x").native,tool:"mem_remember"}),null)
  assert.ok(a.facts().some(r=>r.kind==="refused"))
})

test("same-carrier concurrent reads remain independent without mutation grants",async()=>{
  const f=fixture();let release
  const wait=new Promise(r=>{release=r}),seen=[]
  const read=n=>f.authority.execute(f.request(n,"mem.recall",{query:"model"}),async e=>{seen.push(e.receipt().occurrence);await wait;return n})
  const first=read("read1"),second=read("read2")
  assert.deepEqual(seen,["read1","read2"])
  release();assert.deepEqual(await Promise.all([first,second]),["read1","read2"])
  await assert.rejects(read("read1"),/occurrence/)
})

const permission=(requestID="request_a",action="mem_remember")=>({requestID,action,sessionID:"ses_a",source:{type:"tool",id:"carrier_a",messageID:"message_a"},resources:["spc-eval-personal"]})
test("immutable request bridge suspends ask, resumes exact allow, and never resurrects denial",async()=>{
  const f=fixture(),a=f.authority
  await a.execute(f.request("write"),async e=>{
    const p=permission();e.bindRequest(p)
    a.evaluate({...p,effect:"ask"});assert.equal(e.receipt(),null)
    const allow={...p,effect:"allow"};a.evaluate(allow);assert.equal(allow.effect,"allow");assert.ok(e.receipt())
    a.evaluate({...p,effect:"deny"});assert.equal(e.receipt(),null)
    const stale={...p,effect:"allow"};a.evaluate(stale);assert.equal(stale.effect,"deny");assert.equal(e.receipt(),null)
  })
  await assert.rejects(a.execute(f.request("retry"),()=>assert.fail("must not delegate")),/consumed/)
})

test("carrier-only permissions are refused, not selected from concurrent reads",async()=>{
  const f=fixture(),a=f.authority;let release
  const wait=new Promise(r=>{release=r});const handles=[]
  const run=n=>a.execute(f.request(n,"mem_recall",{query:"model"}),async e=>{handles.push(e);await wait})
  const first=run("one"),second=run("two")
  const event={action:"mem.recall",sessionID:"ses_a",source:{type:"tool",id:"carrier_a"},effect:"allow"}
  a.evaluate(event);assert.equal(event.effect,"deny")
  assert.ok(handles.every(e=>e.receipt()===null))
  release();await Promise.all([first,second])
})

test("late replies and request reuse cannot bind same-carrier successors",async()=>{
  const f=fixture(),a=f.authority;let resolveReply,late
  const p=permission()
  await a.execute(f.request("write"),async e=>{
    e.bindRequest(p);a.evaluate({...p,effect:"ask"})
    late=a.reply(p,()=>new Promise(resolve=>{resolveReply=resolve}))
    assert.equal(e.receipt(),null)
  })
  await a.execute(f.request("read","mem_recall",{query:"model"}),async e=>{
    assert.throws(()=>e.bindRequest({...p,action:"mem_recall"}),/request/)
    resolveReply();assert.equal(await late,"reject")
    const stale={...p,effect:"allow"};a.evaluate(stale);assert.equal(stale.effect,"deny")
  })
})

test("exact dotted recall aliases retain request-bound lifecycle and reject lookalikes",async()=>{
  const f=fixture(),a=f.authority
  await a.execute(f.request("recall","mem.recall",{query:"model"}),async e=>{
    const p=permission("read_request","mem_recall");e.bindRequest(p)
    const event={...p,action:"mem.recall",effect:"allow"};a.evaluate(event);assert.equal(event.effect,"allow")
    a.evaluate({...event,effect:"ask"});assert.equal(e.receipt(),null)
    const fake={...event,action:"mem.recall.extra"};a.evaluate(fake);assert.equal(fake.effect,"deny");assert.equal(e.receipt(),null)
  })
})

test("trusted activation fields, exact proofs and native completion are mandatory",async()=>{
  const f=fixture(),a=f.authority
  assert.equal(a.verifyAuthority({action:"open",proof:{scope:f.activation,verified:true},generation:"generation_a"}),null)
  const verified=a.verifyAuthority({action:"open",proof:f.proof,generation:"generation_a"})
  assert.equal(verified.scope.trial,1);assert.equal(verified.scope.incarnation,1)
  const seal={action:"seal",proof:f.proof,generation:"generation_a",scope:verified.scope,quiescent:true}
  assert.equal(a.verifyAuthority(seal),null,"empty receipt/caller boolean is not terminal proof")
  f.completion={schema:"oc-mem-native-completion/1",scope:verified.scope,generation:"generation_a",terminal:{sessionID:"ses_a",messageID:"message_a",status:"completed"},dispatch:{closed:true,outstanding:0},audit:{status:"clean"}}
  assert.deepEqual(a.verifyAuthority(seal),{...verified,quiescent:true})
  await assert.rejects(a.execute(f.request("late"),()=>assert.fail("late entry")),/inactive/)
  assert.throws(()=>a.open(),/stale/)
})

test("missing, foreign, expired and replaced activations revoke every publication",async()=>{
  for(const change of [c=>({...c,trial:undefined}),c=>({...c,incarnation:undefined}),c=>({...c,session:"foreign"}),c=>({...c,activation_id:"successor"}),c=>({...c,trial_id:"other"}),c=>({...c,active:false})]){
    const f=fixture(),a=f.authority
    await a.execute(f.request("one"),async e=>{
      assert.ok(e.receipt());f.activation=change(f.activation)
      assert.equal(e.receipt(),null)
      assert.equal(a.verifyAuthority({action:"open",proof:f.proof,generation:"generation_a"}),null)
    })
    await assert.rejects(a.execute(f.request("late"),()=>assert.fail("inactive")),/inactive/)
  }
  const f=fixture();f.policy.memoryIntent.expires_at=0
  assert.throws(()=>createNativeAuthority(f.policy,{readActivation:()=>f.activation,readScopes:()=>f.scopes,readCompletion:()=>null}).open(),/activation/)
})

test("error, cancellation and no-op never replenish predelegate use",async()=>{
  for(const outcome of ["error","cancel","noop"]){
    const f=fixture(),a=f.authority
    const run=a.execute(f.request("one"),async e=>{
      if(outcome==="error")throw new Error("executor failure")
      if(outcome==="cancel"){e.cancel();assert.equal(e.receipt(),null)}
      return "not stored"
    })
    if(outcome==="error")await assert.rejects(run,/executor failure/);else await run
    await assert.rejects(a.execute(f.request("two"),()=>assert.fail("replenished")),/consumed/)
  }
})

test("two wiki create forms share one use; stored creator unlocks only the distinct write",async()=>{
  for(const form of [0,1]){
    const f=fixture("core-wiki-write"),a=f.authority,initial={knowledge:[]},backend=createBaselineProof(initial,{},f.policy.memoryIntent)
    const args=f.policy.memoryIntent.turns[0].calls[form].args
    await a.execute(f.request("create","mem_wiki",args),async e=>{
      const invocation=e.receipt(),after={knowledge:[{knowledge_id:"wiki_created",name:"Core Notes",team_id:"local",raw:{}}]}
      const event={path:"/v3/wiki/create",input:{name:"Core Notes"},response:{status:200,json:{knowledge_id:"wiki_created"}},before:initial,after,space:"personal",request_session:"ses_a",context:f.activation,invocation}
      for(const change of [{activation_id:"other"},{incarnation:2},{trial:2},{generation:"other"},{expires_at:0},{reservation_id:null},{grant_id:"other"},{invocation_id:null},{native:{...invocation.native,sessionID:"other"}}]){
        const foreign=createBaselineProof(initial,{},f.policy.memoryIntent)
        foreign.observe({...event,invocation:{...invocation,...change}})
        assert.equal(foreign.creators.length,0,"creator must belong to this activation's reservation")
        assert.equal(foreign.operations[0].binding,"unbound","independent effect fact survives failed binding")
      }
      backend.observe(event)
      assert.equal(backend.creators[0].reservation_id,invocation.reservation_id)
      assert.equal(backend.creators[0].occurrence,"create")
    })
    await assert.rejects(a.execute(f.request("second_create","mem_wiki",f.policy.memoryIntent.turns[0].calls[1-form].args),()=>assert.fail("extra create")),/consumed/)
    const write={action:"write",wiki_id:"wiki_created",filename:"README.md",content:"# Core Notes\n\nThe gateway resolves context before routing."}
    await assert.rejects(a.execute(f.request("no_creator","mem_wiki",write),()=>assert.fail("unbound write")))
    f.scopes.wiki_spaces.wiki_created="spc-eval-personal";f.scopes.creators=backend.creators
    for(const field of ["reservation_id","occurrence","call_id","activation_id"]){
      f.scopes.creators=[{...backend.creators[0],[field]:"foreign"}]
      let delegated=false
      await assert.rejects(a.execute(f.request(`forged_${field}`,"mem_wiki",write),()=>{delegated=true}),/creator|scope map/)
      assert.equal(delegated,false)
    }
    f.scopes.creators=backend.creators
    await a.execute(f.request("write","mem_wiki",write),async e=>{
      const p=permission("independent_write","wiki.write");e.bindRequest(p)
      const evaluation={...p,effect:"allow"};a.evaluate(evaluation);assert.equal(evaluation.effect,"allow")
      assert.equal(e.receipt().operation_id,"wiki.write")
    })
    await assert.rejects(a.execute(f.request("repeat_write","mem_wiki",write),()=>assert.fail("extra write")),/consumed/)
    a.cancel();f.activation={...f.activation,turn:2,incarnation:2,activation_id:"activation_b"};a.open()
    await a.execute(f.request("append","mem_wiki",{action:"append",wiki_id:"wiki_created",filename:"README.md",content:"The control plane uses PostgreSQL for PITR."}),async e=>assert.equal(e.receipt().operation_id,"wiki.append"))
  }
})

test("readReservation cannot attribute a mutation lease to an overlapping same-tool read",async()=>{
  const f=fixture("core-wiki-write"),a=f.authority,scope=a.verifyAuthority({action:"open",proof:f.proof,generation:"generation_a"}).scope
  await a.execute(f.request("write","mem_wiki",f.policy.memoryIntent.turns[0].calls[0].args),async e=>{
    const lookup={scope,native:f.request("x").native,tool:"mem_wiki"}
    assert.equal(a.readReservation(lookup).reservation_id,e.receipt().reservation_id)
    await a.execute(f.request("read","mem_wiki",{action:"list"}),async()=>assert.equal(a.readReservation(lookup),null))
  })
})

test("a pending native reply cannot be sent twice and a racing denial wins",async()=>{
  const f=fixture(),a=f.authority;let release,sends=0
  await a.execute(f.request("write"),async e=>{
    const p=permission();e.bindRequest(p);a.evaluate({...p,effect:"ask"})
    const send=()=>{sends++;return new Promise(r=>{release=r})}
    const first=a.reply(p,send)
    assert.equal(await a.reply(p,send),"reject")
    a.evaluate({...p,effect:"deny"});release()
    assert.equal(await first,"reject");assert.equal(e.receipt(),null)
  })
  assert.equal(sends,1)
})

test("request-bound concurrent reads cannot borrow each other's permission",async()=>{
  const f=fixture(),a=f.authority;let finish
  const wait=new Promise(r=>{finish=r}),handles=[]
  const run=(n,id)=>a.execute(f.request(n,"mem_recall",{query:"model"}),async e=>{e.bindRequest(permission(id,"mem_recall"));handles.push(e);await wait})
  const first=run("one","r1"),second=run("two","r2")
  a.evaluate({...permission("r1","mem_recall"),effect:"deny"})
  a.evaluate({...permission("r2","mem.recall"),effect:"allow"})
  assert.equal(handles[0].receipt(),null);assert.ok(handles[1].receipt())
  finish();await Promise.all([first,second])
})

test("wrong inputs and forged companions do not consume or create a legitimate grant",async()=>{
  const f=fixture(),a=f.authority
  for(const input of [{content:"wrong",kind:"decision"},{...f.request("x").input,visibility:"shared"}])await assert.rejects(a.execute(f.request("bad","mem_remember",input),()=>assert.fail("wrong payload")))
  const event=f.request("foreign");event.native.sessionID="foreign"
  await assert.rejects(a.execute(event,()=>assert.fail("foreign")))
  await a.execute(f.request("valid"),async e=>assert.ok(e.receipt()))
  const policy=structuredClone(f.policy);policy.memoryOperationPlan.turns[0].uses[0].maxUses=2
  assert.throws(()=>createNativeAuthority(policy,{readActivation:()=>f.activation,readScopes:()=>f.scopes,readCompletion:()=>null}),/operation-use/)
  assert.throws(()=>createNativeAuthority({...f.policy,memoryOperationPlan:undefined},{readActivation:()=>f.activation,readScopes:()=>f.scopes,readCompletion:()=>null}),/operation-use/)
})

test("permission resources cannot redirect a validated mutation",async()=>{
  const f=fixture()
  await f.authority.execute(f.request("one"),async e=>{
    assert.throws(()=>e.bindRequest({...permission(),resources:["spc-eval-shared"]}),/request/)
    assert.equal(e.receipt(),null)
  })
})

test("qualified seal rejects pending work, wrong terminal scope and dirty audit",async()=>{
  const f=fixture(),a=f.authority,verified=a.verifyAuthority({action:"open",proof:f.proof,generation:"generation_a"})
  const seal={action:"seal",proof:f.proof,generation:"generation_a",scope:verified.scope}
  const completion={schema:"oc-mem-native-completion/1",...verified,terminal:{sessionID:"ses_a",messageID:"message_a",status:"completed"},dispatch:{closed:true,outstanding:0},audit:{status:"clean"}}
  f.completion=completion
  await a.execute(f.request("read","mem_recall",{query:"model"}),async()=>assert.equal(a.verifyAuthority(seal),null))
  for(const change of [v=>({...v,scope:{...v.scope,trial:2}}),v=>({...v,generation:"other"}),v=>({...v,terminal:{...v.terminal,status:"error"}}),v=>({...v,dispatch:{closed:true,outstanding:1}}),v=>({...v,audit:{status:"partial"}})]){
    f.completion=change(completion);assert.equal(a.verifyAuthority(seal),null)
  }
  f.completion=completion;assert.equal(a.verifyAuthority(seal).quiescent,true)
})

test("a bound once reply resumes only the same live invocation; send failure revokes",async()=>{
  for(const fail of [false,true]){
    const f=fixture(),a=f.authority
    await a.execute(f.request("one"),async e=>{
      const p=permission();e.bindRequest(p);a.evaluate({...p,effect:"ask"})
      const result=await a.reply(p,async sent=>{assert.deepEqual(sent,{sessionID:"ses_a",requestID:"request_a",decision:"once"});if(fail)throw new Error("transport failure")})
      assert.equal(result,fail?"reject":"once")
      assert.equal(Boolean(e.receipt()),!fail)
    })
  }
})

test("a denied native ask never sends once, even before an evaluate hook",async()=>{
  const f=fixture(),a=f.authority;let sent=false
  await a.execute(f.request("one"),async e=>{
    const p=permission();e.bindRequest(p);a.evaluate({...p,effect:"ask"})
    assert.equal(await a.reply({...p,effect:"deny"},async()=>{sent=true}),"reject")
    assert.equal(e.receipt(),null)
  })
  assert.equal(sent,false)
})

test("outer gate reserves before observer entry without requiring an observer occurrence ID",async()=>{
  const f=fixture(),a=f.authority,request=f.request("unused")
  delete request.occurrence
  const scope=a.verifyAuthority({action:"open",proof:f.proof,generation:"generation_a"}).scope
  await a.execute(request,async e=>{
    // A fake inner observer allocates its own occurrence only after gate entry.
    const observation={occurrence:"observer_owned_1",...a.readReservation({scope,native:request.native,tool:request.tool})}
    assert.ok(observation.reservation_id)
    assert.equal(e.receipt().occurrence,null)
    assert.ok(e.receipt().invocation_id)
    assert.equal(observation.reservation_id,e.receipt().reservation_id)
  })
  await assert.rejects(a.execute({...request,occurrence:"observer_owned_2"},()=>{}),/consumed/)
})

test("all twelve enumerated discovery requests admit one mutation, never a retry",async()=>{
  const ids=["commit-mem-memory","commit-mem-page","commit-mem-commitment","commit-mem-wiki-write","deep-mem-sources","deep-mem-jobs"]
  for(const id of ids)for(const suffix of ["","-p"]){
    const spec=discoveryCases.find(s=>s.id===id+suffix),f=fixture(spec.id,discoveryIntent(spec,"trial_a",Date.now()+60000));let effects=0
    const call=n=>f.request(n,`mem_${spec.binding.tool}`,spec.binding.args)
    await f.authority.execute(call("first"),async e=>{assert.ok(e.receipt().grant_id);effects++})
    await assert.rejects(f.authority.execute(call("retry"),()=>{effects++}),/consumed/)
    assert.equal(effects,1,spec.id)
  }
})

test("forget is a distinct second-turn use bound to the stored creator",async()=>{
  const f=fixture("core-forget"),a=f.authority,backend=createBaselineProof({records:[]},{},f.policy.memoryIntent)
  await a.execute(f.request("remember"),async e=>{
    const record={id:"rec_created",kind:"memory",body:"The staging port is 8420.",space_id:"local"}
    backend.observe({path:"/records/v1/records.put",input:{record:{body:record.body,type:"fact"}},response:{status:200,json:{record}},before:{records:[]},after:{records:[record]},space:"personal",request_session:"ses_a",context:f.activation,invocation:e.receipt()})
  })
  assert.equal(backend.creators.length,1)
  f.scopes.record_spaces.rec_created="spc-eval-personal";f.scopes.creators=backend.creators
  a.cancel();f.activation={...f.activation,turn:2,incarnation:2,activation_id:"activation_b"};a.open()
  await a.execute(f.request("forget","mem_revise",{action:"forget",id:"rec_created"}),async e=>assert.equal(e.receipt().operation_id,"memory.forget"))
  await assert.rejects(a.execute(f.request("again","mem_revise",{action:"forget",id:"rec_created"}),()=>{}),/consumed/)
})

test("a second request cannot resolve another unresolved ask on the same lease",async()=>{
  const f=fixture(),a=f.authority
  await a.execute(f.request("write"),async e=>{
    const first=permission("first");e.bindRequest(first);a.evaluate({...first,effect:"ask"})
    assert.throws(()=>e.bindRequest(permission("second")),/request/)
    const event={...permission("second"),effect:"allow"};a.evaluate(event)
    assert.equal(event.effect,"deny");assert.equal(e.receipt(),null)
  })
})

test("scope loss during trusted scope refresh refuses before reservation and delegation",async()=>{
  const f=fixture();let delegated=false
  const a=createNativeAuthority(f.policy,{readActivation:()=>structuredClone(f.activation),readScopes:()=>{f.activation={...f.activation,active:false};return structuredClone(f.scopes)},readCompletion:()=>null})
  a.open()
  await assert.rejects(a.execute(f.request("race"),()=>{delegated=true}),/inactive|activation/)
  assert.equal(delegated,false)
  assert.equal(a.facts().some(r=>r.kind==="reserved"),false)
})

test("seal revalidates activation after reading native completion",()=>{
  const f=fixture();let completed
  const a=createNativeAuthority(f.policy,{readActivation:()=>structuredClone(f.activation),readScopes:()=>f.scopes,readCompletion:()=>{f.activation={...f.activation,active:false};return completed}})
  const proof=a.open(),verified=a.verifyAuthority({action:"open",proof,generation:"generation_a"})
  completed={schema:"oc-mem-native-completion/1",...verified,terminal:{sessionID:"ses_a",messageID:"message_a",status:"completed"},dispatch:{closed:true,outstanding:0},audit:{status:"clean"}}
  assert.equal(a.verifyAuthority({action:"seal",proof,generation:"generation_a",scope:verified.scope}),null)
})
