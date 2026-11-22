import {test} from "node:test"
import assert from "node:assert/strict"
import * as intent from "../src/run/mem-intent-plan.mjs"
import {coreCases} from "../packs/mem/core.mjs"
test("M6 sealed CORE payload validator permits only presentation of the exact authorized paragraph",()=>{
  const plan=intent.coreMemoryIntent(coreCases.find(s=>s.original_id==="core-wiki-write"),"trial_payload",100)
  for(const expected of [plan.turns[0].calls[1].args,plan.turns[0].calls[2].args,plan.turns[1].calls[0].args]) {
    const initial=expected.action!=="append"
    for(const content of [expected.content,`\n\n${expected.content}\n\n`,`**${expected.content}**`,...(initial?[`# Core Notes\n\n${expected.content}`]:[])])
      assert.equal(intent.coreWikiIntentPayloadMatches(expected,{...expected,content}),true)
    for(const bad of [{...expected,filename:"unrelated.md"},{...expected,action:"delete"},{...expected,content:`${expected.content}\n\nUnrelated new instruction.`},{...expected,content:JSON.stringify({content:expected.content})},{...expected,content:expected.content.toLowerCase()},{...expected,extra:"unknown"},...(expected.wiki_id?[{...expected,wiki_id:"other-wiki"}]:[{...expected,name:"Other Notes"}])])
      assert.equal(intent.coreWikiIntentPayloadMatches(expected,bad),false)
  }
  assert.equal(intent.coreWikiIntentPayloadMatches({action:"write",path:"projects/other",content:"Unrelated"},{action:"write",path:"projects/other",content:"Unrelated"}),false)
})
