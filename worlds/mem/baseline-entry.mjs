// Imported ONLY after container-entry's platform/container guard. No top-level listener or store opens.
import { createServer } from "node:http"
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { baselineRoute, baselineScopeHeaders } from "./baseline-routing.mjs"
import { baselineEffect } from "./baseline-effects.mjs"
import { createBaselineProof } from "./baseline-proof.mjs"

export async function serveBaseline(root) {
  if(process.platform!=="linux"||!existsSync("/.dockerenv")||process.env.EVALS_MEM_CONTAINED!=="mem-synthetic-v1")throw new Error("baseline is container only")
  const plan=JSON.parse(readFileSync(join(root,"baseline-plan.json"),"utf8"))
  if(plan.schema!=="oc-mem-baseline-plan/1")throw new Error("invalid baseline plan")
  process.env.MEM_STUB_PORT="4620";process.env.MEM_STUB_DATA=join(root,"stub-state.json");process.env.MEM_STUB_NOW="2026-11-12T10:00:00Z"
  const {startFrozenStub}=await import(pathToFileURL(join(root,"baseline-586/stub/contained-server.mjs")))
  const stub=await startFrozenStub()
  const {startControlServer}=await import(pathToFileURL(join(root,"baseline-586/scripts/eval/harness-control.mjs")))
  let control
  try {
    control=await startControlServer({defaultSpace:plan.defaultSpace,recordsURL:"http://127.0.0.1:4620"})
    stub.seed(plan.seed)
  } catch(error) {try {await control?.close()} finally {await stub.close()};throw error}
  const before=await stub.snapshot(),requests=[],effects=[]
  const proof=createBaselineProof(before,control.state(),plan.intent)
  const alias=(id)=>["eval-space-shared","eval-container-shared"].includes(id)?"shared":["local","eval-space-personal","eval-container-personal"].includes(id)?"personal":id??plan.defaultSpace
  const atomic=(name,value)=>{const p=join(root,`${name}.tmp`);writeFileSync(p,JSON.stringify(value),{mode:0o600});renameSync(p,join(root,name))}
  async function capture() {
    const state=await stub.snapshot(),record_spaces={},wiki_spaces={}
    for(const r of state.records??[])if(["personal","shared"].includes(alias(r.space_id)))record_spaces[r.id]=`spc-eval-${alias(r.space_id)}`
    for(const w of state.knowledge??[])if(["personal","shared"].includes(alias(w.team_id)))wiki_spaces[w.knowledge_id]=`spc-eval-${alias(w.team_id)}`
    atomic("scope-map.json",{schema:"oc-mem-scopes/1",fixture:"mem-synthetic-v1",case_id:plan.case_id,trial_id:plan.intent?.trial_id,record_spaces,wiki_spaces,creators:proof.creators})
    const spaces=(value)=>Object.fromEntries(["personal","shared"].map((space)=>[space,{records:(value.records??[]).filter((r)=>alias(r.space_id)===space),raw:{}}]))
    atomic("capture.json",{schema:"oc-mem-capture/1",fixture:"mem-synthetic-v1",before:spaces(before),after:spaces(state),requests,core:{proof_schema:"oc-mem-durable-proof/2",case_id:plan.case_id,seed:plan.seed,before:proof.before,state:proof.state(state,control.state()),operations:proof.operations,effects,requests,turns:[]},control:control.state()})
  }
  try {await capture()} catch(error) {try {await control.close()} finally {await stub.close()};throw error}
  // Serialize complete backend observation windows; overlapping before/after snapshots cannot prove an operation.
  let pending=Promise.resolve()
  const server=createServer((req,res)=>{pending=pending.then(()=>handle(req,res));void pending.catch(()=>{})})
  async function handle(req,res) {
    if(req.method==="GET"&&req.url==="/health"){res.writeHead(200,{"content-type":"application/json"});res.end('{"fixture":"mem-synthetic-v1","transport":"baseline-586"}');return}
    const route=baselineRoute(req.method,req.url)
    if(!route){res.writeHead(404);res.end('{"error":"unsupported contained route"}');return}
    try {
      const chunks=[];let bytes=0
      for await(const b of req){bytes+=b.length;if(bytes>65536)throw new Error("request too large");chunks.push(b)}
      const body=Buffer.concat(chunks).toString(),input=body?JSON.parse(body):{}
      if(req.headers.authorization!=="Bearer eval-token"){res.writeHead(401);res.end('{"error":"synthetic credential required"}');return}
      // Never accept gateway/service identity supplied by a plugin. Control derives it from public space/session.
      const headers=baselineScopeHeaders(plan,req.headers,input)
      if(plan.mode==="control"&&route.upstream==="stub"&&route.path.startsWith("/records/"))throw new Error("control-mode records must use the authoritative gateway")
      const upstream=route.upstream==="control"&&!(plan.mode==="local"&&route.path.startsWith("/records/"))?control.url:"http://127.0.0.1:4620"
      const prior=await stub.snapshot()
      const readNative=(name)=>{try{return JSON.parse(readFileSync(join(root,name),"utf8"))}catch{return null}}
      const context=readNative("turn.json"),invocation=readNative("active-call.json")
      const answer=await fetch(`${upstream}${route.path}`,{method:req.method,headers,...(["GET","HEAD"].includes(req.method)?{}:{body}),redirect:"error",signal:AbortSignal.timeout(10000)})
      const output=await answer.text();let value;try{value=JSON.parse(output)}catch{value=null}
      const space=alias(headers["x-mem-space-id"]??input.team_id)
      requests.push({method:route.path,verb:req.method,space,status:answer.ok&&!value?.error&&!value?.code?"read":"denied",input,output:value})
      const after=await stub.snapshot()
      const effect=baselineEffect(route.path,input,{status:answer.status,json:value},prior,after,space)
      if(effect)effects.push(effect)
      proof.observe({path:route.path,input,response:{status:answer.status,json:value},before:prior,after,space,context,invocation:headers["x-tdai-session-id"]&&headers["x-tdai-session-id"]!==context?.session?null:invocation})
      await capture()
      res.writeHead(answer.status,{"content-type":answer.headers.get("content-type")??"application/json"});res.end(output)
    }catch(error){res.writeHead(400,{"content-type":"application/json"});res.end(JSON.stringify({error:String(error.message)}))}
  }
  try {await new Promise((done,fail)=>{server.once("error",fail);server.listen(4617,"127.0.0.1",done)})}
  catch(error) {try {await control.close()} finally {await stub.close()};throw error}
  let stopping=false
  const close=async()=>{if(stopping)return;stopping=true;await new Promise((done)=>{server.close(done);server.closeAllConnections?.()});try {await capture()}finally{try{await control.close()}finally{await stub.close()}}}
  for(const signal of ["SIGINT","SIGTERM"])process.once(signal,()=>{void close().then(()=>process.exit(0),()=>process.exit(1))})
  return {close}
}
