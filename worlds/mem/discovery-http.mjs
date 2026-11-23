// Pure closed HTTP codec. Roles and placement are fake gateway decisions, never tool arguments.
const SPACES={personal:"personal",shared:"shared","eval-space-personal":"personal","spc-eval-personal":"personal","eval-space-shared":"shared","spc-eval-shared":"shared"}
// The real control plane's agent-name rule (control/src/service/shared.js:59).
const AGENT_PATTERN=/^[A-Za-z0-9._:-]+$/
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
   if(headers["x-tdai-session-id"]!==undefined&&headers["x-tdai-session-id"]!==context?.session)return result(403,{error:{code:"foreign_session"}})
   // The real plugin's backend probe: GET <baseURL>/health, and the eval's
   // baseURL is the /core-prefixed origin. The real gateway strips the prefix
   // and forwards upstream /health to the cell (deploy/auth/http/router.mjs:653-672),
   // where it is a read for every role exactly because it is this probe
   // (deploy/auth/role-guard.mjs:29-32; test/spaces-proxy.test.js:1378-1382).
   // The real body carries status "ok" (deploy/auth/http/router.mjs:546; the
   // frozen product eval control baseline-586/scripts/eval/harness-control.mjs:83-85).
   // Answered on the caller's token alone, never the turn window: the real
   // gateway answers it whenever the caller is authenticated, so a setup probe
   // before the eval's turn activates still succeeds.
   if(method==="GET"&&path==="/core/health")return result(200,{status:"ok"})
   // The plugin's discovery report (arm src/plugins/discovery.js): the real
   // records service serves POST /v1/plugins.report (records/src/server.js:78,441-462),
   // validates this envelope (records/src/store.js:7307-7309, cap store.js:421)
   // and answers {plugins, refused} (store.js:7419); the gateway lets an editor
   // call it (deploy/auth/records-guard.mjs:78). Codec-level on purpose: the
   // finite store keeps no plugin rows (plugins.list answers none) and the
   // graded capture records only case operations, so the accepted report never
   // enters capture.json. The real records service has no turn concept, so an
   // authorized report is answered whenever it arrives.
   if(path==="/records/v1/plugins.report"&&method==="POST"){
     if(typeof body.layout!=="boolean")return result(400,{error:{code:"invalid_request",message:"layout must be true or false.",next:"Send {layout, plugins}."}})
     if(body.full!==undefined&&typeof body.full!=="boolean")return result(400,{error:{code:"invalid_request",message:"full must be true or false.",next:"Send {layout, full, plugins}."}})
     if(!Array.isArray(body.plugins)||body.plugins.length>100)return result(400,{error:{code:"invalid_request",message:"plugins must be a list of at most 100.",next:"Send {layout, plugins}."}})
     return result(200,{plugins:[],refused:[]})
   }
   // Only these metadata routes bootstrap client context. They never dispatch a content read.
   if(["/v1/context","/v1/spaces","/v1/grants","/v1/resources"].includes(path)){
     const lifetime=store.checkLifetime(context)
     if(lifetime.status!==200)return lifetime
     if([...url.searchParams.keys()].some(k=>k!=="user_id")||url.searchParams.has("user_id")&&url.searchParams.get("user_id")!=="eval")return result(403,{error:{code:"identity_denied"}})
     if(Object.keys(body).some(k=>!(path==="/v1/context"?["space_id","user_id","session_id","agent","bind"]:[]).includes(k)))return result(400,{error:{code:"invalid_bootstrap_input"}})
   }
  if(path==="/v1/context"&&method==="POST"){
    if(body.space_id){const selected=SPACES[body.space_id];if(!selected)return result(403,{error:{code:"scope_denied"}});space=selected}
    if(body.user_id&&body.user_id!=="eval")return result(403,{error:{code:"identity_denied"}})
    // The real control plane's field contract (control/src/service/context.js):
    // session_id is an optional string of at most 200 without whitespace
    // (136-139), agent an optional string of at most 100 matching
    // AGENT_PATTERN (140-143; control/src/service/shared.js:59), and bind a
    // boolean that needs a session_id (197-201). An empty string is absent,
    // as the real validators read it (control/src/validate.js:23-26). The
    // answer is unchanged: the frozen product eval control answers the same
    // shape (baseline-586/scripts/eval/harness-control.mjs:145-152).
    if(body.session_id!==undefined&&body.session_id!==null&&body.session_id!==""&&(typeof body.session_id!=="string"||body.session_id.length>200||/\s/.test(body.session_id)))return result(400,{error:{code:"invalid_bootstrap_input"}})
    if(body.agent!==undefined&&body.agent!==null&&body.agent!==""&&(typeof body.agent!=="string"||body.agent.length>100||!AGENT_PATTERN.test(body.agent)))return result(400,{error:{code:"invalid_bootstrap_input"}})
    if(body.bind!==undefined&&typeof body.bind!=="boolean")return result(400,{error:{code:"invalid_bootstrap_input"}})
    if(body.bind===true&&(typeof body.session_id!=="string"||!body.session_id))return result(400,{error:{code:"invalid_bootstrap_input"}})
    return result(200,{user_id:"eval",space:{id:`eval-space-${space}`,name:space==="personal"?"Personal Workspace":"Shared Workspace",kind:space,role:space==="personal"?"owner":"viewer"},collection:{id:`eval-collection-${space}`,name:"Synthetic collection"},placement:{container_id:`eval-container-${space}`,cell_id:"eval-cell",service_id:"eval-service"},session:{space_id:`eval-space-${space}`},personal_space:{id:"eval-space-personal",name:"Personal Workspace",kind:"personal"}})
  }
  if(path==="/v1/spaces"&&method==="GET"){if(url.searchParams.has("user_id")&&url.searchParams.get("user_id")!=="eval")return result(403,{error:{code:"identity_denied"}});return result(200,{spaces:[{id:"eval-space-personal",name:"Personal Workspace",kind:"personal",role:"owner"},{id:"eval-space-shared",name:"Shared Workspace",kind:"shared",role:"viewer"}]})}
   if(["/v1/grants","/v1/resources"].includes(path)&&method==="GET")return result(200,path==="/v1/grants"?{grants:[]}:{resources:[]})
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
