// Opt-in synthetic operation uses. Legacy oc-mem-intent/1 remains an allowlist.
import {isDeepStrictEqual} from "node:util"
import {coreMemoryIntent} from "./mem-intent-plan.mjs"

const core={
  "core-durability":[[["memory.remember",[0]]]],
  "core-forget":[[["memory.remember",[0]]],[["memory.forget",[0]]]],
  "core-wiki-write":[[["wiki.create",[0,1]],["wiki.write",[2]]],[["wiki.append",[0]]]],
}
// Each pair is supported by packs/mem/cases.mjs:7-10,17-18, not by spec.write.
const discovery=[
  [["commit-mem-memory","commit-mem-memory-p"],"memory.remember",{family:"remember",args:{content:"Quartz uses green labels.",kind:"fact"}}],
  [["commit-mem-page","commit-mem-page-p"],"page.write",{family:"page",args:{action:"write",path:"projects/quartz",content:"Quartz is a synthetic project."}}],
  [["commit-mem-commitment","commit-mem-commitment-p"],"commitment.add",{family:"commitments",args:{action:"add",what:"Send the Quartz draft"}}],
  [["commit-mem-wiki-write","commit-mem-wiki-write-p"],"wiki.write",{family:"wiki",args:{action:"write",wiki_id:"wiki-eval-personal",filename:"design.md",content:"Quartz is synthetic."}}],
  [["deep-mem-sources","deep-mem-sources-p"],"sources.request",{family:"spaces",args:{action:"sources",bind:{source:"gmail",account:"quartz-synthetic"}}}],
  [["deep-mem-jobs","deep-mem-jobs-p"],"jobs.draft",{family:"spaces",args:{action:"jobs",job:{op:"draft",template:"slack-threads-project",project:"quartz",account:"quartz-synthetic"}}}],
]

export function nativeOperationPlan(intent) {
  if(intent?.schema!=="oc-mem-intent/1"||!Array.isArray(intent.turns)||!intent.turns.length)return null
  const wrap=turns=>({schema:"oc-mem-operation-uses/1",case_id:intent.case_id,trial_id:intent.trial_id,turns})
  // No grants for read-only intents; unknown mutations remain unsupported.
  if(intent.turns.every((t,i)=>t.index===i+1&&Array.isArray(t.calls)&&t.calls.length===0))return wrap(intent.turns.map(t=>({index:t.index,uses:[]})))
  const literal=discovery.find(([ids])=>ids.includes(intent.case_id))
  if(literal){
    const [,id,call]=literal
    if(!isDeepStrictEqual(intent.turns,[{index:1,calls:[call]}]))return null
    return wrap([{index:1,uses:[{id,maxUses:1,alternatives:[structuredClone(call)]}]}])
  }
  const layout=core[intent.case_id]
  if(!layout)return null
  const expected=coreMemoryIntent({original_id:intent.case_id,prompts:intent.turns.map(()=>"")},intent.trial_id,intent.expires_at)
  if(intent.turns.length<layout.length||!isDeepStrictEqual(intent,expected))return null
  return wrap(intent.turns.map((t,i)=>({index:t.index,uses:(layout[i]??[]).map(([id,indices])=>({id,maxUses:1,alternatives:indices.map(n=>structuredClone(t.calls[n]))}))})))
}
