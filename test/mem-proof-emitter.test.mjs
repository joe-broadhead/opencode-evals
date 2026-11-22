// Pure observed backend values at the emitter seam. Never opens the frozen HTTP listener.
import {test} from "node:test"
import assert from "node:assert/strict"
import {createBaselineProof} from "../worlds/mem/baseline-proof.mjs"
import {coreMemoryIntent} from "../src/run/mem-intent-plan.mjs"
import {coreCases} from "../packs/mem/core.mjs"
import {memoryCoreEvidence} from "../src/grade/adapters/mem-core.mjs"
import {mkdtempSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {openRecordsStore,handleRecords} from "../worlds/mem/baseline-586/stub/records-adapter.js"
import {recordsHeaders} from "../worlds/mem/baseline-586/scripts/eval/records-world.mjs"
import {CONTROL_SPACES} from "../worlds/mem/baseline-586/scripts/eval/harness-state.mjs"
const empty=()=>({atoms:[],records:[],commitments:[],knowledge:[],conversations:[],scenarios:{},core:{},skills:[],assets:[],teamMembers:[],agents:[],acl:[],usage:{},jobs:[],curated:{},failures:{},seq:0,wikiFiles:[]})
const control={resources:[],grants:[],controlLog:[]}
test("authoritative projection preserves records in every family/space rather than hiding them in atoms",()=>{
  const raw=empty();raw.records.push({id:"rec_1",kind:"memory",body:"Private.",space_id:"eval-space-shared"},{id:"rec_2",kind:"page",body:"Page.",space_id:"foreign"})
  raw.extra_family=[{id:"unknown",body:"Do not discard"}]
  const proof=createBaselineProof(raw,control,null),state=proof.state(raw,control)
  assert.deepEqual(state.records,raw.records);assert.deepEqual(state.atoms,[]);assert.deepEqual(state.extra_family,raw.extra_family)
  assert.deepEqual(state.control,control);assert.deepEqual(proof.before.records,raw.records)
})
test("RAW operation receipts capture observed per-turn versions; denied/no-op writes cannot borrow the initial success",()=>{
  const intent=coreMemoryIntent(coreCases.find(s=>s.original_id==="core-wiki-write"),"trial_1",Date.now()+60000)
  const proof=createBaselineProof(empty(),control,intent)
  const wiki={knowledge_id:"wiki_backend_1",name:"Core Notes",type:"llm_wiki",team_id:"local",raw:{}}
  const prior=empty(),created={...empty(),knowledge:[wiki]}
  const context={case_id:"core-wiki-write",trial_id:"trial_1",turn:1,session:"ses_own",active:true}
  const invocation={...context,family:"wiki",args:{action:"create",name:"Core Notes"},pass:true,call_id:"call_create"}
  proof.observe({path:"/v3/wiki/create",input:{name:"Core Notes",team_id:"local"},response:{status:200,json:{data:{knowledge_id:wiki.knowledge_id}}},before:prior,after:created,space:"personal",context,invocation})
  assert.equal(proof.creators.length,1);assert.equal(proof.creators[0].id,"wiki_backend_1")
  const initial="The gateway resolves context before routing.",final=`${initial}\n\nThe control plane uses PostgreSQL for PITR.`
  const first={...empty(),knowledge:[{...wiki,raw:{"README.md":initial}}]}
  const event={path:"/v3/wiki/raw/write",input:{wiki_id:wiki.knowledge_id,files:[{filename:"README.md",content:initial}]},response:{status:200,json:{data:{items:[{filename:"README.md",status:"written"}]}}},before:created,after:first,space:"personal",context,invocation:{...invocation,call_id:"call_write",args:{action:"write",wiki_id:wiki.knowledge_id,filename:"README.md",content:initial}}}
  proof.observe(event)
  const appendContext={...context,turn:2}
  proof.observe({...event,context:appendContext,before:first,after:first,response:{status:403,json:{error:"denied"}},input:{...event.input,files:[{filename:"README.md",content:final}]}})
  assert.equal(proof.operations[2].status,"denied");assert.equal(proof.state(first,control).knowledge[0].raw_versions["README.md"].revision,1)
  proof.observe({...event,context:appendContext,before:first,after:first})
  assert.equal(proof.operations[3].status,"partial")
  const applied={...first,knowledge:[{...wiki,raw:{"README.md":final}}]}
  proof.observe({...event,context:appendContext,before:first,after:applied,input:{...event.input,files:[{filename:"README.md",content:final}]}})
  const append=proof.operations[4];assert.equal(append.revision,2);assert.equal(append.before_version,proof.operations[1].version);assert.equal(append.body,final)
  proof.observe({path:"/v3/wiki/raw/read",input:{wiki_id:wiki.knowledge_id,filenames:["README.md"]},response:{status:200,json:{data:{items:[{filename:"README.md",content:final}]}}},before:applied,after:applied,space:"personal",context:{...context,turn:3}})
  assert.equal(proof.operations[5].version,append.version);assert.equal(proof.operations[5].body,final)
  const denied=createBaselineProof(empty(),control,intent)
  denied.observe({path:"/v3/wiki/create",input:{name:"Unrelated"},response:{status:200,json:{data:{knowledge_id:wiki.knowledge_id}}},before:prior,after:created,space:"personal",context,invocation})
  assert.equal(denied.creators.length,0,"a returned ID alone is not creator authority")
})

test("store-created memory alias is justified by actual pure records-store readback and native creator payload",async()=>{
  const root=mkdtempSync(join(tmpdir(),"mem-proof-store-")),store=await openRecordsStore({dataDir:root,now:()=>new Date("2026-11-12T10:00:00Z")})
  try {
    const intent=coreMemoryIntent(coreCases.find(s=>s.original_id==="core-forget"),"trial_store",Date.now()+60000),proof=createBaselineProof(empty(),control,intent)
    const input={record:{kind:"memory",type:"fact",body:"The staging port is 8420."}}
    const headers=recordsHeaders(CONTROL_SPACES.personal,{user:"eval",agent:"build",session:"ses_store"})
    const response=await handleRecords(store,"records.put",input,headers)
    const read=await handleRecords(store,"records.get",{ids:[response.json.record.id]},headers)
    const after={...empty(),records:read.json.records.map(r=>({...r,space_id:"eval-space-personal"}))}
    const context={case_id:"core-forget",trial_id:"trial_store",turn:1,session:"ses_store",active:true}
    const invocation={...context,family:"remember",args:{content:"The staging port is 8420.",kind:"fact"},call_id:"call_store",pass:true}
    proof.observe({path:"/records/v1/records.put",input,response,before:empty(),after,space:"personal",context,invocation})
    assert.equal(proof.creators.length,1);assert.equal(proof.creators[0].id,read.json.records[0].id)
    const forged=createBaselineProof(empty(),control,intent)
    forged.observe({path:"/records/v1/records.put",input,response,before:empty(),after:{...after,records:after.records.map(r=>({...r,space_id:"eval-space-shared"}))},space:"personal",context,invocation})
    assert.deepEqual(forged.creators,[])
  }finally{await store.close();rmSync(root,{recursive:true,force:true})}
})

test("the actual projector/recorder shape, with no synthetic enricher, satisfies strict wiki grading only after the observed append and read",()=>{
  const spec=coreCases.find(s=>s.original_id==="core-wiki-write"),intent=coreMemoryIntent(spec,"trial_grade",Date.now()+60000),proof=createBaselineProof(empty(),control,intent)
  const initial="The gateway resolves context before routing.",final=`${initial}\n\nThe control plane uses PostgreSQL for PITR.`,id="wiki_backend_2"
  const row={knowledge_id:id,name:"Core Notes",type:"llm_wiki",team_id:"local",raw:{}}
  const created={...empty(),knowledge:[row]},first={...created,knowledge:[{...row,raw:{"README.md":initial}}]},after={...created,knowledge:[{...row,raw:{"README.md":final}}],wikiFiles:[{team_id:"local",wiki:"Core Notes",wiki_id:id,filename:"README.md",content:final}]}
  const context=t=>({case_id:spec.original_id,trial_id:"trial_grade",turn:t,session:t===3?"ses_new":"ses_first",active:true})
  proof.observe({path:"/v3/wiki/create",input:{name:"Core Notes"},response:{status:200,json:{data:{wiki_id:id}}},before:empty(),after:created,space:"personal",context:context(1)})
  const write=(turn,before,after,body)=>({path:"/v3/wiki/raw/write",input:{wiki_id:id,files:[{filename:"README.md",content:body}]},response:{status:200,json:{data:{items:[{filename:"README.md",status:"written"}]}}},before,after,space:"personal",context:context(turn)})
  proof.observe(write(1,created,first,initial));proof.observe(write(2,first,after,final))
  proof.observe({path:"/v3/wiki/raw/read",input:{wiki_id:id,filenames:["README.md"]},response:{status:200,json:{data:{items:[{filename:"README.md",content:final}]}}},before:after,after,space:"personal",context:context(3)})
  const calls=[{tool:"mem_wiki",args:{action:"create",name:"Core Notes"},status:"completed",output:"Created."},{tool:"mem_wiki",args:{action:"append",wiki_id:id,filename:"README.md",content:"The control plane uses PostgreSQL for PITR."},status:"completed",output:"Appended."},{tool:"mem_wiki",args:{action:"read",wiki_id:id,filename:"README.md"},status:"completed",output:final}]
  const core={case_id:spec.original_id,proof_schema:"oc-mem-durable-proof/2",seed:{},before:proof.before,state:proof.state(after,control),operations:proof.operations,effects:[{method:"wiki.raw.write",space:"personal",status:"stored"}],requests:[{method:"/v3/wiki/raw/read",space:"personal",status:"read",output:final}],turns:spec.prompts.map((prompt,i)=>({index:i+1,prompt,session:context(i+1).session,exit:0,timedOut:false,text:i===2?'{"value":"PostgreSQL"}':"Stored.",calls:[calls[i]]}))}
  const grade=()=>memoryCoreEvidence(spec.original_id,{calls,state:{mem:{capture:{core}}}})
  assert.equal(grade().state,"ok",grade().detail)
  core.operations=core.operations.filter(o=>o.turn!==2);assert.equal(grade().state,"fail")
})
