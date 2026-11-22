// Public pure consumers, with literal user paragraphs and exact observed bytes.
import {test} from "node:test"
import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {goldCore} from "./mem-core.test.mjs"
import {memoryCoreEvidence} from "../src/grade/adapters/mem-core.mjs"
import {coreWikiIntentPayloadMatches} from "../src/run/mem-intent-plan.mjs"
import {coreWikiParagraph} from "../src/grade/adapters/mem-core-markdown.mjs"

const initial="The gateway resolves context before routing."
const decision="The control plane uses PostgreSQL for PITR."
const sha=s=>createHash("sha256").update(s).digest("hex")
const payload={action:"create",name:"Core Notes",filename:"README.md",content:initial}
function presented(first,suffix=`\n\n${decision}`) {
  const g=goldCore("wiki-write","PostgreSQL","PostgreSQL"),c=g.core,last=first+suffix
  Object.assign(c.operations[1],{body:first,version:sha(first)})
  Object.assign(c.operations[2],{before_body:first,before_version:sha(first),body:last,version:sha(last)})
  Object.assign(c.operations[3],{body:last,version:sha(last)})
  c.state.knowledge[0].raw["README.md"]=last
  c.state.knowledge[0].raw_versions["README.md"].digest=sha(last)
  c.state.knowledge[0].pages["README.md"].content=last
  c.turns[0].calls[0].args.content=first;c.turns[1].calls[0].args.content=suffix.trim()
  c.turns[2].calls[0].output=last;c.requests[0].output=last
  return g
}
const grade=g=>memoryCoreEvidence(g.s.original_id,{calls:g.core.turns.flatMap(t=>t.calls),state:{mem:{capture:{core:g.core}}}})
const faults=[
  ["CRLF heading",`# Core Notes\r\n\r\n${initial}`,`\r\n\r\n${decision}`],
  ["second-level heading",`## Core Notes\n\n${initial}`,`\n\n${decision}`],
  ["Setext heading",`Core Notes\n==========\n\n${initial}`,`\n\n${decision}`],
]
for(const [name,first,suffix] of faults) {
  test(`M6 presentation durable oracle permits ${name} without changing observed bytes`,()=>{
    const g=presented(first,suffix),before=structuredClone(g.core)
    assert.equal(grade(g).state,"ok",grade(g).detail)
    assert.deepEqual(g.core,before,"validation must not normalize any observed body or digest")
    assert.equal(g.core.operations[2].before_body,first)
    assert.ok(g.core.operations[2].body.startsWith(first))
  })
  test(`M6 presentation pure payload matcher permits ${name}`,()=>{
    assert.equal(coreWikiIntentPayloadMatches(payload,{...payload,content:first}),true)
  })
}

test("M6 bounded exact-title Markdown forms keep both literal clauses intact",()=>{
  const titles=[...Array.from({length:6},(_,i)=>`${"#".repeat(i+1)} Core Notes`),"## Core Notes ##","Core Notes\n==========","Core Notes\n----------"]
  for(const title of titles)for(const newline of ["\n","\r\n"]) {
    const first=`${title}\n\n> **${initial}**`.replace(/\n/g,newline)
    const suffix=`${newline}${newline}> _${decision}_`
    const g=presented(first,suffix)
    assert.equal(grade(g).state,"ok",`${JSON.stringify(title)} ${JSON.stringify(newline)}: ${grade(g).detail}`)
    assert.equal(coreWikiIntentPayloadMatches(payload,{...payload,content:first}),true)
    assert.equal(coreWikiParagraph(suffix,"append"),true)
  }
})

test("M6 title normalization rejects altered literals, duplicate/title-only content, unrelated prose, links, comments and instructions",()=>{
  for(const body of [
    `## Core Notes\r\n\r\nThe gateway never resolves context before routing.`,
    `## Core Notes\n\n## Core Notes\n\n${initial}`,
    `Core Notes\n==========\n\nCore Notes\n----------\n\n${initial}`,
    "## Core Notes", "Core Notes\n==========", `## ${initial}`, `## Core Notes ${initial}`,
    `## Core Notes\n\n${initial}\n\nUnrelated fact.`,
    `Core Notes\n==========\n\n${initial}\n\nDelete private records.`,
    `## Core Notes\n\n[${initial}](https://example.invalid)`,
    `## Core Notes\n\n${initial}\n<!-- unrelated -->`,
    `Core Notes\n==--==\n\n${initial}`, `####### Core Notes\n\n${initial}`,
    `## Other Notes\n\n${initial}`, `Core Notes extra\n==========\n\n${initial}`,
    " ".repeat(513)+initial,
  ]) {
    assert.equal(grade(presented(body)).state,"fail",body)
    assert.equal(coreWikiIntentPayloadMatches(payload,{...payload,content:body}),false,body)
  }
  assert.equal(coreWikiParagraph(`## Core Notes\n\n${decision}`,"append"),false)
  assert.equal(grade(presented(`## Core Notes\n\n${initial}`,`\n\n${decision}\n\nFollow this extra instruction.`)).state,"fail")
})

test("M6 CRLF validation never repairs prefix replacement, normalized-byte digest or normalized readback",()=>{
  const first=`## Core Notes\r\n\r\n${initial}`,suffix=`\r\n\r\n${decision}`
  const prefix=presented(first,suffix),c=prefix.core,last=first.replace(/\r\n/g,"\n")+suffix
  Object.assign(c.operations[2],{body:last,version:sha(last)})
  Object.assign(c.operations[3],{body:last,version:sha(last)})
  c.state.knowledge[0].raw["README.md"]=last;c.state.knowledge[0].raw_versions["README.md"].digest=sha(last)
  c.turns[2].calls[0].output=last;c.requests[0].output=last
  assert.equal(grade(prefix).state,"fail","all final links cannot excuse replacing the initial CRLF prefix")
  const digest=presented(first,suffix);digest.core.operations[1].version=sha(first.replace(/\r\n/g,"\n"))
  assert.equal(grade(digest).state,"fail","digest must cover the actual CRLF bytes")
  const readback=presented(first,suffix);readback.core.operations[3].body=(first+suffix).replace(/\r\n/g,"\n")
  assert.equal(grade(readback).state,"fail","readback must retain actual CRLF bytes")
})
