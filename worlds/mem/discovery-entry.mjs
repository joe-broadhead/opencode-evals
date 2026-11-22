// Container-only listener wrapper over the pure store/codec. Never starts during import or host staging.
import {createServer} from "node:http"
import {readFileSync,writeFileSync,renameSync,lstatSync,existsSync} from "node:fs"
import {join} from "node:path"
import {createDiscoveryStore} from "./discovery-store.mjs"
import {discoveryResponse} from "./discovery-http.mjs"
export async function serveDiscovery(root){
  if(process.platform!=="linux"||!existsSync("/.dockerenv")||process.env.EVALS_MEM_CONTAINED!=="mem-synthetic-v1")throw new Error("discovery fixture is container only")
  const read=(name)=>{const file=join(root,name);try{const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>65536)return null;return JSON.parse(readFileSync(file,"utf8"))}catch{return null}}
  const plan=read("discovery-plan.json")
  if(plan?.schema!=="oc-mem-discovery-plan/1"||plan.case_id!==plan.spec?.id||plan.intent?.case_id!==plan.case_id)throw new Error("invalid discovery plan")
  const store=createDiscoveryStore(plan)
  const atomic=(name,value)=>{writeFileSync(join(root,`${name}.tmp`),JSON.stringify(value),{mode:0o600});renameSync(join(root,`${name}.tmp`),join(root,name))}
  const capture=()=>{const c=store.capture(),record_spaces={};for(const space of ["personal","shared"])for(const r of c.after[space].records)record_spaces[r.id]=`spc-eval-${space}`;atomic("capture.json",c);atomic("scope-map.json",{schema:"oc-mem-scopes/1",fixture:"mem-synthetic-v1",case_id:plan.case_id,trial_id:plan.intent.trial_id,record_spaces,wiki_spaces:{"wiki-eval-personal":"spc-eval-personal","wiki-eval-shared":"spc-eval-shared"},creators:[]})}
  capture()
  const server=createServer(async(req,res)=>{try{const chunks=[];let bytes=0;for await(const b of req){bytes+=b.length;if(bytes>65536)throw new Error("oversized request");chunks.push(b)}const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{},answer=discoveryResponse(store,{method:req.method,path:req.url,headers:req.headers,body},{context:read("turn.json"),invocation:read("active-call.json")});capture();res.writeHead(answer.status,{"content-type":"application/json"});res.end(JSON.stringify(answer.json))}catch{res.writeHead(400,{"content-type":"application/json"});res.end('{"error":{"code":"bounded_input_required"}}')}})
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(4617,"127.0.0.1",resolve)})
  let closed=false
  const close=async()=>{if(closed)return;closed=true;await new Promise(r=>{server.close(r);server.closeAllConnections?.()});store.close();capture();atomic("scope-map.json",{schema:"oc-mem-scopes/1",fixture:"mem-synthetic-v1",case_id:plan.case_id,trial_id:plan.intent.trial_id,record_spaces:{},wiki_spaces:{},creators:[]})}
  for(const signal of ["SIGINT","SIGTERM"])process.once(signal,()=>{void close().then(()=>process.exit(0),()=>process.exit(1))})
  return {close}
}
