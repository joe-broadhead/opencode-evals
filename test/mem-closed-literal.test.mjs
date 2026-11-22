// Attack source is data only: public parser/native-turn/core-grader seams, never JavaScript execution.
import {test} from "node:test"
import assert from "node:assert/strict"
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {goldCore} from "./mem-core.test.mjs"
import {coreCases,renderCore} from "../packs/mem/core.mjs"
import {compileCase} from "../src/case/compile.mjs"
import {gradeCase,runView} from "../src/grade/grade.mjs"
import {memoryTurn,nativeMemoryCalls} from "../src/run/mem-turns.mjs"
import {readLiteral} from "../src/trace/innerArgs.mjs"
import {guardPlugin} from "../src/run/guard/index.ts"
import {buildPolicy} from "../src/run/guard/policy.mjs"
import {captureNativeCall} from "./support/mem-native-observation.mjs"

function scored(raw,memoryCalls) {
  const g=goldCore("forget",null,"No memories matched"),code=`return await tools.mem.revise(${raw})`
  const result={code:0,stdout:JSON.stringify({type:"tool_use",sessionID:g.core.turns[1].session,part:{tool:"execute",state:{status:"completed",input:{code},output:"Forgotten."}}}),...(memoryCalls?{memoryCalls}:{})}
  const turn=memoryTurn(result,{index:2,prompt:g.s.prompts[1]});g.core.turns[1].calls=turn.calls
  const events=[{schema:"oc-trace/1"}];let seq=1
  for(const t of g.core.turns)for(const c of t.calls)events.push({kind:"tool_call",seq:seq++,tool:c.tool,args:c.args,via:"direct"})
  return {turn,verdict:gradeCase(compileCase(`${g.s.id}.md`,renderCore(g.s)),runView(events,{state:{mem:{capture:{core:g.core}}},text:g.core.turns.at(-1).text})).verdict}
}
for(const raw of [
  '{action:"forget"} && {action:"retire"}',
  '{action:"forget"} ? {action:"retire"} : {action:"forget"}',
  '{action:"forget"}.action',
  '{action:"forget"}["retire"]',
  '{action:"forget"} + {action:"retire"}',
])test(`M3 complete argument required: ${raw}`,()=>{
  const actual=scored(raw)
  assert.equal(actual.verdict,"BLOCKED")
  assert.equal(actual.turn.calls[0].args_resolved,false)
})

test("M3 trailing operators, member/index/call access, sequences, multiple arguments and expressions stay BLOCKED",()=>{
  for(const tail of [' || {action:"retire"}',' ?? {action:"retire"}','?.action','?.["action"]','()','?.()',' - 1',' * 2',' / 2',' % 2',' ** 2',' == true',' === true',' != null',' < 2',' & 1',' | 1',' ^ 1',' << 1',' in other',' instanceof Object',', {action:"retire"}',',','; other',' other',' /* fine */ && other',' // fine\n.action',' /* fine */ /* unterminated',...['\r','\u2028','\u2029'].map(end=>` // comment${end} && {action:"retire"}\n`)]) {
    const actual=scored(`{action:"forget"}${tail}`)
    assert.equal(actual.verdict,"BLOCKED",tail)
    assert.ok(actual.turn.calls.every(c=>c.args_resolved===false),tail)
  }
})

test("M3 even supported closed source literals need native execution evidence",async()=>{
  for(const raw of [
    '{action:"forget",id:"rec_eval_1"}',
    ' \t\r\n{action:"forget"} \t\r\n',
    '{action:"forget"} /* closed ) } [ comment */',
    '{action:"forget"} // closed by newline\n',
    ...['\r','\u2028','\u2029'].map(end=>`{action:"forget"} // closed by line terminator${end}`),
    '{action:`forget`,nested:{text:`static template`}}',
    '/* before */ {action:"forget", /* inside */ nested:[true,false,null,{text:"quote: \\\"; slash: \\\\"}]} /* after */',
    "{'action':'forget',nested:{text:'single: \\'',newline:'\\n',tab:'\\t'}}",
  ]) {
    const actual=scored(raw)
    assert.equal(readLiteral(raw,{complete:true}).ok,true,raw)
    assert.equal(actual.verdict,"BLOCKED",raw)
    assert.equal(actual.turn.calls[0].args_resolved,false,raw)
  }
  const wrong=await captureNativeCall({input:{action:"retire",id:"rec_eval_1"},output:"Actual retired result."})
  assert.equal(scored('{action:"retire",comment:"action: forget"} /* valid literal */',wrong.calls).verdict,"FAIL")
  assert.equal(scored('{action:"retire",comment:"action: forget"} /* valid literal */').verdict,"BLOCKED")
})

test("M3 unterminated trivia, quotes and brackets or unsupported escapes are unresolved rather than guessed",()=>{
  for(const raw of ['{action:"forget"} /* unclosed','{action:"forget"} /*/','{action:"forget"} [','{action:"forget"','{action:"forget",nested:[1,2}','{action:"forget",text:"unterminated}','{action:"forget",text:"line\nbreak"}','{action:"forget",text:"\\x41"}','{action:"forget",text:"\\u0041"}','{action:"forget",numeric:01}'])
    assert.equal(scored(raw).verdict,"BLOCKED",raw)
})

test("M3 unknown nested spreads, computed keys, aliases and overwritten unknown expressions remain unresolved",()=>{
  for(const raw of ['{action:"forget",...unknown}','{...unknown,action:"forget"}','{action:"forget",nested:{...unknown}}','{action:"forget",nested:[unknown]}','{action:"forget",[key]:"retire"}','alias','{action:unknown,action:"forget"}','{action:"forget",nested:unknown,nested:null}','{...unknown,$spread:false,action:"forget"}','{action:"forget",nested:`${unknown}`}','{action:"forget",nested:undefined}','{action:"forget",1invalid:true}'])
    assert.equal(scored(raw).verdict,"BLOCKED",raw)
})

test("M3 scoped actual private-hook arguments still outrank uncertain source; an actual wrong action still FAILs",async()=>{
  assert.ok(coreCases.some(s=>s.original_id==="core-forget"))
  for(const action of ["forget","retire"]) {
    const root=mkdtempSync(join(tmpdir(),"mem-literal-hook-")),hooks={},saved={};let dispose
    try {
      for(const [key,value]of Object.entries({EVALS_GUARD_OUT:join(root,"guard.jsonl"),EVALS_MEM_TURN_STATE:join(root,"turn.json"),EVALS_MEM_ACTIVE_CALL:join(root,"active.json")})){saved[key]=process.env[key];process.env[key]=value}
      const context={case_id:"core-forget",trial_id:"trial_literal",turn:2,session:"ses_a",activation_id:"literal_activation_2",active:true}
      const input={action,id:"rec_eval_1"},intent={schema:"oc-mem-intent/1",case_id:context.case_id,trial_id:context.trial_id,expires_at:Date.now()+60000,turns:[{index:1,calls:[]},{index:2,calls:[{family:"revise",args:input}]}]}
      const binding={schema:"oc-mem-contained/1",fixture:"mem-synthetic-v1",backend:"container",origin:"http://127.0.0.1:4617",record_spaces:{rec_eval_1:"spc-eval-personal"}}
      const policy=buildPolicy({mode:"commit",packs:[{id:"mem",pluginId:"mem",tools:[{name:"revise",permission:"mem_revise",class:"write"}]}],memoryBinding:binding,commit:{mem_revise:{memory:"revise",allow:["spc-eval-personal"]}},memoryIntent:intent})
      const file=join(root,"policy.json");writeFileSync(file,JSON.stringify(policy));writeFileSync(join(root,"turn.json"),JSON.stringify(context))
      dispose=await guardPlugin({define:x=>x},file).setup({tool:{hook:async(n,f)=>{hooks[n]=f}},permission:{hook:async(n,f)=>{hooks[n]=f}},event:{subscribe:async function*(){}}})
      const call={tool:"mem_revise",input,id:"actual_literal_call",sessionID:context.session}
      await hooks["execute.before"](call);await hooks["execute.after"]({...call,status:"completed",result:"Actual private result."})
      const records=readFileSync(join(root,"guard.jsonl"),"utf8").trim().split("\n").map(JSON.parse),observed=nativeMemoryCalls(records,context)
      assert.equal(observed.length,1);assert.deepEqual(observed[0].args,input)
      assert.equal(scored('{action:"forget"} && unknown',observed).verdict,action==="forget"?"PASS":"FAIL")
      assert.equal(nativeMemoryCalls(records,{...context,activation_id:"foreign_activation"}),undefined)
    }finally{await dispose?.();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value}rmSync(root,{recursive:true,force:true})}
  }
})

test("literal reader default retains prefix semantics while complete mode rejects suffixes and unclosed trivia",()=>{
  const raw='{action:"forget"} && {action:"retire"}'
  assert.deepEqual(readLiteral(raw),{ok:true,value:{action:"forget"}})
  assert.deepEqual(readLiteral(raw,{}),readLiteral(raw))
  for(const text of [raw,'{action:"forget"} /* unclosed','{action:"forget"}()','{action:"forget"}, {}','{action:"forget",nested:{x:unknown}}'])assert.equal(readLiteral(text,{complete:true}).ok,false,text)
  assert.deepEqual(readLiteral('/* leading */ {action:"forget",nested:[1,true,null]} /* closed */',{complete:true}),{ok:true,value:{action:"forget",nested:[1,true,null]}})
})
