import { readFileSync, mkdirSync, writeFileSync, copyFileSync, lstatSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { sha256 } from "../util/canonical.mjs"
import { bindCoreSeed } from "../../packs/mem/core.mjs"
export { baselineRoute } from "../../worlds/mem/baseline-routing.mjs"

/** Filesystem-only staging. The unmodified archived server is NEVER imported on the host. */
export function stageBaselineFixture(root,spec,intent=null) {
  const source=resolve(import.meta.dirname,"../../worlds/mem/baseline-586")
  const manifest=JSON.parse(readFileSync(join(source,"manifest.json"),"utf8"))
  if(manifest.source_commit!=="586dc46a133cada64c584b0506eb3aebbd906b24")throw new Error("unexpected frozen baseline pin")
  for(const [file,digest] of Object.entries(manifest.files)) {
    if(file.startsWith("/")||file.split("/").some((s)=>["..","."].includes(s))||lstatSync(join(source,file)).isSymbolicLink()||sha256(readFileSync(join(source,file)))!==digest)throw new Error("unsafe or changed frozen artifact")
    const out=join(root,"baseline-586",file);mkdirSync(dirname(out),{recursive:true,mode:0o700});copyFileSync(join(source,file),out)
  }
  copyFileSync(join(source,"manifest.json"),join(root,"baseline-586/manifest.json"))
  const server=readFileSync(join(source,"stub/server.js"),"utf8"),cut=server.indexOf('server.listen(PORT, "127.0.0.1", () => {')
  if(cut<0||!server.slice(cut).includes('process.on(signal, () => server.close(() => process.exit(0)))'))throw new Error("frozen stub autostart seam changed")
  const lifecycle=`\n// Native containment adapter: only the listener-autostart tail differs from the manifested source.\nexport async function startFrozenStub() {\n await new Promise((done,fail)=>{server.once("error",fail);server.listen(PORT,"127.0.0.1",done)})\n return { seed: (input)=>routes["POST /debug/seed"](input), snapshot: ()=>routes["GET /debug/state"](), close: async()=>{await new Promise((done)=>{server.close(done);server.closeAllConnections?.()});await recordsStore.close()} }\n}\n`
  writeFileSync(join(root,"baseline-586/stub/contained-server.mjs"),server.slice(0,cut)+lifecycle,{mode:0o600})
  const control=spec.mode==="control"
  const seed=bindCoreSeed(spec,(key,field)=>({user_id:"eval",agent_id:"build",team_id:control?`eval-container-${key}`:"local"})[field])
  const plan={schema:"oc-mem-baseline-plan/1",case_id:spec.original_id,mode:spec.mode,defaultSpace:spec.defaultSpace??"personal",seed,...(intent?{intent}: {})}
  writeFileSync(join(root,"baseline-plan.json"),JSON.stringify(plan),{flag:"wx",mode:0o600})
  for(const file of ["baseline-entry.mjs","baseline-routing.mjs","baseline-effects.mjs","baseline-proof.mjs"])copyFileSync(resolve(import.meta.dirname,"../../worlds/mem",file),join(root,file))
  return plan
}
