// One backend contract per preregistered family; tool names/arguments bind independently per immutable arm.
import { memCases } from "./cases.mjs"
import { checkMemoryInput } from "./profile.mjs"
import {discoveryCases} from "./discovery-plan.mjs"
const backends={
  memory:{method:"records.put",oracle:"personal memory row; stored receipt, not queued/denied"},
  page:{method:"records.put",oracle:"personal page path/body; no memory row"},
  commitment:{method:"records.put",oracle:"personal commitment row; no invented date"},
  "wiki-write":{path:"/v3/wiki/raw/write",oracle:"exact raw document, not a page or memory"},
  "wiki-read":{path:"/v3/wiki/raw/read",oracle:"QUARTZ-92 from personal raw source"},
  browse:{method:"records.list",oracle:"limit one; cursor and more:true; answer must state partiality"},
  "exact-read":{method:"records.get",input:{ids:["$seed.record"]},oracle:"full exact current body; missing/partial/wrong-id fails"},
  code:{path:"/v3/code-graph/callers",input:{code_graph_id:"$seed.code_graph",symbol:"parseInvoice"},oracle:"incoming synthetic call edge; page backlinks cannot satisfy"},
  "wiki-graph":{path:"/v3/wiki/graph",input:{wiki_id:"$seed.wiki"},oracle:"synthetic nodes/edges/communities; code graph cannot satisfy"},
  sources:{method:"sources.request",input:{source:"gmail",account:"quartz-synthetic"},oracle:"request state requested and zero confirmed bindings; console confirmation is still needed"},
  jobs:{method:"jobs.draft",input:{template:"slack-threads-project",project:"quartz",account:"quartz-synthetic"},oracle:"draft job, null next_due; never activate or claim a run"},
  skills:{path:"/v3/skill/versions",input:{skill_id:"$seed.skill",pagination:{limit:50,offset:0}},oracle:"actual scoped stored-skill version summaries, not wiki versions or an invented tag"},
}
export const discoveryContracts=discoveryCases.map((s)=>{const old=memCases.find(c=>c.id===s.id);return {id:s.id,family:s.family,prompt:s.prompt,backend:backends[s.family],source_status:"STATIC-PROVISIONAL-772-not-runtime",...(old.tool?{baseline_binding:{tool:old.tool,args:old.args}}:["sources","jobs"].includes(s.family)?{baseline_binding:s.binding}:{}),provisional_binding:s.binding}})
export function bindDiscoveryContracts({arm,catalog,bindings}) {
  if(typeof arm!=="string"||!arm||!catalog?.source||!Array.isArray(catalog.tools)||!bindings||typeof bindings!=="object")throw new Error("immutable arm, catalog and explicit bindings required")
  return discoveryContracts.map((c)=>{
    const binding=bindings[c.family]??(arm==="baseline-586"?c.baseline_binding:null)
    if(!c.backend)throw new Error(`${c.id}: finite backend contract missing`)
    if(!binding)return {...c,arm,status:arm==="baseline-586"?"expected-baseline-tool-behavior-failure":"pending-final-runtime-schema",runtime_verified:false}
    const schema=catalog.tools.find((t)=>t.name===binding.tool)?.input
    if(schema?.type!=="object"||schema.additionalProperties!==false||checkMemoryInput(catalog,binding.tool,binding.args).length)throw new Error(`${c.id}: binding does not match the captured closed schema`)
    return {...c,arm,binding,status:"schema-bound-offline",runtime_verified:false,catalog_provenance:catalog.source}
  })
}
