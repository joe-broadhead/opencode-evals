import {test} from "node:test"
import assert from "node:assert/strict"
import {createMemoryAssertionBridge,ASSERTION_METADATA_KEY} from "../src/run/guard/mem-native-permission-bridge.mjs"
import {assertionFixture,deferred} from "./support/mem-assertion-fixture.mjs"
import {permissionHost} from "./support/mem-permission-host.mjs"

test("native phase truth table preserves silent allow, skipped-hook deny, unattended allow and real ask",async()=>{
  for(const mode of ["allow","deny","unattended","ask"]){
    const f=assertionFixture(),host=permissionHost({mode}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context})
    const original=structuredClone(f.snapshot),result={stored:true},controller=new AbortController()
    const context={...f.request.native,signal:controller.signal};let delegates=0
    const wrapped=bridge.wrap(f.request.tool,async(input,ctx)=>{
      delegates++;assert.equal(input,f.request.input);assert.equal(ctx,context)
      assert.ok(bridge.currentExecution().receipt())
      const pending=bridge.context.permission.assert(f.snapshot)
      assert.equal(bridge.currentExecution().receipt(),null)
      await pending
      assert.ok(bridge.currentExecution().receipt())
      return result
    })
    try{
      if(mode==="deny")await assert.rejects(wrapped(f.request.input,context),e=>e===host.denied)
      else assert.equal(await wrapped(f.request.input,context),result)
      assert.equal(delegates,1);assert.deepEqual(f.snapshot,original)
      assert.equal(host.calls.assert.length,1)
      assert.equal(host.calls.assert[0].source,f.snapshot.source)
      assert.equal(host.calls.assert[0].resources,f.snapshot.resources)
      assert.notEqual(host.calls.assert[0].metadata,f.snapshot.metadata)
      assert.equal(typeof host.calls.assert[0].metadata[ASSERTION_METADATA_KEY],"string")
      assert.equal(host.calls.reply.length,mode==="ask"?1:0)
      if(mode==="ask")assert.deepEqual(host.calls.reply[0],{sessionID:"ses_assert",requestID:"per_1",decision:"once"})
      assert.equal(bridge.context.other,host.context.other)
      assert.throws(()=>bridge.currentExecution(),/execution/)
    }finally{await bridge.close();f.authority.close()}
  }
})

test("same-carrier concurrent read assertions retain separate ALS capabilities and never mint read grants",async()=>{
  const f=assertionFixture(),gate=deferred(),host=permissionHost({assertGate:gate}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context})
  const controllers=[new AbortController(),new AbortController()],access=[]
  const read={...f.snapshot,action:"mem_recall",resources:[]}
  const wrapped=bridge.wrap("mem_recall",async()=>{
    const own=bridge.currentExecution();access.push(own)
    assert.equal(own.receipt().grant_id,null)
    await bridge.context.permission.assert(read)
    return own.receipt()
  })
  const works=controllers.map(c=>wrapped({query:"same"},{...f.request.native,signal:c.signal}).then(v=>v,e=>e))
  try{
    assert.equal(host.calls.assert.length,2)
    assert.notEqual(host.calls.assert[0].metadata[ASSERTION_METADATA_KEY],host.calls.assert[1].metadata[ASSERTION_METADATA_KEY])
    await assert.rejects(bridge.context.permission.assert(read),/execution/)
    controllers[0].abort();gate.resolve()
    const [denied,allowed]=await Promise.all(works)
    assert.equal(denied,host.denied);assert.equal(allowed.grant_id,null)
    assert.notEqual(access[0],access[1]);assert.equal(access[0].receipt(),null)
  }finally{await bridge.close();f.authority.close()}
})

test("reserved metadata, mismatched identity and second assertions fail before extra native assert",async()=>{
  for(const fault of ["reserved","inherited-reserved","foreign-session","foreign-source","wrong-action","wrong-resource","second"]){
    const f=assertionFixture(),gate=deferred(),host=permissionHost({assertGate:gate}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context})
    try{await bridge.wrap(f.request.tool,async()=>{
      const input=structuredClone(f.snapshot)
      if(fault==="reserved")input.metadata[ASSERTION_METADATA_KEY]="forged"
      if(fault==="inherited-reserved")input.metadata=Object.create({[ASSERTION_METADATA_KEY]:"forged"})
      if(fault==="foreign-session")input.sessionID="other"
      if(fault==="foreign-source")input.source.id="other"
      if(fault==="wrong-action")input.action="memory.forget"
      if(fault==="wrong-resource")input.resources=["spc-eval-shared"]
      let first
      if(fault==="second")first=bridge.context.permission.assert(input).catch(e=>e)
      const rejected=assert.rejects(bridge.context.permission.assert(input),/assertion|execution|metadata/)
      gate.resolve()
      await rejected
      assert.equal(bridge.currentExecution().receipt(),null)
      if(first)assert.equal(await first,host.denied)
      assert.equal(host.calls.assert.length,fault==="second"?1:0)
    })(f.request.input,f.request.native)}finally{gate.resolve();await bridge.close();f.authority.close()}
  }
})

test("setup composition forwards domains and disposes the original setup exactly once",async()=>{
  const f=assertionFixture(),host=permissionHost(),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context});let disposals=0
  const dispose=await bridge.setup(async ctx=>{
    assert.equal(ctx.other,host.context.other)
    assert.notEqual(ctx,host.context);assert.notEqual(ctx.permission,host.context.permission)
    return async()=>{disposals++}
  })
  await dispose();await dispose()
  assert.equal(disposals,1);assert.equal(host.calls.hookDisposals,1)
  assert.equal(bridge.status().closed,true)
  f.authority.close()
})

test("exact token recovery and unrelated-context reevaluation use no ambient/current-call join",async()=>{
  const f=assertionFixture(),host=permissionHost({mode:"ask",publish:false}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context})
  const work=bridge.wrap(f.request.tool,async()=>{await bridge.context.permission.assert(f.snapshot);return "stored"})(f.request.input,f.request.native)
  try{
    const request=await host.ready.promise
    const event=await host.evaluate(host.calls.assert[0]) // Outside executor ALS.
    assert.equal(event.effect,"ask")
    await bridge.recover()
    assert.equal(await work,"stored")
    assert.equal(host.calls.list,1);assert.equal(host.calls.get,1)
    assert.equal(host.calls.reply[0].requestID,request.id)
    await bridge.recover();assert.equal(host.calls.list,1,"recovery is one bounded attempt per token")
  }finally{await bridge.close();f.authority.close()}
})

test("native success racing a once-send failure never releases the facade or its receipt",async()=>{
  const f=assertionFixture(),gate=deferred(),host=permissionHost({mode:"ask",sendGate:gate}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context})
  let access,continued=false
  const work=bridge.wrap(f.request.tool,async()=>{
    access=bridge.currentExecution();await bridge.context.permission.assert(f.snapshot);continued=true
  })(f.request.input,f.request.native)
  const error={send:"failed"},settled=work.catch(e=>e)
  try{
    await host.sendStarted.promise
    assert.equal(access.receipt(),null);assert.equal(continued,false)
    gate.reject(error)
    assert.equal(await settled,error);assert.equal(access.receipt(),null);assert.equal(continued,false)
  }finally{await bridge.close();f.authority.close()}
})

test("abort revokes immediately; a delayed asked event cleans only its original tombstone and blocks a successor until drain",async()=>{
  const f=assertionFixture(),gate=deferred(),host=permissionHost({mode:"ask",assertGate:gate}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context})
  const controller=new AbortController();let detached,access
  try{
    await bridge.wrap(f.request.tool,async()=>{
      access=bridge.currentExecution()
      detached=bridge.context.permission.assert(f.snapshot).catch(e=>e)
      controller.abort(new Error("cancelled"))
      assert.equal(access.receipt(),null)
      return "original executor outcome"
    })(f.request.input,{...f.request.native,signal:controller.signal})
    f.authority.cancel();f.state.activation={...f.state.activation,turn:2,incarnation:2,activation_id:"activation_2"}
    assert.throws(()=>f.authority.open(),/pending/)
    gate.resolve()
    assert.equal(await detached,host.denied) // Hook sees the revoked token before any pending request.
    assert.ok(f.authority.open())
  }finally{await bridge.close();f.authority.close()}
})

test("late publication after abort rejects the exact pending ID, not the event envelope or a successor",async()=>{
  const f=assertionFixture(),host=permissionHost({mode:"ask",publish:false}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context})
  const controller=new AbortController(),work=bridge.wrap(f.request.tool,async()=>bridge.context.permission.assert(f.snapshot))(f.request.input,{...f.request.native,signal:controller.signal})
  const settled=work.catch(e=>e)
  try{
    const pending=await host.ready.promise
    controller.abort()
    host.emit({type:"permission.asked",id:"event_not_permission",data:pending})
    assert.equal(await settled,host.declined)
    assert.deepEqual(host.calls.reply,[{sessionID:pending.sessionID,requestID:pending.id,decision:"reject"}])
    assert.equal(bridge.status().outstanding,0)
  }finally{await bridge.close();f.authority.close()}
})

test("duplicate delivery sends once; a stale token or late send error cannot revoke a later scope",async()=>{
  const f=assertionFixture(),host=permissionHost({mode:"ask",publish:false}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context})
  const work=bridge.wrap(f.request.tool,()=>bridge.context.permission.assert(f.snapshot))(f.request.input,f.request.native)
  try{
    const pending=await host.ready.promise
    await host.emit({type:"permission.asked",id:"envelope",data:pending})
    await work
    f.authority.cancel();f.state.activation={...f.state.activation,turn:2,incarnation:2,activation_id:"activation_2"};f.authority.open()
    await bridge.wrap("mem_recall",async()=>{
      const own=bridge.currentExecution()
      await host.emit({type:"permission.asked",id:"duplicate_envelope",data:structuredClone(pending)})
      const event=await host.evaluate(host.calls.assert[0])
      assert.equal(event.effect,"deny")
      assert.ok(own.receipt(),"recognized tombstone cannot revoke successor")
      assert.equal(own.receipt().grant_id,null)
    })({query:"same carrier"},f.request.native)
    assert.equal(host.calls.reply.filter(r=>r.decision==="once").length,1)
  }finally{await bridge.close();f.authority.close()}
})

test("missing, foreign and mismatched tokens deny controlled hooks without rewriting unrelated actions",async()=>{
  for(const fault of ["missing","foreign","changed-resources","changed-agent"]){
    const f=assertionFixture(),host=permissionHost(),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context})
    try{await bridge.wrap(f.request.tool,async()=>{
      await bridge.context.permission.assert(f.snapshot)
      const event=structuredClone(host.calls.assert[0])
      if(fault==="missing")delete event.metadata[ASSERTION_METADATA_KEY]
      if(fault==="foreign")event.metadata[ASSERTION_METADATA_KEY]="foreign"
      if(fault==="changed-resources")event.resources=["*"]
      if(fault==="changed-agent")event.agent="other"
      assert.equal((await host.evaluate(event)).effect,"deny")
      assert.equal(bridge.currentExecution().receipt(),null)
    })(f.request.input,f.request.native)
    assert.equal((await host.evaluate({...f.snapshot,action:"unrelated.read"})).effect,"allow")
    }finally{await bridge.close();f.authority.close()}
  }
})

test("bounded recovery refuses missing or ambiguous evidence rather than selecting a request",async()=>{
  for(const kind of ["missing","ambiguous","changed-get","list-error"]){
    const f=assertionFixture(),host=permissionHost({mode:"ask",publish:false}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context})
    const work=bridge.wrap(f.request.tool,()=>bridge.context.permission.assert(f.snapshot))(f.request.input,f.request.native).catch(e=>e)
    try{
      const pending=await host.ready.promise
      if(kind==="missing")host.context.permission.list=async()=>[]
      if(kind==="ambiguous")host.context.permission.list=async()=>[pending,{...pending,id:"per_other"}]
      if(kind==="changed-get")host.context.permission.get=async()=>({...pending,save:["*"]})
      if(kind==="list-error")host.context.permission.list=async()=>{throw Error("lost")}
      await bridge.recover()
      assert.equal(bridge.status().partial,true)
      assert.equal(host.calls.reply.some(r=>r.decision==="once"),false)
      for(const p of host.pending.values())p.wait.reject(host.declined)
      assert.equal(await work,host.declined)
    }finally{for(const p of host.pending.values())p.wait.reject(host.declined);await work;await bridge.close();f.authority.close()}
  }
})

test("mutation exclusivity, pre-aborted execution and wrong ALS store never delegate",async()=>{
  const f=assertionFixture(),other=assertionFixture(),host=permissionHost(),secondHost=permissionHost()
  const bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context}),second=await createMemoryAssertionBridge({authority:other.authority,context:secondHost.context})
  const controller=new AbortController(),reason={abort:true};controller.abort(reason)
  let calls=0
  try{
    await assert.rejects(bridge.wrap(f.request.tool,()=>{calls++})(f.request.input,{...f.request.native,signal:controller.signal}),e=>e===reason)
    await bridge.wrap(f.request.tool,async()=>{
      assert.throws(()=>second.currentExecution(),/execution/)
      await assert.rejects(bridge.wrap(f.request.tool,()=>{calls++})(f.request.input,f.request.native),/concurrent/)
      await bridge.context.permission.assert(f.snapshot)
    })(f.request.input,f.request.native)
    assert.equal(calls,0)
  }finally{await bridge.close();await second.close();f.authority.close();other.authority.close()}
})

test("one token cannot bind a second ask, and changed pending fields cannot reach once",async()=>{
  for(const mode of ["second-id","changed-save","changed-source"]){
    const f=assertionFixture(),gate=deferred(),host=permissionHost({mode:"ask",publish:false,sendGate:gate}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context})
    const work=bridge.wrap(f.request.tool,()=>bridge.context.permission.assert(f.snapshot))(f.request.input,f.request.native).catch(e=>e)
    try{
      const pending=await host.ready.promise
      if(mode==="second-id"){
        await host.emit({type:"permission.asked",data:pending})
        await host.sendStarted.promise
        await host.emit({type:"permission.asked",data:{...pending,id:"per_second"}})
      }else{
        const changed={...pending,...(mode==="changed-save"?{save:["*"]}:{source:{...pending.source,id:"other"}})}
        await host.emit({type:"permission.asked",data:changed})
        assert.equal(host.calls.reply.length,0)
        await host.emit({type:"permission.asked",data:pending}) // Recognized tombstone cleanup, not approval.
      }
      gate.resolve()
      assert.notEqual(await work,undefined)
      assert.equal(host.calls.reply.filter(r=>r.decision==="once").length,mode==="second-id"?1:0)
    }finally{gate.resolve();for(const p of host.pending.values())p.wait.reject(host.declined);await work;await bridge.close();f.authority.close()}
  }
})

test("a native ask can outlive executor end; close reports outstanding work and retains late cleanup",async()=>{
  const f=assertionFixture(),host=permissionHost({mode:"ask",publish:false}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context});let work
  try{
    assert.equal(await bridge.wrap(f.request.tool,async()=>{
      work=bridge.context.permission.assert(f.snapshot).catch(e=>e)
      await host.ready.promise
      return "unchanged result"
    })(f.request.input,f.request.native),"unchanged result")
    const closing=await bridge.close()
    assert.equal(closing.closed,false);assert.equal(closing.outstanding,1)
    await host.emit({type:"permission.asked",id:"envelope",data:await host.ready.promise})
    assert.equal(await work,host.declined)
    assert.equal((await bridge.close()).closed,true)
  }finally{for(const p of host.pending.values())p.wait.reject(host.declined);await work;await bridge.close();f.authority.close()}
})

test("bounded recovery remains outstanding after external native approval until its lookup drains",async()=>{
  const f=assertionFixture(),host=permissionHost({mode:"ask",publish:false}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context}),lookup=deferred()
  const work=bridge.wrap(f.request.tool,()=>bridge.context.permission.assert(f.snapshot))(f.request.input,f.request.native)
  let recovery
  try{
    const pending=await host.ready.promise
    host.context.permission.list=()=>lookup.promise
    recovery=bridge.recover()
    host.pending.get(pending.id).wait.resolve() // Actual native completion from another trusted actor.
    await work
    f.authority.cancel();f.state.activation={...f.state.activation,turn:2,incarnation:2,activation_id:"activation_2"}
    assert.throws(()=>f.authority.open(),/pending/)
    lookup.resolve([pending]);await recovery
    assert.equal(bridge.status().partial,true)
    assert.ok(f.authority.open())
  }finally{lookup.resolve([]);await recovery;await work;await bridge.close();f.authority.close()}
})

test("stream loss revokes coverage and performs one exact-token cleanup recovery",async()=>{
  const f=assertionFixture(),host=permissionHost({mode:"ask",publish:false}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context})
  const work=bridge.wrap(f.request.tool,()=>bridge.context.permission.assert(f.snapshot))(f.request.input,f.request.native).catch(e=>e)
  try{
    await host.ready.promise
    host.failStream()
    // A finite checkpoint, not a polling loop: recovery must start from stream failure itself.
    await Promise.resolve();await Promise.resolve();await Promise.resolve()
    assert.equal(host.calls.list,1)
    assert.equal(await work,host.declined)
    assert.equal(bridge.status().partial,true)
    assert.equal(host.calls.reply[0].decision,"reject")
  }finally{for(const p of host.pending.values())p.wait.reject(host.declined);await work;await bridge.close();f.authority.close()}
})

test("pending reevaluation accepts native removal of undefined metadata without changing caller metadata",async()=>{
  const f=assertionFixture(),host=permissionHost({mode:"ask",publish:false}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context})
  f.snapshot.metadata.optional=undefined
  const work=bridge.wrap(f.request.tool,()=>bridge.context.permission.assert(f.snapshot))(f.request.input,f.request.native).catch(e=>e)
  try{
    const pending=await host.ready.promise
    assert.equal(Object.hasOwn(pending.metadata,"optional"),false)
    assert.equal((await host.evaluate({...pending,agent:f.snapshot.agent})).effect,"ask")
    await bridge.recover();assert.equal(await work,undefined)
    assert.equal(Object.hasOwn(f.snapshot.metadata,"optional"),true)
  }finally{for(const p of host.pending.values())p.wait.reject(host.declined);await work;await bridge.close();f.authority.close()}
})

test("no-assert executors retain their exact result/error and never fabricate a permission request",async()=>{
  for(const rejects of [false,true]){
    const f=assertionFixture(),host=permissionHost(),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context}),value={original:true}
    try{
      const work=bridge.wrap(f.request.tool,()=>{if(rejects)throw value;return value})(f.request.input,f.request.native)
      if(rejects)await assert.rejects(work,e=>e===value);else assert.equal(await work,value)
      assert.equal(host.calls.assert.length,0);assert.equal(host.calls.reply.length,0)
    }finally{await bridge.close();f.authority.close()}
  }
})

test("exact dotted permission alias uses the existing once policy without rewriting native action",async()=>{
  const f=assertionFixture(),host=permissionHost({mode:"ask"}),bridge=await createMemoryAssertionBridge({authority:f.authority,context:host.context})
  f.snapshot.action="mem.remember"
  try{
    await bridge.wrap(f.request.tool,()=>bridge.context.permission.assert(f.snapshot))(f.request.input,f.request.native)
    assert.equal(host.calls.assert[0].action,"mem.remember")
    assert.equal(host.calls.reply[0].decision,"once")
  }finally{await bridge.close();f.authority.close()}
})
