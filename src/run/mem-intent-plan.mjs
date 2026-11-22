// Literal write intents from the three frozen core user requests. No family/space-wide authority.
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
