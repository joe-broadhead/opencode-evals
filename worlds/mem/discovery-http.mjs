// Pure closed HTTP codec. Roles and placement are fake gateway decisions, never tool arguments.
const SPACES={personal:"personal",shared:"shared","eval-space-personal":"personal","spc-eval-personal":"personal","eval-space-shared":"shared","spc-eval-shared":"shared"}
const OPS=["records.put","records.get","records.list","records.search","wiki.raw.write","wiki.raw.read","wiki.page.read","wiki.page.ls","wiki.graph","wiki.list","wiki.get","wiki.ingest","knowledge.list","meta.asset.list-accessible","meta.asset.touch-usage","meta.agent.list","meta.team-member.list","code-graph.list","code-graph.get","code-graph.status","code-graph.files","code-graph.node","code-graph.callees","code-graph.impact","code-graph.explore","code-graph.search","code-graph.callers","skill.list","skill.get","skill.search","skill.versions","sources.list","sources.request","plugins.list","jobs.templates","jobs.list","jobs.get","jobs.draft","jobs.versions","jobs.runs","jobs.logs","jobs.diff","jobs.items","jobs.hosts"]
const ROUTES=Object.fromEntries(OPS.flatMap(op=>op.startsWith("records.")||/^(?:sources|jobs|plugins)\./.test(op)?[[`/records/v1/${op}`,op]]:[`/v3/${op.replaceAll(".","/")}`,`/core/v3/${op.replaceAll(".","/")}`,`/knowledge/v3/${op.replaceAll(".","/")}`].map(p=>[p,op])))
export const discoveryRoute=(method,path)=>method==="POST"?ROUTES[path]??null:null
export function discoveryResponse(store,{method,path,headers={},body={}},{context=null,invocation=null}={}){
  const result=(status,json)=>({status,json})
  if(method==="GET"&&path==="/health")return result(200,{fixture:"mem-synthetic-v1",transport:"discovery-v2"})
  if(headers.authorization!=="Bearer eval-token")return result(401,{error:{code:"synthetic_credential_required"}})
  if(Object.keys(headers).some(k=>k.toLowerCase().startsWith("x-records-"))||headers["x-tdai-user-id"]&&headers["x-tdai-user-id"]!=="eval")return result(403,{error:{code:"caller_identity_refused"}})
  if(typeof path!=="string"||path.includes("%")||path.includes("..")||!/^\/[A-Za-z0-9_./?=&-]+$/.test(path))return result(400,{error:{code:"invalid_path"}})
  const url=new URL(path,"http://synthetic.invalid");path=url.pathname
  if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(k=>["role","actor","authorization","token","readOnly","space","owner","user"].includes(k)))return result(400,{error:{code:"invalid_input"}})
  let space=headers["x-mem-space-id"]?SPACES[headers["x-mem-space-id"]]:"personal"
  if(!space)return result(403,{error:{code:"scope_denied"}})
  if(path==="/v1/context"&&method==="POST"){
    if(body.space_id){const selected=SPACES[body.space_id];if(!selected)return result(403,{error:{code:"scope_denied"}});space=selected}
    if(body.user_id&&body.user_id!=="eval")return result(403,{error:{code:"identity_denied"}})
    return result(200,{user_id:"eval",space:{id:`eval-space-${space}`,name:space==="personal"?"Personal Workspace":"Shared Workspace",kind:space,role:space==="personal"?"owner":"viewer"},collection:{id:`eval-collection-${space}`,name:"Synthetic collection"},placement:{container_id:`eval-container-${space}`,cell_id:"eval-cell",service_id:"eval-service"},session:{space_id:`eval-space-${space}`},personal_space:{id:"eval-space-personal",name:"Personal Workspace",kind:"personal"}})
  }
  if(path==="/v1/spaces"&&method==="GET"){if(url.searchParams.has("user_id")&&url.searchParams.get("user_id")!=="eval")return result(403,{error:{code:"identity_denied"}});return result(200,{spaces:[{id:"eval-space-personal",name:"Personal Workspace",kind:"personal",role:"owner"},{id:"eval-space-shared",name:"Shared Workspace",kind:"shared",role:"viewer"}]})}
  if((path.startsWith("/v1/grants")||path.startsWith("/v1/resources"))&&method==="GET")return result(200,path.startsWith("/v1/grants")?{grants:[]}:{resources:[]})
  const rawInventory=method==="POST"&&["/v3/tools/call","/core/v3/tools/call","/knowledge/v3/tools/call"].includes(path)
  const op=rawInventory?"wiki.raw.list":discoveryRoute(method,path)
  if(!op)return result(404,{error:{code:"unsupported_operation"}})
  const input={...body}
  for(const[k,allowed]of Object.entries({user_id:["eval"],agent_id:["build"],team_id:[`eval-container-${space}`],space_id:[`eval-space-${space}`]})){
    if(input[k]!==undefined&&!allowed.includes(input[k]))return result(403,{error:{code:"scope_identity_mismatch"}})
    delete input[k]
  }
  if(input.session_id!==undefined&&input.session_id!==context?.session)return result(403,{error:{code:"foreign_session"}})
  delete input.session_id
  if(rawInventory){if(input.tool_name!=="list_raw"||typeof input.knowledge_id!=="string"||JSON.stringify(input.params)!=="{}"||Object.keys(input).some(k=>!["tool_name","knowledge_id","params"].includes(k)))return result(409,{error:{code:"unsupported_tool_dispatch"}});input.wiki_id=input.knowledge_id;delete input.knowledge_id;delete input.params;delete input.tool_name}
  const answer=store.request(op,input,{space,context,invocation})
  return result(answer.status,path.includes("/v3/")?(answer.status===200?{code:0,data:answer.json}:{code:"fixture_rejected",error:answer.json.error}):answer.json)
}
