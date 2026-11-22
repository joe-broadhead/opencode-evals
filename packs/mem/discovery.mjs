// One backend contract per preregistered family; tool names/arguments bind independently per immutable arm.
import { memCases } from "./cases.mjs"
import { checkMemoryInput } from "./profile.mjs"
const backends={
  memory:{method:"records.put",oracle:"personal memory row; stored receipt, not queued/denied"},
  page:{method:"records.put",oracle:"personal page path/body; no memory row"},
  commitment:{method:"records.put",oracle:"personal commitment row; no invented date"},
  "wiki-write":{path:"/v3/wiki/raw/write",oracle:"exact raw document, not a page or memory"},
  "wiki-read":{path:"/v3/wiki/raw/read",oracle:"QUARTZ-92 from personal raw source"},
  browse:{method:"records.list",oracle:"limit one; cursor and more:true; answer must state partiality"},
  "exact-read":{method:"records.get",input:{ids:["$created.record"]},oracle:"full exact current body; missing/partial/wrong-id fails"},
  code:{path:"/v3/code-graph/callers",input:{code_graph_id:"$seed.code_graph",symbol:"parseInvoice"},oracle:"incoming synthetic call edge; page backlinks cannot satisfy"},
  "wiki-graph":{path:"/v3/wiki/graph",input:{wiki_id:"$seed.wiki"},oracle:"synthetic nodes/edges/communities; code graph cannot satisfy"},
  sources:{method:"sources.request",input:{source:"gmail",account:"quartz-synthetic"},oracle:"request state requested and zero confirmed bindings; console confirmation is still needed"},
  jobs:{method:"jobs.draft",input:{template:"slack-threads-project",project:"quartz",account:"quartz-synthetic"},oracle:"draft job, null next_due; never activate or claim a run"},
}
export const discoveryContracts=memCases.map((s)=>({id:s.id,family:s.family,prompt:s.prompt,backend:backends[s.family]??null,...(!backends[s.family]?{unsupported:"Frozen baseline has skill list/get/create/update/delete, but no stored-skill version-history endpoint. Final read schema and an authoritative history contract are not yet supplied."}:{}),...(s.tool?{baseline_binding:{tool:s.tool,args:s.args}}:{})}))
export function bindDiscoveryContracts({arm,catalog,bindings}) {
  if(typeof arm!=="string"||!arm||!catalog?.source||!Array.isArray(catalog.tools)||!bindings||typeof bindings!=="object")throw new Error("immutable arm, catalog and explicit bindings required")
  return discoveryContracts.map((c)=>{
    const binding=bindings[c.family]??(arm==="baseline-586"?c.baseline_binding:null)
    if(!c.backend)return {...c,arm,status:"unsupported-backend-contract",runtime_verified:false}
    if(!binding)return {...c,arm,status:"pending-final-schema",runtime_verified:false}
    const schema=catalog.tools.find((t)=>t.name===binding.tool)?.input
    if(schema?.type!=="object"||schema.additionalProperties!==false||checkMemoryInput(catalog,binding.tool,binding.args).length)throw new Error(`${c.id}: binding does not match the captured closed schema`)
    return {...c,arm,binding,status:"schema-bound-offline",runtime_verified:false,catalog_provenance:catalog.source}
  })
}
