import { test } from "node:test"
import assert from "node:assert/strict"
import { goldCases } from "../src/grade/gold.mjs"
import { gradeCase, runView } from "../src/grade/grade.mjs"

test("every gold case reproduces its known verdict, including the expected failing item", () => {
  const gold = goldCases()
  assert.ok(gold.length >= 6)
  for (const entry of gold) {
    const view = runView(entry.trace, { text: entry.text ?? null, state: entry.state ?? null })
    const result = gradeCase(entry.case, view)
    assert.equal(result.verdict, entry.expect.verdict, `${entry.name}: expected ${entry.expect.verdict}, got ${result.verdict}`)
    for (const id of entry.expect.failed ?? []) assert.ok(result.failed.includes(id), `${entry.name}: expected ${id} to fail`)
  }
})

test("the gold suite contains a must-fail, a must-pass, a must-block and an n/a", () => {
  const verdicts = goldCases().map((g) => g.expect.verdict)
  for (const wanted of ["FAIL", "PASS", "BLOCKED"]) assert.ok(verdicts.includes(wanted), `no ${wanted} gold case`)
  const na = goldCases().find((g) => g.name === "must-be-n-a-with-no-mentions")
  const result = gradeCase(na.case, runView(na.trace, { text: na.text }))
  assert.ok(result.na.length > 0, "the n/a gold case must produce an n/a item")
})
