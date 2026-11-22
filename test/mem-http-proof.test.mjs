// Actual pure recorder; no HTTP request, listener or model. Literal user document bytes.
import {test} from "node:test"
import assert from "node:assert/strict"
import {createBaselineProof} from "../worlds/mem/baseline-proof.mjs"
import {coreMemoryIntent} from "../src/run/mem-intent-plan.mjs"
import {coreCases} from "../packs/mem/core.mjs"
import {memoryCoreEvidence} from "../src/grade/adapters/mem-core.mjs"
import {baselineObservationIdentity} from "../worlds/mem/baseline-entry.mjs"
const empty=()=>({atoms:[],records:[],commitments:[],knowledge:[],conversations:[],scenarios:{},core:{},skills:[],assets:[],teamMembers:[],agents:[],acl:[],usage:{},jobs:[],curated:{},failures:{},seq:0,wikiFiles:[]})
const ctl={resources:[],grants:[],controlLog:[]}
function recorded(mode){
  const spec=coreCases.find(s=>s.original_id==="core-wiki-write"),intent=coreMemoryIntent(spec,"trial_http",Date.now()+60000),proof=createBaselineProof(empty(),ctl,intent)
  const id="wiki_observed",first="The gateway resolves context before routing.",last=first+"\n\nThe control plane uses PostgreSQL for PITR."
  const context=t=>({case_id:spec.original_id,trial_id:intent.trial_id,turn:t,session:t===3?"ses_new":"ses_first",active:true})
  const row={knowledge_id:id,name:"Core Notes",type:"llm_wiki",team_id:"local",raw:{}}
  const created={...empty(),knowledge:[row]},initial={...created,knowledge:[{...row,raw:{"README.md":first}}]},after={...created,knowledge:[{...row,raw:{"README.md":last}}],wikiFiles:[{team_id:"local",wiki:"Core Notes",wiki_id:id,filename:"README.md",content:last}]}
  const calls=[{tool:"mem_wiki",args:{action:"create",name:"Core Notes"},status:"completed",output:"Created."},{tool:"mem_wiki",args:{action:"append",wiki_id:id,filename:"README.md",content:"The control plane uses PostgreSQL for PITR."},status:"completed",output:"Appended."},{tool:"mem_wiki",args:{action:"read",wiki_id:id,filename:"README.md"},status:"completed",output:last}]
  function observe(e){
    const c=context(e.turn),badTurn=mode.endsWith("create")?1:mode==="foreign-append"?2:3
    const session=e.turn!==badTurn||!["foreign-final-read","missing-final-read","foreign-append","foreign-create","missing-create"].includes(mode)?c.session:mode.startsWith("missing")?null:"ses_foreign"
    const native={...c,family:"wiki",args:calls[e.turn-1].args,pass:true,call_id:`call_${e.turn}`}
    if(e.turn===badTurn){
      if(mode==="closed-final-read")c.active=false
      if(mode==="foreign-call-final-read")native.session="ses_other_call"
      if(mode==="foreign-trial-final-read")native.trial_id="trial_other"
      if(mode==="foreign-case-final-read")native.case_id="core-other"
      if(mode==="expired-final-read")intent.expires_at=0
    }
    proof.observe({...e,space:"personal",...baselineObservationIdentity(session?{"x-tdai-session-id":session}:{},c,native)})
  }
  observe({turn:1,path:"/v3/wiki/create",input:{name:"Core Notes"},response:{status:200,json:{data:{wiki_id:id}}},before:empty(),after:created})
  const write=(turn,before,after,body)=>({turn,path:"/v3/wiki/raw/write",input:{wiki_id:id,files:[{filename:"README.md",content:body}]},response:{status:200,json:{data:{items:[{filename:"README.md",status:"written"}]}}},before,after})
  observe(write(1,created,initial,first));observe(write(2,initial,after,last))
  observe({turn:3,path:"/v3/wiki/raw/read",input:{wiki_id:id,filenames:["README.md"]},response:{status:200,json:{data:{items:[{filename:"README.md",content:last}]}}},before:after,after})
  const core={case_id:spec.original_id,trial_id:intent.trial_id,seed:{},proof_schema:"oc-mem-durable-proof/2",before:proof.before,state:proof.state(after,ctl),operations:proof.operations,effects:[{method:"wiki.raw.write",space:"personal",status:"stored"}],requests:[{method:"/v3/wiki/raw/read",verb:"POST",space:"personal",status:"read",output:last}],turns:spec.prompts.map((prompt,i)=>({index:i+1,prompt,session:context(i+1).session,exit:0,timedOut:false,text:i===2?'{"value":"PostgreSQL"}':"Stored.",calls:[calls[i]]}))}
  return {core,proof,grade:()=>memoryCoreEvidence(spec.original_id,{calls,state:{mem:{capture:{core}}}})}
}
for(const mode of ["valid","foreign-final-read","missing-final-read","foreign-append"])test(`H2 actual recorder: ${mode} HTTP session`,()=>{
  const g=recorded(mode)
  assert.equal(g.proof.creators.length,1)
  assert.equal(g.grade().state,mode==="valid"?"ok":"fail",g.grade().detail)
})
for(const mode of ["foreign-create","missing-create","closed-final-read","foreign-call-final-read","foreign-trial-final-read","foreign-case-final-read","expired-final-read"])test(`H2 actual recorder rejects ${mode} authority`,()=>{
  const g=recorded(mode)
  assert.equal(g.grade().state,"fail")
  if(mode.endsWith("create"))assert.equal(g.proof.creators.length,0)
  const unbound=g.core.operations.filter(o=>o.binding==="unbound")
  assert.ok(unbound.length)
  assert.ok(unbound.every(o=>o.turn===null&&o.call_id===null))
  if(mode.startsWith("foreign-")&&["foreign-create","foreign-final-read","foreign-append"].includes(mode))assert.ok(unbound.every(o=>o.request_session==="ses_foreign"&&o.session==="ses_foreign"))
})
