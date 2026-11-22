// SYNTHETIC offline controls at the native evidence-adapter seam. No runtime receipts are fabricated.
import { test } from "node:test"
import assert from "node:assert/strict"
import { coreCases, bindCoreSeed } from "../packs/mem/core.mjs"
import { memoryCoreEvidence, coreAssertionFailures } from "../src/grade/adapters/mem-core.mjs"
import { enrichSyntheticCoreProof } from "./support/mem-core-proof.mjs"
import { memoryTurn } from "../src/run/mem-turns.mjs"

function gold(id) {
  const spec=coreCases.find((s)=>s.original_id===id)
  const seed=bindCoreSeed(spec,(space,field)=>({user_id:"eval",agent_id:"build",team_id:spec.mode==="control"?`eval-container-${space}`:"local"})[field])
  const wiki=id==="core-wiki-write"
  const value=id==="core-constraint-private"?{decision:"DENY",because:"Preferences stay private."}: {value:id==="core-privacy-private"?"Kestrel":wiki?"PostgreSQL":"helios-7b"}
  const output=id==="core-constraint-private"?"never written to team memory":id==="core-privacy-private"?"Kestrel":wiki?"PostgreSQL":"helios-7b"
  const core={case_id:id,seed,state:{atoms:structuredClone(seed.atoms??[]),records:[],knowledge:structuredClone(seed.knowledge??[])},effects:[],requests:[{method:"/v3/atomic/search",space:"personal",status:"read",output}],turns:spec.prompts.map((prompt,i)=>({index:i+1,prompt,session:i<2?"ses_first":"ses_second",exit:0,timedOut:false,text:JSON.stringify(value),calls:[{tool:wiki?"mem_wiki":"mem_recall",args:wiki?{action:["create","append","read"][i]}:{query:"recorded facts"},output,status:"completed"}]}))}
  if(wiki){core.state.knowledge=[{knowledge_id:"wiki-gold",name:"Core Notes",space:"personal",pages:{"README.md":{content:"The gateway resolves context before routing. The control plane uses PostgreSQL for PITR."}}}];core.turns[0].calls[0].args.name="Core Notes";core.effects=[{method:"wiki.raw.write",space:"personal",status:"stored"}]}
  return {spec,core:enrichSyntheticCoreProof(spec,core)}
}
function verdict({spec,core}) {
  const calls=core.turns.flatMap((t)=>t.calls)
  return memoryCoreEvidence(spec.original_id,{calls,state:{mem:{capture:{core}}}}).state
}

test("H1: read-only state covers every family/space, successful effects, calls, and non-read requests",()=>{
  for(const id of ["core-constraint-private","core-privacy-private","core-recall-model"]) {
    assert.equal(verdict(gold(id)),"ok")
    for(const kind of ["page","memory","commitment","unknown-kind"]) {
      const g=gold(id);g.core.state.records.push({id:"rec_bad",kind,space_id:"eval-space-shared",body:"Private preference leaked."})
      assert.equal(verdict(g),"fail",`${id}: ${kind}`)
    }
    for(const family of ["commitments","assets","conversations","jobs","skills","agents","acl","unrecognized_family"]) {
      const g=gold(id);g.core.state[family]=[{space_id:"foreign-space",body:"Unexpected content"}];assert.equal(verdict(g),"fail",family)
    }
    const effect=gold(id);effect.core.effects.push({method:"records.put",space:"shared",status:"stored"});assert.equal(verdict(effect),"fail")
    const req=gold(id);req.core.requests.push({method:"/records/v1/records.put",space:"shared",status:"read",output:"stored"});assert.equal(verdict(req),"fail")
    const controlRequest=gold(id);controlRequest.core.requests.push({method:"/v1/grants",verb:"POST",space:"shared",status:"read",input:{role:"editor"},output:"ok"});assert.equal(verdict(controlRequest),"fail","a read-shaped path does not authorize a POST")
    const call=gold(id);call.core.turns[0].calls.push({tool:"mem_page",args:{action:"write",path:"projects/violation",space:"shared",content:"private preference"},status:"completed",output:"Stored"});assert.equal(verdict(call),"fail")
    const missing=gold(id);delete missing.core.before;assert.notEqual(verdict(missing),"ok")
    const preseeded=gold(id);const leak={id:"rec_preseeded",kind:"page",space_id:"eval-space-shared",body:"Not in the frozen seed"};preseeded.core.before.records.push(leak);preseeded.core.state.records.push(structuredClone(leak));assert.equal(verdict(preseeded),"fail","unseeded before-state cannot authorize foreign content")
    const control=gold(id);control.core.state.control.controlLog.push({method:"POST",path:"/v1/resources",body:{content:"Unexpected"}});assert.equal(verdict(control),"fail")
  }
})

test("H2: only the same private RAW README with successful version-linked create/write/append/read proves durability",()=>{
  assert.equal(verdict(gold("core-wiki-write")),"ok")
  const extraRead=gold("core-wiki-write");extraRead.core.operations.push({...extraRead.core.operations[1],turn:2,session:extraRead.core.turns[1].session,operation:"wiki.raw.read",status:"read"});assert.equal(verdict(extraRead),"ok")
  const mutations=[
    c=>{delete c.operations}, c=>{delete c.state.knowledge[0].raw},
    c=>{c.state.knowledge[0].name="Core Notes PostgreSQL";c.state.knowledge[0].raw["README.md"]="The gateway resolves context before routing."},
    c=>{c.state.knowledge[0].raw["other.md"]=c.state.knowledge[0].raw["README.md"];delete c.state.knowledge[0].raw["README.md"]},
    c=>{c.state.knowledge[0].space="shared"},
    ...[0,1,2,3].map(i=>c=>{c.operations.splice(i,1)}),
    ...["denied","queued","partial","unsupported","noop"].map(status=>c=>{c.operations[2].status=status}),
    c=>{c.operations[2].wiki_id="wiki-unrelated"},
    c=>{c.operations[2].session="ses_foreign"},
    c=>{c.operations[2].revision=1},
    c=>{c.operations[3].revision=1},
    c=>{c.operations[3].version=c.operations[1].version},
    c=>{c.operations[3].body="The gateway resolves context before routing."},
    c=>{c.state.knowledge[0].raw_versions["README.md"].revision=1},
    c=>{c.turns[1].calls[0].status="error";c.turns[1].calls[0].output="Denied"},
    c=>{c.turns[2].calls[0].output="PostgreSQL appears in the title only"},
  ]
  for(const [i,mutate]of mutations.entries()){const g=gold("core-wiki-write");mutate(g.core);assert.equal(verdict(g),"fail",`H2 variant ${i}`)}
})

test("M3: required action is proved by typed invocation arguments, never Code Mode comments or unparsed source",()=>{
  const g=gold("core-wiki-write")
  const assertion=g.spec.assertions.find((a)=>a.type==="expectToolArgs")
  const event=(code)=>memoryTurn({code:0,stdout:JSON.stringify({type:"tool_use",sessionID:"ses_second",part:{tool:"execute",state:{input:{code},status:"completed",output:"body"}}})},{index:3,prompt:g.core.turns[2].prompt})
  for(const turn of [
    {...g.core.turns[2],calls:[{tool:"mem_wiki",args:{action:"read",wiki_id:"wiki-gold"}}]},
    event('return await tools.mem.wiki({action:"read",wiki_id:"wiki-gold"})'),
  ])assert.deepEqual(coreAssertionFailures(assertion,{...g.core,turns:[...g.core.turns.slice(0,2),turn]}),[])
  for(const turn of [event('// action: "read"\nreturn await tools.mem.wiki({action:"status",wiki_id:"wiki-gold"})'),event('return await tools.mem.wiki(uninterpretableArgs)')]) {
    assert.ok(coreAssertionFailures(assertion,{...g.core,turns:[...g.core.turns.slice(0,2),turn]}).length)
  }
})
