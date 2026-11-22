import {test} from "node:test"
import assert from "node:assert/strict"
import {assertionFixture,deferred} from "./support/mem-assertion-fixture.mjs"

test("ID-free native assertion suspends before entry and restores only after actual native success",async()=>{
  const f=assertionFixture(),native=deferred()
  try{
    await f.authority.execute(f.request,async e=>{
      assert.ok(e.receipt()) // Existing preparation evidence, not new transport permission.
      const a=e.beginAssertion(f.snapshot)
      assert.equal(e.receipt(),null)
      a.evaluate({...f.snapshot,effect:"ask"})
      a.evaluate({...f.snapshot,effect:"allow"})
      assert.equal(e.receipt(),null)
      const work=a.run(()=>native.promise)
      assert.equal(e.receipt(),null)
      native.resolve()
      await work
      assert.ok(e.receipt())
    })
    await assert.rejects(f.authority.execute(f.request,()=>assert.fail()),/consumed/)
  }finally{f.authority.close()}
})

test("once-send and native success form a barrier; neither alone restores a receipt",async()=>{
  for(const order of ["native-first","send-first","send-error"]){
    const f=assertionFixture(),native=deferred(),sent=deferred(),error=new Error("send failed")
    try{await f.authority.execute(f.request,async e=>{
      const a=e.beginAssertion(f.snapshot),pending={...f.snapshot,id:"per_real"};delete pending.agent
      assert.equal(a.bind(pending),true)
      assert.equal(a.bind(structuredClone(pending)),true)
      let sends=0
      const reply=a.reply(()=>{sends++;return sent.promise})
      const work=a.run(()=>native.promise)
      const settled=work.then(()=>"ok",e=>e)
      if(order==="send-first"){sent.resolve();await reply;assert.equal(e.receipt(),null);native.resolve()}
      else {native.resolve();await Promise.resolve();assert.equal(e.receipt(),null);if(order==="send-error")sent.reject(error);else sent.resolve()}
      assert.equal(await settled,order==="send-error"?error:"ok")
      assert.equal(await reply,order==="send-error"?"reject":"once")
      assert.equal(Boolean(e.receipt()),order!=="send-error")
      assert.equal(sends,1)
    })}finally{f.authority.close()}
  }
})

test("assertion failure, repeated assertion, second ask and stale success cannot restore authority",async()=>{
  for(const fault of ["native-deny","second-assertion","second-ask","changed-ask","cancel","deny-allow"]){
    const f=assertionFixture(),native=deferred(),error={native:"blocked"}
    try{await f.authority.execute(f.request,async e=>{
      const a=e.beginAssertion(f.snapshot),work=a.run(()=>native.promise),settled=work.then(()=>"ok",e=>e)
      const pending={...f.snapshot,id:"per_one"};delete pending.agent
      if(fault==="second-assertion")assert.throws(()=>e.beginAssertion(f.snapshot),/assertion/)
      if(fault==="cancel")e.cancel()
      if(fault==="deny-allow"){a.evaluate({...f.snapshot,effect:"deny"});const event={...f.snapshot,effect:"allow"};a.evaluate(event);assert.equal(event.effect,"deny")}
      if(fault.endsWith("ask")){assert.equal(a.bind(pending),true);assert.equal(a.bind({...pending,...(fault==="second-ask"?{id:"per_two"}:{save:["*"]})}),false)}
      if(fault==="native-deny")native.reject(error);else native.resolve()
      const result=await settled
      if(fault==="native-deny")assert.equal(result,error);else assert.match(result.message,/assertion/)
      assert.equal(e.receipt(),null)
    })}finally{f.authority.close()}
  }
})

test("detached native assertion blocks successor admission until drained",async()=>{
  const f=assertionFixture(),native=deferred();let work
  try{
    await f.authority.execute(f.request,e=>{work=e.beginAssertion(f.snapshot).run(()=>native.promise).catch(e=>e)})
    f.authority.cancel();f.state.activation={...f.state.activation,turn:2,incarnation:2,activation_id:"activation_2"}
    assert.throws(()=>f.authority.open(),/pending/)
    native.resolve();assert.match((await work).message,/assertion/)
    assert.ok(f.authority.open())
  }finally{f.authority.close()}
})

test("actual request IDs remain owned across same-carrier reads and ended assertions",async()=>{
  const f=assertionFixture(),request={...f.request,tool:"mem_recall",input:{query:"same"}},snapshot={...f.snapshot,action:"mem_recall",resources:[]}
  const pending={...snapshot,id:"per_shared"};delete pending.agent
  try{
    await f.authority.execute(request,async e=>{const a=e.beginAssertion(snapshot);assert.equal(a.bind(pending),true);await a.run(async()=>{});assert.equal(e.receipt().grant_id,null)})
    await f.authority.execute(request,async e=>{const a=e.beginAssertion(snapshot);assert.equal(a.bind(pending),false);await assert.rejects(a.run(async()=>{}),/assertion/);assert.equal(e.receipt(),null)})
  }finally{f.authority.close()}
})

test("duplicate replies and mixed legacy bindings cannot release an assertion",async()=>{
  for(const mode of ["duplicate-reply","legacy-bind"]){
    const f=assertionFixture(),native=deferred(),sent=deferred()
    try{await f.authority.execute(f.request,async e=>{
      const a=e.beginAssertion(f.snapshot),pending={...f.snapshot,id:"per_one"};delete pending.agent
      const work=a.run(()=>native.promise).catch(e=>e)
      assert.equal(a.bind(pending),true)
      const reply=a.reply(()=>sent.promise)
      if(mode==="duplicate-reply")assert.equal(await a.reply(()=>assert.fail("second send")),"reject")
      else assert.throws(()=>e.bindRequest({...f.snapshot,requestID:"per_two"}),/mix/)
      sent.resolve();native.resolve()
      assert.equal(await reply,"reject");assert.match((await work).message,/assertion/);assert.equal(e.receipt(),null)
    })}finally{f.authority.close()}
  }
})

test("completion reentry cannot seal detached native work after its executor throws",async()=>{
  const f=assertionFixture(),native=deferred();let work,execution
  const verified=f.authority.verifyAuthority({action:"open",proof:f.proof,generation:f.state.activation.generation})
  f.state.completionReader=()=>{
    execution=f.authority.execute({...f.request,tool:"mem_recall",input:{query:"prepare"}},e=>{
      work=e.beginAssertion({...f.snapshot,action:"mem_recall",resources:[]}).run(()=>native.promise).catch(e=>e)
      throw new Error("executor ended")
    }).catch(e=>e)
    return {schema:"oc-mem-native-completion/1",...verified,terminal:{sessionID:f.request.native.sessionID,messageID:"terminal",status:"completed"},dispatch:{closed:true,outstanding:0},audit:{status:"clean"}}
  }
  try{assert.equal(f.authority.verifyAuthority({action:"seal",proof:f.proof,...verified}),null)}
  finally{native.resolve();await work;await execution;f.authority.close()}
})

test("assertion observations retain the newest revision without authorizing from hook transitions",async()=>{
  const f=assertionFixture()
  try{await f.authority.execute(f.request,async e=>{
    const a=e.beginAssertion(f.snapshot)
    for(const effect of ["ask","allow","ask"])a.evaluate({...f.snapshot,effect})
    const observations=f.authority.facts().filter(r=>r.kind==="assertion"&&r.phase==="evaluated")
    assert.deepEqual(observations.map(r=>[r.revision,r.effect]),[[1,"ask"],[2,"allow"],[3,"ask"]])
    assert.equal(e.receipt(),null)
    await a.run(async()=>{}) // Native unattended allow is ID-free even after an observed ask.
    assert.ok(e.receipt())
  })}finally{f.authority.close()}
})

test("an unsupported assertion snapshot cannot retry within the same executor",async()=>{
  const f=assertionFixture()
  try{await f.authority.execute(f.request,async e=>{
    assert.throws(()=>e.beginAssertion({...f.snapshot,metadata:{unsupported:()=>{}}}))
    assert.throws(()=>e.beginAssertion(f.snapshot),/assertion/)
    assert.equal(e.receipt(),null)
  })}finally{f.authority.close()}
})
