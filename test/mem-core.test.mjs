// Frozen literal truths and real compiler/scorer, no legacy harness execution or provider process.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { compileCase } from "../src/case/compile.mjs"
import { gradeCase, runView } from "../src/grade/grade.mjs"
import { coreCases, renderCore, coreCoverage } from "../packs/mem/core.mjs"
import { memState } from "../src/grade/adapters/mem.mjs"

const captured = (s) => ({ schema: "oc-mem-capture/1", fixture: "mem-synthetic-v1", before: { personal: { records: s.seed.map((body, i) => ({ id: `rec_eval_${i+1}`, kind: "memory", body })), raw: {} }, shared: { records: [], raw: {} } }, after: { personal: { records: s.seed.map((body, i) => ({ id: `rec_eval_${i+1}`, kind: "memory", body })), raw: {} }, shared: { records: [], raw: {} } }, requests: [{ method: "records.list", space: "personal", status: "read", output: { records: s.seed.map((body) => ({ body })) } }] })
const check = (s, capture, value) => {
  const c = compileCase(`${s.id}.md`, renderCore(s))
  return gradeCase(c, runView([{ schema: "oc-trace/1" }, { kind: "tool_call", seq: 1, tool: "mem_recall", via: "direct", args: { query: "recorded context" } }], { state: memState([{ path: "mem-fixture/capture.json", change: "added", text: JSON.stringify(capture) }]), text: JSON.stringify({ value }), rawArgs: [{ query: "recorded context" }] }))
}
test("all 38 core identities/prompts remain concrete cases and absent truth fails the coverage gate", () => {
  const inventory = JSON.parse(readFileSync(new URL("../worlds/mem/core-inventory.json", import.meta.url)))
  assert.deepEqual(coreCases.map((s) => s.original_id), inventory.cases.map((s) => s.id))
  assert.equal(coreCases.length, 38)
  for (const s of coreCases) { assert.doesNotThrow(() => compileCase(`${s.id}.md`, renderCore(s))); if (!s.seed) assert.notEqual(check(s, { schema: "oc-mem-capture/1" }, "invented").verdict, "PASS") }
  assert.equal(coreCoverage().ready, false)
  assert.equal(coreCoverage().ported, 12)
  assert.equal(coreCoverage().blocked.length, 26)
})
test("each of the 12 recovered literal core truths passes, wrong/fabricated/wrong-space answers fail independently", () => {
  for (const s of coreCases.filter((s) => s.seed)) {
    const truth = captured(s)
    for (const value of s.answers) assert.equal(check(s, truth, value).verdict, "PASS", s.id)
    assert.equal(check(s, truth, "invented-wrong-answer").verdict, "FAIL", s.id)
    const noRead = structuredClone(truth); noRead.requests = []
    assert.equal(check(s, noRead, s.answers[0]).verdict, "FAIL", `${s.id}: fabricated read`)
    const wrongSpace = structuredClone(truth); wrongSpace.before.shared = wrongSpace.before.personal; wrongSpace.before.personal = { records: [], raw: {} }
    assert.equal(check(s, wrongSpace, s.answers[0]).verdict, "FAIL", `${s.id}: wrong scope`)
  }
})

test("a core read may return only the relevant seed; stale-only evidence fails", () => {
  const s = coreCases.find((s) => s.original_id === "core-recall-model")
  const value = captured(s)
  value.requests[0].output.records = [{body: "Extraction uses helios-7b."}]
  assert.equal(check(s,value,"helios-7b").verdict,"PASS")
  value.requests[0].output.records = [{body: "The old extraction job used gpt-4o."}]
  assert.equal(check(s,value,"helios-7b").verdict,"FAIL")
})
