import {copyFileSync,writeFileSync} from "node:fs"
import {join,resolve} from "node:path"
import {discoveryCases,discoverySuiteHash} from "../../packs/mem/discovery-plan.mjs"
export function stageDiscoveryFixture(root,spec,intent){
  if(!discoveryCases.some(s=>s===spec)||intent?.case_id!==spec.id)throw new Error("unknown or unbound discovery fixture plan")
  const plan={schema:"oc-mem-discovery-plan/1",kind:"discovery",mode:"control",case_id:spec.id,suite_sha256:discoverySuiteHash,spec,intent,permission:{effect:"allow"}}
  for(const file of ["discovery-entry.mjs","discovery-http.mjs","discovery-store.mjs","discovery-input.mjs"])copyFileSync(resolve(import.meta.dirname,"../../worlds/mem",file),join(root,file))
  writeFileSync(join(root,"discovery-plan.json"),JSON.stringify(plan),{flag:"wx",mode:0o600})
  return plan
}
