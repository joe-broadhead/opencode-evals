// Literal write intents from the three frozen core user requests. No family/space-wide authority.
import { isDeepStrictEqual } from "node:util"
import { CORE_README, CORE_DECISION, coreWikiParagraph } from "../grade/adapters/mem-core-markdown.mjs"

// Called only after the sealed case/trial/turn/session check and created-ID
// resolution. It changes content presentation, never operation or destination.
export function coreWikiIntentPayloadMatches(expected,actual) {
  if(!expected||!actual||typeof expected!=="object"||typeof actual!=="object"||Array.isArray(expected)||Array.isArray(actual)||expected.filename!=="README.md")return false
  const create=expected.action==="create"&&expected.name==="Core Notes"&&!Object.hasOwn(expected,"wiki_id")
  const update=["write","append"].includes(expected.action)&&typeof expected.wiki_id==="string"&&expected.wiki_id&&!Object.hasOwn(expected,"name")
  const part=expected.action==="append"?"append":"initial"
  const keys=create?["action","name","filename","content"]:["action","wiki_id","filename","content"]
  if(!(create||update)||!isDeepStrictEqual(Object.keys(expected).sort(),keys.sort())||expected.content!==(part==="initial"?CORE_README:CORE_DECISION))return false
  const {content:ignoredExpected,...fixedExpected}=expected,{content:ignoredActual,...fixedActual}=actual
  return isDeepStrictEqual(fixedExpected,fixedActual)&&coreWikiParagraph(actual.content,part)
}

export function coreMemoryIntent(spec, trial_id, expires_at) {
  const calls = spec.prompts.map(() => [])
  if (spec.original_id === "core-durability") calls[0] = [{family:"remember",args:{content:"The control plane uses PostgreSQL for PITR.",kind:"decision"},creates:"@created.memory"}]
  if (spec.original_id === "core-forget") {
    calls[0] = [{family:"remember",args:{content:"The staging port is 8420.",kind:"fact"},creates:"@created.memory"}]
    calls[1] = [{family:"revise",args:{action:"forget",id:"@created.memory"}}]
  }
  if (spec.original_id === "core-wiki-write") {
    calls[0] = [
      {family:"wiki",args:{action:"create",name:"Core Notes"},creates:"@created.wiki"},
      {family:"wiki",args:{action:"create",name:"Core Notes",filename:"README.md",content:"The gateway resolves context before routing."},creates:"@created.wiki"},
      {family:"wiki",args:{action:"write",wiki_id:"@created.wiki",filename:"README.md",content:"The gateway resolves context before routing."}},
    ]
    calls[1] = [{family:"wiki",args:{action:"append",wiki_id:"@created.wiki",filename:"README.md",content:"The control plane uses PostgreSQL for PITR."}}]
  }
  return {schema:"oc-mem-intent/1",case_id:spec.original_id,trial_id,expires_at,turns:calls.map((calls,i)=>({index:i+1,calls}))}
}
