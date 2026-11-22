// Pure guarded host-request values, not actual OpenCode asks.
import { test } from "node:test"
import assert from "node:assert/strict"
import { memoryReply, registerMemoryScopes } from "../src/run/guard/mem-permissions.mjs"
import { memoryCall } from "../src/run/guard/mem-targets.mjs"
import { buildPolicy } from "../src/run/guard/policy.mjs"
const policy=()=>({mode:"commit",memoryBinding:{schema:"oc-mem-contained/1",fixture:"mem-synthetic-v1",backend:"container",origin:"http://127.0.0.1:4617"},memoryReplies:{"memory.forget":"once"}})
test("real store-created IDs gain scope only from the contained authority, never from model results",()=>{
  const p=policy(),id="rec_01KABCDE1234567890ABCDEFGH"
  assert.equal(memoryCall("mem_revise",{action:"forget",id},p.memoryBinding).write,true)
  assert.ok(memoryCall("mem_revise",{action:"forget",id},p.memoryBinding).error)
  registerMemoryScopes(p,{schema:"oc-mem-scopes/1",fixture:"mem-synthetic-v1",record_spaces:{[id]:"spc-eval-personal"},wiki_spaces:{}})
  assert.equal(memoryCall("mem_revise",{action:"forget",id},p.memoryBinding).target,"spc-eval-personal")
  assert.throws(()=>registerMemoryScopes(p,{schema:"oc-mem-scopes/1",fixture:"mem-synthetic-v1",record_spaces:{[id]:"production"}}),/scope/)
})
test("ask approval is one-use, source/session/action bound; explicit deny, foreign and unmatched asks are never approved",()=>{
  const p=policy(),active=new Map([["ses_a:call_1",{tool:"mem_revise",input:{action:"forget",id:"rec_eval_1"},pass:true,target:"spc-eval-personal"}]])
  const ask={id:"ask_1",sessionID:"ses_a",action:"memory.forget",source:{type:"tool",id:"call_1"},resources:["rec_eval_1"]}
  assert.equal(memoryReply(p,ask,active),"once")
  for(const mutation of [{sessionID:"foreign"},{source:{id:"foreign"}},{action:"share.grant"},{resources:["rec_production"]},{effect:"deny"}])assert.notEqual(memoryReply(p,{...ask,...mutation},active),"once")
  p.memoryReplies["memory.forget"]="reject";assert.equal(memoryReply(p,ask,active),"reject")
  assert.equal(memoryReply({},ask,active),null,"generic plugins retain the upstream responder")
})
test("only bound Memory commit policies may carry explicit action reply instructions",()=>{
  const p=policy(),packs=[{id:"mem",pluginId:"mem",tools:[]}]
  const bound=buildPolicy({mode:"commit",packs,memoryBinding:p.memoryBinding,memoryReplies:p.memoryReplies})
  assert.deepEqual(bound.memoryReplies,{"memory.forget":"once"})
  assert.ok(bound.actions.includes("memory.forget"))
  assert.equal(buildPolicy({mode:"commit",packs:[],memoryReplies:p.memoryReplies}).memoryReplies,undefined)
  assert.throws(()=>buildPolicy({mode:"commit",packs,memoryBinding:p.memoryBinding,memoryReplies:{"share.grant":"always"}}),/reply/)
})
