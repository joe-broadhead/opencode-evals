// Trusted control/executor seam. Only finite fake callbacks and deferred Promises.
import {test} from "node:test"
import assert from "node:assert/strict"
import {createNativeAuthority} from "../src/run/guard/mem-native-authority.mjs"
import {coreMemoryIntent} from "../src/run/mem-intent-plan.mjs"
import {nativeOperationPlan} from "../src/run/mem-operation-plan.mjs"

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function fixture(overrides={}) {
  const intent=coreMemoryIntent({original_id:"core-durability",prompts:["store","read"]},"trial_lifecycle",Date.now()+60000)
  const state={activation:{schema:"oc-mem-native-activation/1",case_id:intent.case_id,trial_id:intent.trial_id,trial:1,turn:1,session:"ses_lifecycle",activation_id:"activation_1",incarnation:1,generation:"generation_1",active:true},scopes:{schema:"oc-mem-scopes/1",fixture:"mem-synthetic-v1",case_id:intent.case_id,trial_id:intent.trial_id,record_spaces:{},wiki_spaces:{},creators:[]},completion:null}
  const policy={mode:"commit",memoryIntent:intent,memoryOperationPlan:nativeOperationPlan(intent),memoryBinding:{schema:"oc-mem-contained/1",fixture:"mem-synthetic-v1",backend:"container",origin:"http://127.0.0.1:4617"},writes:[{names:["mem_remember"],memory:"remember",allow:["spc-eval-personal"]}],memoryReplies:{mem_remember:"once"}}
  const a=createNativeAuthority(policy,{readActivation:()=>structuredClone(state.activation),readScopes:()=>structuredClone(state.scopes),readCompletion:()=>structuredClone(state.completion),...overrides})
  const request={tool:"mem_remember",input:intent.turns[0].calls[0].args,native:{sessionID:state.activation.session,messageID:"message_1",id:"carrier_1"}}
  const permission={requestID:"request_1",sessionID:state.activation.session,action:"mem_remember",source:{type:"tool",id:"carrier_1",messageID:"message_1"},resources:["spc-eval-personal"]}
  return {a,state,request,permission}
}

test("a reply resolves only its exact pending transition, not a newer ask",async()=>{
  const sequences=[[],["ask"],["allow"],["allow","ask"],["allow","ask","allow"],["deny","ask"],["cancel"],["lease-cancel"],["end"],["duplicate"]]
  for(const sequence of sequences)for(const outcome of ["success","error"]){
    const f=fixture(),sent=deferred(),done=deferred();f.a.open();let e,reply,sends=0
    const work=f.a.execute(f.request,async execution=>{
      e=execution;e.bindRequest(f.permission);f.a.evaluate({...f.permission,effect:"ask"})
      reply=f.a.reply(f.permission,()=>{sends++;return sent.promise})
      await done.promise
    })
    try{
      for(const transition of sequence){
        if(transition==="cancel")f.a.cancel()
        else if(transition==="lease-cancel")e.cancel()
        else if(transition==="end"){done.resolve();await work}
        else if(transition==="duplicate")assert.equal(await f.a.reply(f.permission,()=>{sends++}),"reject")
        else f.a.evaluate({...f.permission,effect:transition})
      }
      if(outcome==="success")sent.resolve();else sent.reject(new Error("late send failure"))
      const unchanged=sequence.length===0
      assert.equal(await reply,unchanged&&outcome==="success"?"once":"reject",`${sequence}/${outcome}`)
      const live=unchanged?outcome==="success":sequence.at(-1)==="allow"
      assert.equal(Boolean(e.receipt()),live,`${sequence}/${outcome}`)
      assert.equal(sends,1)
    }finally{sent.resolve();done.resolve();await work;f.a.close()}
  }
})

for(const reader of ["readActivation","readScopes","readCompletion"])test(`${reader}: async values refuse synchronously and cannot cause an unhandled rejection`,async()=>{
  for(const kind of ["resolved-promise","rejected-promise","resolved-thenable","rejected-thenable","throwing-thenable"]){
    let f,thenCalls=0,delegates=0
    const unsupported=()=>{
      const value=reader==="readActivation"?f.state.activation:reader==="readScopes"?f.state.scopes:f.state.completion
      if(kind==="resolved-promise")return Promise.resolve(value)
      if(kind==="rejected-promise")return Promise.reject(new Error("unsupported reader rejected"))
      return {then(resolve,reject){thenCalls++;if(kind==="throwing-thenable")throw new Error("unsupported then threw");if(kind==="rejected-thenable")reject(new Error("unsupported then rejected"));else resolve(value)}}
    }
    f=fixture({[reader]:unsupported})
    try{
      if(reader==="readActivation")assert.throws(()=>f.a.open(),/activation/)
      else{
        const proof=f.a.open(),verified=f.a.verifyAuthority({action:"open",proof,generation:"generation_1"})
        f.state.completion={schema:"oc-mem-native-completion/1",...verified,terminal:{sessionID:f.state.activation.session,messageID:"message_1",status:"completed"},dispatch:{closed:true,outstanding:0},audit:{status:"clean"}}
        if(reader==="readScopes")await assert.rejects(f.a.execute(f.request,()=>{delegates++}),/scope/)
        else assert.equal(f.a.verifyAuthority({action:"seal",proof,...verified}),null)
        assert.equal(f.a.verifyAuthority({action:"open",proof,generation:"generation_1"}),null,"unsupported reader revokes the scope")
      }
      // Let only bounded assimilation/rejection-observation microtasks finish. No timers or global handlers.
      await Promise.resolve();await Promise.resolve()
      assert.equal(thenCalls,kind.endsWith("thenable")?1:0)
      assert.equal(delegates,0)
      assert.equal(f.a.facts().some(row=>row.kind==="reserved"),false)
    }finally{f.a.close()}
  }
})

test("completion reentry cannot seal a closed, cancelled, replaced or recursively verified scope",()=>{
  for(const action of ["close","cancel","replace-activation","open-successor","recursive-seal","read-only"]){
    let f,seal,completion,reads=0
    f=fixture({readCompletion:()=>{
      reads++
      if(action==="close")f.a.close()
      if(action==="cancel")f.a.cancel()
      if(action==="replace-activation")f.state.activation.activation_id="replacement"
      if(action==="open-successor"){
        f.a.cancel();f.state.activation={...f.state.activation,turn:2,incarnation:2,activation_id:"activation_2"};f.a.open()
      }
      // Bound the probe even on the broken implementation: no recursive fuzz loop.
      if(action==="recursive-seal"&&reads===1)f.a.verifyAuthority(seal)
      if(action==="read-only"){
        assert.ok(f.a.verifyAuthority({...seal,action:"open"}))
        assert.equal(f.a.readReservation({scope:seal.scope,native:f.request.native,tool:f.request.tool}),null)
      }
      return completion
    }})
    try{
      const proof=f.a.open(),verified=f.a.verifyAuthority({action:"open",proof,generation:"generation_1"})
      seal={action:"seal",proof,...verified}
      completion={schema:"oc-mem-native-completion/1",...verified,terminal:{sessionID:f.state.activation.session,messageID:"message_1",status:"completed"},dispatch:{closed:true,outstanding:0},audit:{status:"clean"}}
      const result=f.a.verifyAuthority(seal)
      if(action==="read-only")assert.equal(result.quiescent,true);else assert.equal(result,null,action)
      assert.equal(reads,1,action)
      assert.equal(f.a.facts().some(row=>row.kind==="sealed"),action==="read-only")
    }finally{f.a.close()}
  }
})

test("reader reentry cannot reopen a cancelled open or spend a successor scope",async()=>{
  for(const action of ["cancel","close","recursive-open"]){
    let f,reads=0
    f=fixture({readActivation:()=>{
      reads++
      if(action==="cancel")f.a.cancel()
      else if(action==="close")f.a.close()
      else if(reads===1)assert.throws(()=>f.a.open(),/activation/)
      return structuredClone(f.state.activation)
    }})
    try{assert.throws(()=>f.a.open(),/activation/);assert.equal(reads,1);assert.equal(f.a.facts().some(row=>row.kind==="opened"),false)}finally{f.a.close()}
  }
  let f,delegated=false
  f=fixture({readScopes:()=>{
    f.a.cancel();f.state.activation={...f.state.activation,turn:2,incarnation:2,activation_id:"activation_2"};f.a.open()
    return structuredClone(f.state.scopes)
  }})
  f.a.open()
  try{
    await assert.rejects(f.a.execute({...f.request,tool:"mem_recall",input:{query:"model"}},()=>{delegated=true}),/scope|activation/)
    assert.equal(delegated,false)
  }finally{f.a.close()}
})
