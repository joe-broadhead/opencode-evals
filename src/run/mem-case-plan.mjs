// One closed selector. Unknown IDs never borrow a core/discovery case or receive an intent.
import {coreCases} from "../../packs/mem/core.mjs"
import {coreMemoryIntent} from "./mem-intent-plan.mjs"
import {discoveryCases,discoveryIntent,immutableDiscoveryClone} from "../../packs/mem/discovery-plan.mjs"
export function selectMemoryPlan(id,{trial_id,expires_at}){
  if(typeof trial_id!=="string"||!trial_id||!Number.isFinite(expires_at))throw new Error("invalid Memory plan lifetime")
  const core=coreCases.find(s=>s.id===id)
  if(core)return {kind:"core",spec:core,intent:coreMemoryIntent(core,trial_id,expires_at)}
  const discovery=discoveryCases.find(s=>s.id===id)
  if(discovery)return immutableDiscoveryClone({kind:"discovery",spec:discovery,intent:discoveryIntent(discovery,trial_id,expires_at)})
  throw new Error(`unknown Memory case ${id}; no fixture or intent fallback`)
}
