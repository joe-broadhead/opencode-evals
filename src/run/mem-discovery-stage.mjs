import {copyFileSync,writeFileSync} from "node:fs"
import {join,resolve} from "node:path"
import {discoverySnapshot,discoverySuiteHash,immutableDiscoveryClone} from "../../packs/mem/discovery-plan.mjs"
export function stageDiscoveryFixture(root,spec,intent){
  const snapshot=discoverySnapshot(spec)
  if(intent?.case_id!==snapshot.id)throw new Error("unknown or unbound discovery fixture plan")
  const plan=immutableDiscoveryClone({schema:"oc-mem-discovery-plan/1",kind:"discovery",mode:"control",case_id:snapshot.id,suite_sha256:discoverySuiteHash,spec:snapshot,intent,permission:{effect:"allow"}})
  for(const file of ["discovery-entry.mjs","discovery-http.mjs","discovery-store.mjs","discovery-input.mjs"])copyFileSync(resolve(import.meta.dirname,"../../worlds/mem",file),join(root,file))
  writeFileSync(join(root,"discovery-plan.json"),JSON.stringify(plan),{flag:"wx",mode:0o600})
  return plan
}
