// A header is one line: written twice, only the last survived, which silently dropped a `Seed:` plugins list and an egress host (two cases, case PR #11).
import { test } from "node:test"
import assert from "node:assert/strict"
import { compileCase } from "../src/case/compile.mjs"
import { parseCase, ParseError } from "../src/case/parse.mjs"

const base = ["- Plugin: slack", "- Skill under test: slack", "- Tier: T3", "- Source: t", "- Decision tested: x", "- Data: seeded", "- Set: deep"]
const text = (headers = base, prompt = "ask about the sandbox") => `# deep-x-a\n${headers.join("\n")}\n\n## Prompt\n${prompt}\n\n## Items\n- [SLK-OC01] major · It answers.\n  evidence: text:any matches /./\n  evidence: committed-write:none\n`
const compile = (headers, prompt) => compileCase("cases/slack/deep-x-a.md", text(headers, prompt))

test("a repeated header line is a compile error that names both lines, and neither is kept", () => {
  const twice = [...base, "- Seed: plugins=notion", "- Seed: egress=api.example.org"]
  assert.throws(() => compile(twice), (error) => error instanceof ParseError && /deep-x-a\.md:10: the header `- Seed:` is written twice \(first at line 9\)/.test(error.message) && /one line/.test(error.message))
  // either order, and a header that is not a Seed
  assert.throws(() => compile([...base, "- Seed: egress=api.example.org", "- Seed: plugins=notion"]), /`- Seed:` is written twice/)
  assert.throws(() => compile([...base, "- Data: real"]), /`- Data:` is written twice \(first at line 7\)/)
  assert.throws(() => compile([...base, "- Set: local"]), /`- Set:` is written twice/)
  assert.throws(() => compile([...base, "- Holdout: true", "- Holdout: false"]), /`- Holdout:` is written twice/)
  // case and spacing of the key do not hide it
  assert.throws(() => compile([...base, "- Seed: plugins=notion", "- seed: egress=x"]), /`- seed:` is written twice \(first at line 9\)/)
  assert.throws(() => compile([...base, "- Home files: a", "- home files: b"]), /is written twice/)
})

test("every header the parser knows is refused when it is written twice", () => {
  const keys = ["Plugin", "Skill under test", "Tier", "Source", "Decision tested", "Data", "Set", "Seed", "Holdout", "Status", "Data check", "Expect", "Budget", "Controls", "Checkable", "Truth", "Home files"]
  for (const key of keys) {
    const draft = () => parseCase("cases/slack/x.md", `# x\n- ${key}: a\n- ${key}: b\n\n## Prompt\np\n`)
    assert.throws(draft, (error) => error instanceof ParseError && /x\.md:3: /.test(error.message) && new RegExp(`\`- ${key}:\` is written twice \\(first at line 2`).test(error.message), key)
  }
})

test("one line per header, in any order, compiles; so do repeats that are not headers", () => {
  const ok = compile([...base, "- Seed: plugins=notion egress=api.example.org"])
  assert.equal(ok.seed, "plugins=notion egress=api.example.org", "both values on the one line")
  // the same words in the prompt, an item's repeated evidence lines and the notes are not headers
  assert.doesNotThrow(() => compile(base, "the owner wrote:\n- Seed: plugins=notion\n- Seed: egress=x"))
  assert.equal(ok.items[0].evidence.length, 2, "evidence: may repeat inside an item")
  assert.doesNotThrow(() => compileCase("cases/slack/deep-x-a.md", `${text(base)}\n## Notes\n- Seed: a\n- Seed: b\n`))
})
