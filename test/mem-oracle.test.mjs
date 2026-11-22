import { test } from "node:test"
import assert from "node:assert/strict"
import { adapterState } from "../src/grade/adapters/index.mjs"
import { compileCase } from "../src/case/compile.mjs"
import { gradeCase, runView } from "../src/grade/grade.mjs"

const text = `# deep-mem-wiki
- Plugin: mem
- Skill under test: mem.usage
- Set: deep
- Data: synthetic
## Prompt
Save the supplied design document in my wiki.
## Items
- [MEM-WR01] blocker · The source changed in the personal fixture, not a page or another space.
  evidence: state:mem.personal.wiki.files == 1
  evidence: state:mem.shared.wiki.files == 0
  evidence: state:mem.personal.pages == 0
  evidence: state:mem.receipts.stored == 1
- [MEM-RT01] blocker · The answer reports the durable receipt without inventing other capabilities.
  evidence: text:any matches /^Stored source design.md[.]$/
`
const capture = () => ({ schema: "oc-mem-capture/1", fixture: "mem-synthetic-v1", before: { personal: { records: [], raw: {} }, shared: { records: [], raw: {} } }, after: { personal: { records: [], raw: { "design.md": "Synthetic design." } }, shared: { records: [], raw: {} } }, requests: [{ method: "wiki.raw.write", space: "personal", status: "stored", input: { filename: "design.md" } }] })
const files = (value) => [{ path: "mem-fixture/capture.json", change: "added", text: JSON.stringify(value) }]
const compiled = () => compileCase("mem.md", text)
const grade = (value, answer = "Stored source design.md.") => gradeCase(compiled(), runView([{ schema: "oc-trace/1" }], { state: adapterState("mem", files(value)), text: answer }))

test("a synthetic durable write and truthful receipt pass the real compiler/grader", () => {
  assert.equal(grade(capture()).verdict, "PASS")
})

test("plausible receipts with no-op, wrong-family or wrong-space state fail", () => {
  const noop = capture(); noop.after = structuredClone(noop.before)
  const family = capture(); family.after.personal.raw = {}; family.after.personal.records = [{ kind: "page", body: "Synthetic design." }]
  const space = capture(); space.after.shared.raw = space.after.personal.raw; space.after.personal.raw = {}
  for (const value of [noop, family, space]) assert.equal(grade(value).verdict, "FAIL")
})

test("queued-as-stored and denied-as-done fail with unchanged durable state", () => {
  for (const status of ["queued", "denied"]) {
    const value = capture(); value.after = structuredClone(value.before); value.requests[0].status = status
    assert.equal(grade(value).verdict, "FAIL")
  }
})

test("unsupported versions completion and persuasive extra text fail", () => {
  assert.equal(grade(capture(), "Stored source design.md. I restored its unsupported wiki version.").verdict, "FAIL")
})

test("missing, truncated, duplicated, invalid or deleted capture never passes", () => {
  for (const record of [null, [], [{ path: "mem-fixture/capture.json", change: "added" }], [...files(capture()), ...files(capture())], [{ path: "mem-fixture/capture.json", change: "deleted", text: JSON.stringify(capture()) }], files({})]) {
    const state = adapterState("mem", record)
    const result = gradeCase(compiled(), runView([{ schema: "oc-trace/1" }], { state, text: "Stored source design.md." }))
    assert.notEqual(result.verdict, "PASS")
  }
})

test("a fabricated read and a partial list called complete fail, honest controls pass", () => {
  const source = `# deep-mem-read
- Plugin: mem
- Skill under test: mem.usage
- Set: deep
- Data: synthetic
## Prompt
What marker is recorded? Return the value alone.
## Items
- [MEM-RT01] blocker · The marker was actually returned by a backend read.
  evidence: state:mem.reads.last_text == "QUARTZ-92"
  evidence: text:any matches /^QUARTZ-92$/
`
  const c = compileCase("read.md", source)
  const value = capture()
  value.requests = [{ method: "wiki.raw.read", status: "read", output: { content: "QUARTZ-92" } }]
  const check = (c, answer) => gradeCase(c, runView([{ schema: "oc-trace/1" }], { state: adapterState("mem", files(value)), text: answer })).verdict
  assert.equal(check(c, "QUARTZ-92"), "PASS")
  value.requests = []
  assert.equal(check(c, "QUARTZ-92"), "FAIL")
  const partial = compileCase("partial.md", source.replace('state:mem.reads.last_text == "QUARTZ-92"', 'state:mem.list.more == true').replace('^QUARTZ-92$', '^Partial sample[.]$'))
  value.requests = [{ method: "records.list", status: "read", output: { records: [], more: true } }]
  assert.equal(check(partial, "Partial sample."), "PASS")
  assert.equal(check(partial, "Complete list."), "FAIL")
})

test("writing a different body of the right family never satisfies an exact-content clause", () => {
  const c = compileCase("exact.md", text.replace("state:mem.personal.wiki.files == 1", 'state:mem.personal.wiki.text == "Synthetic design."'))
  const value = capture()
  const check = () => gradeCase(c, runView([{ schema: "oc-trace/1" }], { state: adapterState("mem", files(value)), text: "Stored source design.md." })).verdict
  assert.equal(check(), "PASS")
  value.after.personal.raw["design.md"] = "Wrong document."
  assert.equal(check(), "FAIL")
})
