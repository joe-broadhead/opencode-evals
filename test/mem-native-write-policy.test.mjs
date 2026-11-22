// Opt-in executor seam only. No changes to the generic guard's default policy.
import {test} from "node:test"
import assert from "node:assert/strict"
import {createNativeAuthority} from "../src/run/guard/mem-native-authority.mjs"
import {nativeOperationPlan} from "../src/run/mem-operation-plan.mjs"
import {coreMemoryIntent} from "../src/run/mem-intent-plan.mjs"
import {discoveryCases,discoveryIntent} from "../packs/mem/discovery-plan.mjs"
import {createBaselineProof} from "../worlds/mem/baseline-proof.mjs"

const cases={remember:"commit-mem-memory",page:"commit-mem-page",commitments:"commit-mem-commitment",wiki:"commit-mem-wiki-write",spaces:"deep-mem-sources",revise:"core-forget"}
const personal="spc-eval-personal"
async function fixture(family,tool,entries) {
  const id=cases[family],intent=family==="revise"
    ?coreMemoryIntent({original_id:id,prompts:["remember","forget","read"]},"trial_policy",Date.now()+60000)
    :discoveryIntent(discoveryCases.find(c=>c.id===id),"trial_policy",Date.now()+60000)
  let activation={schema:"oc-mem-native-activation/1",case_id:id,trial_id:intent.trial_id,trial:1,turn:1,session:"ses_policy",activation_id:"activation_1",incarnation:1,generation:"generation_policy",active:true}
  const scopes={schema:"oc-mem-scopes/1",fixture:"mem-synthetic-v1",case_id:id,trial_id:intent.trial_id,record_spaces:{},wiki_spaces:{},creators:[]}
  const input=family==="revise"?{action:"forget",id:"rec_policy"}:structuredClone(intent.turns[0].calls[0].args)
  const policy={mode:"commit",memoryIntent:intent,memoryOperationPlan:nativeOperationPlan(intent),memoryBinding:{schema:"oc-mem-contained/1",fixture:"mem-synthetic-v1",backend:"container",origin:"http://127.0.0.1:4617"},known:[tool,"mem_remember","mem_recall","mem.recall"],tools:{exact:[tool,"mem_remember","mem_recall","mem.recall"]},writes:entries(input)}
  if(family==="revise")policy.writes.push({names:["mem_remember"],memory:"remember",allow:[personal]})
  const authority=createNativeAuthority(policy,{readActivation:()=>structuredClone(activation),readScopes:()=>structuredClone(scopes),readCompletion:()=>null})
  authority.open()
  const native={sessionID:activation.session,messageID:"message_policy",id:"carrier_policy"}
  if(family==="revise"){
    const proof=createBaselineProof({records:[]},{},intent)
    await authority.execute({native,tool:"mem_remember",input:intent.turns[0].calls[0].args},e=>{
      const record={id:"rec_policy",kind:"memory",body:"The staging port is 8420.",space_id:"local"}
      proof.observe({path:"/records/v1/records.put",input:{record:{body:record.body,type:"fact"}},response:{status:200,json:{record}},before:{records:[]},after:{records:[record]},space:"personal",request_session:activation.session,context:activation,invocation:e.receipt()})
    })
    assert.equal(proof.creators.length,1)
    scopes.record_spaces.rec_policy=personal;scopes.creators=proof.creators
    authority.cancel();activation={...activation,turn:2,incarnation:2,activation_id:"activation_2"};authority.open()
  }
  return {authority,request:{native,tool,input}}
}

for(const family of Object.keys(cases))for(const separator of ["_","."]){
  const tool=`mem${separator}${family}`,entry={names:[tool],memory:family,allow:[personal]}
  test(`${tool}: a literal operation use also requires its explicit family/target write policy`,async()=>{
    const variants=[
      ["missing entry",()=>[]],
      ["lookalike name",()=>[{...entry,names:[`${tool}.extra`]}]],
      ["missing Memory extractor",()=>[{names:[tool],allow:[personal]}]],
      ["wrong Memory extractor",()=>[{...entry,memory:"recall"}]],
      ["wrong target",()=>[{...entry,allow:["spc-eval-shared"]}]],
      ["missing target",()=>[{names:[tool],memory:family}]],
      ["generic local bypass",()=>[{names:[tool],local:true}]],
      ["generic payload extractor",input=>{const key=({remember:"content",page:"content",wiki:"content",commitments:"what",spaces:"action",revise:"id"})[family];return [{names:[tool],extract:`args.${key}`,allow:[input[key]]}]}],
      ["correct entry",()=>[entry]],
    ]
    for(const [name,entries]of variants){
      const {authority:a,request}=await fixture(family,tool,entries);let effects=0
      const execute=()=>a.execute(request,e=>{effects++;assert.ok(e.receipt().grant_id);return "stored"})
      try{
        if(name==="correct entry"){
          assert.equal(await execute(),"stored")
          await assert.rejects(execute(),/consumed/)
          assert.equal(effects,1)
        }else{
          await assert.rejects(execute(),/policy|write|target|extractor|scope/,name)
          assert.equal(effects,0,name)
        }
      }finally{a.close()}
    }
  })
}

test("known recall aliases still delegate repeated reads when writes is empty",async()=>{
  const {authority:a,request}=await fixture("remember","mem_remember",()=>[]);let reads=0
  try{
    for(const tool of ["mem_recall","mem.recall","mem_recall"])await a.execute({...request,tool,input:{query:"Quartz"}},e=>{reads++;assert.equal(e.receipt().grant_id,null)})
    assert.equal(reads,3)
  }finally{a.close()}
})
