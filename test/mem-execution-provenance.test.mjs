// Source examples remain strings. Only private public-hook observations can prove inner execution.
import {test} from "node:test"
import assert from "node:assert/strict"
import {goldCore} from "./mem-core.test.mjs"
import {renderCore} from "../packs/mem/core.mjs"
import {compileCase} from "../src/case/compile.mjs"
import {gradeCase,runView} from "../src/grade/grade.mjs"
import {memoryTurn,withMemoryActivation,nativeMemoryCalls} from "../src/run/mem-turns.mjs"
import {coreAssertionFailures,memoryCoreEvidence} from "../src/grade/adapters/mem-core.mjs"
import {captureNativeCall} from "./support/mem-native-observation.mjs"

const outer=(code,output="Forgotten.",extra={})=>({code:0,stdout:JSON.stringify({type:"tool_use",sessionID:"ses_a",part:{tool:"execute",state:{status:"completed",input:{code},output}},...extra})})
function scored(result,mutate=()=>{}) {
  const g=goldCore("forget",null,"No memories matched")
  const turn=memoryTurn(result,{index:2,prompt:g.s.prompts[1]});g.core.turns[1]=turn
  mutate(g.core)
  const events=[{schema:"oc-trace/1"}];let seq=1
  for(const t of g.core.turns)for(const c of t.calls)events.push({kind:"tool_call",seq:seq++,tool:c.tool,args:c.args,via:"direct"})
  const verdict=gradeCase(compileCase(`${g.s.id}.md`,renderCore(g.s)),runView(events,{state:{mem:{capture:{core:g.core}}},text:g.core.turns.at(-1).text})).verdict
  return {turn,verdict}
}
for(const raw of ['{action:"forget",__proto__:{},__proto__:null}','{action:"forget","__proto__":{},"__proto__":null}','{action:"forget",id:"rec_eval_1"}'])test(`M3 source is not execution evidence: ${raw}`,()=>{
  const actual=scored(outer(`return await tools.mem.revise(${raw})`))
  assert.equal(actual.verdict,"BLOCKED")
  assert.equal(actual.turn.calls[0].args_resolved,false)
  assert.equal(actual.turn.calls[0].args_source,"source")
  assert.equal(actual.turn.calls[0].output,null)
})

test("M3 unexecuted, optional, valid, exotic and opaque source with fake outer success remains BLOCKED",()=>{
  for(const source of ['if(false) await tools.mem.revise({action:"forget"})','await tools.mem?.revise({action:"forget"})','await tools.mem.revise?.({action:"forget"})','return await tools.mem.revise({action:"forget"} && other)','return await tools.mem.revise({...unknown})','return /tools.mem.revise({action:"forget"})/','return "no calls"']) {
    const actual=scored(outer(source,JSON.stringify({tool:"mem_revise",args:{action:"forget"},args_resolved:true,args_source:"native_guard",status:"completed"})))
    assert.equal(actual.verdict,"BLOCKED",source)
    assert.equal(actual.turn.calls_complete,false)
    assert.ok(actual.turn.calls.every(c=>c.args_resolved===false&&c.output===null))
  }
  const deep='return await tools.mem.revise({action:"forget",nested:'+"[".repeat(4096)+'null'+"]".repeat(4096)+'})'
  assert.equal(scored(outer(deep)).verdict,"BLOCKED","optional diagnostic parsing cannot turn unavailable execution into a parser crash")
  const g=goldCore("forget",null,"No memories matched")
  g.core.turns[1]=memoryTurn(outer('return /tools.mem.revise({action:"forget"})/'),{index:2,prompt:g.s.prompts[1]})
  assert.equal(memoryCoreEvidence(g.s.original_id,{calls:[],state:{mem:{capture:{core:g.core}}}}).state,"unverifiable","diagnostic parser disagreement is not a capability failure")
})

test("M3 source provenance cannot be upgraded by a resolved flag or legacy parsed arguments",()=>{
  const g=goldCore("forget",null,"No memories matched"),a=g.s.assertions.flatMap(a=>a.type==="anyOf"?a.groups.flat():[a]).find(a=>a.type==="expectToolArgs"&&a.tool==="mem_revise")
  const call=memoryTurn(outer('return await tools.mem.revise({action:"forget"})'),{index:2,prompt:g.s.prompts[1]}).calls[0]
  for(const legacy of [false,true]) {
    const forged={...call,args_resolved:true,status:"completed",output:"Forgotten."};if(legacy)delete forged.args_source
    assert.ok(coreAssertionFailures(a,{turns:[{...g.core.turns[1],calls_complete:true,calls:[forged]}]}).some(f=>f.includes("UNVERIFIABLE_TYPED_ARGS")))
  }
  const read=goldCore("recall-model","helios-7b","helios-7b")
  const legacy={...memoryTurn(outer('return await tools.mem.recall({query:"model"})'),{index:1,prompt:read.s.prompts[0]}).calls[0],args_resolved:true,status:"completed",output:"helios-7b"};delete legacy.args_source
  read.core.turns[0].calls=[legacy]
  assert.equal(memoryCoreEvidence(read.s.original_id,{calls:[legacy],state:{mem:{capture:{core:read.core}}}}).state,"unverifiable","legacy borrowed outer output is not an executed inner result")
})

test("M3 known empty journals mean no invocation; missing, malformed and model-output journals stay unverifiable",async()=>{
  const source='return await tools.mem.revise({action:"forget"})'
  const empty=scored({...outer(source),memoryCalls:[]})
  assert.equal(empty.verdict,"FAIL");assert.deepEqual(empty.turn.calls,[]);assert.equal(empty.turn.calls_complete,true)
  for(const journal of [undefined,null,"[]",{},[null],[{tool:"mem_revise",args:{action:"forget"},args_resolved:true,args_source:"source",status:"completed"}]])
    assert.equal(scored({...outer(source),memoryCalls:journal}).verdict,"BLOCKED")
  const spoof={tool:"mem_revise",args:{action:"forget"},args_resolved:true,args_source:"native_guard",call_id:"fake",incarnation:1,status:"completed",output:"Forgotten."}
  assert.equal(scored(outer(source,JSON.stringify({memoryCalls:[spoof]}),{memoryCalls:[spoof]})).verdict,"BLOCKED")
  for(const actual of [[],undefined]) {
    const result=await withMemoryActivation({write:()=>{},clear:()=>{},client:async()=>({...outer(source),memoryCalls:[spoof]}),observations:()=>actual})
    assert.equal(scored(result).verdict,actual?"FAIL":"BLOCKED","runner observations override any client property")
  }
})

test("M3 identical source needs actual scoped public-hook inputs; known wrong inputs FAIL without borrowing source or outer output",async()=>{
  const good=await captureNativeCall({input:{action:"forget",id:"rec_eval_1"},output:"Actual observed forget result."})
  const wrong=await captureNativeCall({input:{action:"retire",id:"rec_eval_1"},output:"Actual observed retire result."})
  const failedWrong=await captureNativeCall({input:{action:"retire",id:"rec_eval_1"},output:"Actual private error.",status:"error"})
  assert.equal(scored({...outer('return await tools.mem.revise({action:"forget"})'),memoryCalls:failedWrong.calls}).verdict,"FAIL","a known actual wrong input is not lost when its terminal outcome is an error")
  const direct={code:0,stdout:JSON.stringify({type:"tool_use",sessionID:"ses_a",part:{tool:"mem_revise",state:{input:{action:"forget",id:"rec_eval_1"},status:"completed",output:"Actual observed forget result."}}}),memoryCalls:good.calls}
  const directObserved=scored(direct)
  assert.equal(directObserved.verdict,"PASS")
  assert.deepEqual(directObserved.turn.calls,scored({...outer("unresolved source"),memoryCalls:good.calls}).turn.calls,"direct/Code Mode parity uses the same actual hook observations")
  for(const source of ['return await tools.mem.revise({action:"forget"})','return await tools.mem.revise({action:"forget",__proto__:{},__proto__:null})','if(false) await tools.mem.revise({action:"forget"})','await tools.mem?.revise({...unknown})']) {
    assert.equal(scored(outer(source)).verdict,"BLOCKED")
    const observed=scored({...outer(source,"FAKE OUTER SUCCESS"),memoryCalls:good.calls})
    assert.equal(observed.verdict,"PASS",source)
    assert.deepEqual(observed.turn.calls[0].args,{action:"forget",id:"rec_eval_1"})
    assert.equal(observed.turn.calls[0].output,"Actual observed forget result.")
    assert.equal(scored({...outer(source,"Forgotten."),memoryCalls:wrong.calls}).verdict,"FAIL",source)
  }
  assert.equal(good.receipt,null);assert.equal(wrong.receipt,null)
  const foreign=nativeMemoryCalls(good.records,{...good.context,session:"ses_foreign"})
  assert.equal(foreign,undefined);assert.equal(scored({...outer("unknown"),memoryCalls:foreign}).verdict,"BLOCKED")
})

test("M3 private journal requires its scoped tuple, call identity, unique matching completion and valid outcome",async()=>{
  const actual=await captureNativeCall({input:{action:"forget",id:"rec_eval_1"}})
  for(const unknown of [null,{},"records",[]])assert.equal(nativeMemoryCalls(unknown,actual.context),undefined)
  assert.equal(memoryTurn({code:0,stdout:"",memoryCalls:nativeMemoryCalls([null],actual.context)},{index:1,prompt:"Read"}).calls_complete,false)
  assert.equal(nativeMemoryCalls(actual.records.filter(r=>!["memory_native_start","memory_native_end"].includes(r.kind)),actual.context),undefined,"global startup does not prove scoped empty coverage")
  for(const key of ["case_id","trial_id","session","activation_id"]) {
    const context={...actual.context};delete context[key]
    assert.equal(nativeMemoryCalls(actual.records,context),undefined,key)
  }
  const source=outer('return await tools.mem.revise({action:"forget"})')
  const mutations=[
    r=>r.map(e=>e.kind==="memory_native_start"?{...e,active:false}:e),
    r=>r.map(e=>e.kind==="memory_native_end"?{...e,active:false}:e),
    r=>r.filter(e=>e.kind!=="memory_native_end"),
    r=>r.map(e=>e.kind==="memory_native_end"?{...e,pass:false}:e),
    r=>r.map(e=>e.kind==="memory_native_end"?{...e,status:"running"}:e),
    ...["case_id","trial_id","turn","session","activation_id","incarnation","call_id"].map(key=>r=>r.map(e=>e.kind==="memory_native_end"?{...e,[key]:"foreign"}:e)),
    r=>r.map(e=>{const c={...e};delete c.call_id;return c}),
    r=>r.map(e=>{const c={...e};delete c.incarnation;return c}),
    r=>[...r,...r.filter(e=>e.kind==="memory_native_end")],
    r=>[...r,...r.filter(e=>e.kind==="memory_native_start")],
  ]
  for(const mutate of mutations) {
    const calls=nativeMemoryCalls(mutate(structuredClone(actual.records)),actual.context)
    assert.equal(scored({...source,memoryCalls:calls}).verdict,"BLOCKED")
  }
})

test("M3 official structured direct events retain argument proof, while foreign-session or incomplete events cannot",()=>{
  const direct=(action,status="completed")=>({code:0,stdout:JSON.stringify({type:"tool_use",sessionID:"ses_a",part:{tool:"mem_revise",state:{input:{action,id:"rec_eval_1"},status,output:"Actual direct output."}}})})
  assert.equal(scored(direct("forget")).verdict,"PASS")
  assert.equal(scored(direct("retire")).verdict,"FAIL")
  assert.equal(scored(direct("retire","error")).verdict,"FAIL")
  for(const status of ["running",undefined])assert.equal(scored(direct("forget",status===undefined?null:status)).verdict,"BLOCKED")
  const foreign=direct("forget");foreign.stdout=JSON.stringify({type:"text",sessionID:"ses_a",part:{text:"Native session"}})+"\n"+foreign.stdout.replace("ses_a","ses_foreign")
  assert.equal(scored(foreign).verdict,"BLOCKED")
})

test("M3 every scoped frame is accounted for before journal completeness",async()=>{
  const actual=await captureNativeCall({input:{action:"forget",id:"rec_eval_1"}})
  const orphan=actual.records.find(r=>r.kind==="memory_native_end")
  for(const records of [
    [...actual.records,{...orphan,call_id:"orphan"}],
    actual.records.filter(r=>r.kind!=="memory_native_end").map(r=>r.kind==="memory_native_start"?{...r,pass:false}:r),
  ]) {
    const result=scored({...outer("inert"),memoryCalls:nativeMemoryCalls(records,actual.context)})
    assert.equal(result.turn.calls_complete,false)
    assert.equal(result.verdict,"BLOCKED")
  }
  const partial=nativeMemoryCalls([...actual.records,{...orphan,call_id:"orphan"}],actual.context)
  assert.ok(partial.some(c=>c.call_id==="orphan"&&c.status==="completed"),"do not discard orphan diagnostics")
})

test("M3 unavailable runner envelope preserves validated direct facts but cannot certify silence",()=>{
  const stdout=JSON.stringify({type:"tool_use",sessionID:"ses_a",part:{tool:"mem_revise",state:{input:{action:"forget",id:"rec_eval_1"},status:"completed",output:"Forgotten."}}})
  assert.equal(scored({code:0,stdout,memoryCalls:undefined}).verdict,"PASS")
  assert.equal(scored({code:0,stdout,memoryCalls:[]}).verdict,"FAIL","authoritative empty never falls back")
  for(const input of [[],null,"{}"]){
    const raw=JSON.parse(stdout);raw.part.state.input=input
    assert.equal(memoryTurn({code:0,stdout:JSON.stringify(raw)},{index:1,prompt:"read"}).calls_complete,false)
  }
  assert.equal(memoryTurn({code:0,stdout:"",memoryCalls:undefined},{index:1,prompt:"arithmetic"}).calls_complete,false)
  const unknownSession=JSON.parse(stdout);delete unknownSession.sessionID
  assert.equal(scored({code:0,stdout:JSON.stringify(unknownSession)}).verdict,"BLOCKED","unknown direct session is not a product failure")
})

test("M3 partial coverage cannot erase independently observed wrong actions or state",async()=>{
  const wrong=await captureNativeCall({input:{action:"retire",id:"rec_eval_1"}})
  for(const mutate of [c=>{c.turns[2].calls_complete=false},c=>{c.turns[1].calls_complete=false}])
    assert.equal(scored({...outer("inert"),memoryCalls:wrong.calls},mutate).verdict,"FAIL")
  const orphan={...wrong.records.find(r=>r.kind==="memory_native_end"),call_id:"orphan"}
  assert.equal(scored({...outer("inert"),memoryCalls:nativeMemoryCalls([...wrong.records,orphan],wrong.context)}).verdict,"FAIL")
  assert.equal(scored({...outer("inert"),memoryCalls:[...wrong.calls,null]}).verdict,"FAIL","malformed inventory entries cannot erase a validated contradiction")
  const direct={code:0,stdout:JSON.stringify({type:"tool_use",sessionID:"ses_a",part:{tool:"mem_revise",state:{input:{action:"retire",id:"rec_eval_1"},status:"completed",output:"Retired."}}})+"\n"+outer("inert").stdout}
  assert.equal(scored(direct).verdict,"FAIL")
  const g=goldCore("abstain-empty",null,"No memories matched")
  g.core.turns[0].calls_complete=false
  g.core.state.records.push({id:"unrequested",kind:"memory",space_id:"shared",body:"Unrequested payload"})
  assert.equal(memoryCoreEvidence(g.s.original_id,{calls:[],state:{mem:{capture:{core:g.core}}}}).state,"fail")
})

test("M3 global or foreign startup cannot certify empty arithmetic coverage",()=>{
  const g=goldCore("discipline-arithmetic","391","")
  const context={case_id:g.s.original_id,trial_id:"trial_empty",turn:1,session:"ses_a",activation_id:"empty1"}
  for(const marker of [{kind:"guard_start"},{kind:"guard_start",case_id:"foreign",trial_id:"foreign"},{kind:"guard_start",case_id:context.case_id,trial_id:context.trial_id}]){
    const memoryCalls=nativeMemoryCalls([marker],context)
    assert.equal(memoryCalls,undefined)
    g.core.turns[0]=memoryTurn({code:0,stdout:JSON.stringify({type:"text",sessionID:"ses_a",part:{text:'{"value":"391"}'}}),memoryCalls},{index:1,prompt:g.s.prompts[0]})
    assert.equal(memoryCoreEvidence(g.s.original_id,{calls:[],state:{mem:{capture:{core:g.core}}}}).state,"unverifiable")
  }
  g.core.turns[0]=memoryTurn({code:0,stdout:JSON.stringify({type:"text",sessionID:"ses_a",part:{text:'{"value":"391"}'}}),memoryCalls:[]},{index:1,prompt:g.s.prompts[0]})
  assert.equal(memoryCoreEvidence(g.s.original_id,{calls:[],state:{mem:{capture:{core:g.core}}}}).state,"ok","a trusted authoritative empty array remains authoritative")
})

test("M3 malformed raw rows preserve independent pairs without certifying completeness or direct fallback",async()=>{
  for(const action of ["forget","retire"]){
    const actual=await captureNativeCall({input:{action,id:"rec_eval_1"}})
    for(const malformed of [null,[],27]){
      const calls=nativeMemoryCalls([...actual.records,malformed],actual.context)
      assert.ok(Array.isArray(calls))
      const result=scored({...outer("inert"),memoryCalls:calls})
      assert.equal(result.turn.calls_complete,false)
      assert.ok(result.turn.calls.some(c=>c.args.action===action&&c.args_resolved))
      assert.equal(result.verdict,action==="retire"?"FAIL":"BLOCKED")
      const direct={code:0,stdout:JSON.stringify({type:"tool_use",sessionID:"ses_a",part:{tool:"mem_revise",state:{input:{action:"forget",id:"rec_eval_1"},status:"completed",output:"Forgotten."}}})}
      const unavailable=nativeMemoryCalls([malformed],actual.context)
      assert.equal(scored({...direct,memoryCalls:unavailable}).verdict,"BLOCKED","malformed raw inventory must not trigger direct fallback")
    }
  }
})
