import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compileCase } from "../src/case/compile.mjs"
import { gradeCase, runView } from "../src/grade/grade.mjs"
import { memCases, renderCase } from "../packs/mem/cases.mjs"
import { openFixture } from "../worlds/mem/fixture.mjs"
import { adapterState } from "../src/grade/adapters/index.mjs"

test("the discovery set has 24 bounded natural requests, paired paraphrases and explicit runtime deferrals", () => {
  assert.equal(memCases.length, 24)
  const pack = JSON.parse(readFileSync(join(import.meta.dirname, "../packs/mem/pack.json")))
  for (const spec of memCases) {
    const c = compileCase(`${spec.id}.md`, renderCase(spec), { packs: [pack] })
    assert.equal(c.data, "synthetic")
    assert.equal(c.status, "deferred", "no case is live-ready before the container and candidate gates")
    assert.ok(c.items.every((i) => i.severity === "blocker"))
    const result = gradeCase(c, runView([{ schema: "oc-trace/1" }], { text: spec.answer }))
    assert.notEqual(result.verdict, "PASS", "a nice answer alone never passes")
  }
})

test("scripted trace controls for all 12 fixture-bound cases pass direct and inner-call grading, wrong arguments fail", () => {
  for (const spec of memCases.filter((s) => s.fixture)) {
    const dir = mkdtempSync(join(tmpdir(), "mem-gold-"))
    try {
      const fixture = openFixture(dir)
      if (spec.seed) fixture.call(spec.seed.method, spec.seed.input)
      for (const record of spec.seedRecords ?? []) fixture.call("records.put", { record })
      fixture.call(spec.fixture, spec.input)
      const c = compileCase(`${spec.id}.md`, renderCase(spec))
      const state = adapterState("mem", [{ path: "mem-fixture/capture.json", change: "added", text: readFileSync(join(dir, "capture.json"), "utf8") }])
      for (const mode of ["direct", "execute"]) {
        const call = { kind: "tool_call", seq: 1, ...(mode === "direct" ? { tool: `mem_${spec.tool}`, via: "direct" } : { tool: spec.tool, ns: "mem", via: "execute" }), args: spec.args }
        const grade = (args) => gradeCase(c, runView([{ schema: "oc-trace/1" }, call], { state, text: spec.answer, rawArgs: [args], checkable: c.checkable }))
        assert.equal(grade(spec.args).verdict, "PASS", `${spec.id} ${mode}`)
        assert.equal(grade({}).verdict, "FAIL", "a correct backend result with missing typed tool arguments must fail")
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
})
