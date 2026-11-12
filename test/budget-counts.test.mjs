// outer_calls and inner_calls mean one thing each, in the trace head and in a grade budget alike.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { traceFromFiles } from "../src/trace/normalise.mjs"
import { runView } from "../src/grade/grade.mjs"

const tool = (name, input, output, at) => ({ type: "tool_use", timestamp: at, sessionID: "ses_t", part: { tool: name, state: { status: "completed", input, output } } })

test("a skill load, one execute with two inner calls, and one direct tool: 3 outer, 2 inner, everywhere", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-budget-"))
  const lines = [
    tool("skill", { id: "demo" }, "<skill_content>…</skill_content>", 1000),
    tool("execute", { code: "const a = await tools.demo.search({ query: \"q\" })\nconst b = await tools.demo.read({ id: \"1\" })\nreturn { a, b }" }, "{\"a\":[],\"b\":{}}", 2000),
    tool("read", { filePath: "README.md" }, "text", 3000),
    { type: "text", timestamp: 4000, sessionID: "ses_t", part: { text: "done" } },
  ]
  writeFileSync(join(dir, "c.jsonl"), lines.map((line) => JSON.stringify(line)).join("\n"))
  const trace = traceFromFiles({ caseName: "c", iteration: "it", plugin: "demo", base: join(dir, "c"), manifest: {}, model: "mock/m1", catalog: { providers: {} }, mapping: {} })
  const view = runView(trace.lines)
  assert.equal(trace.head.summary.outer_calls, 3)
  assert.equal(trace.head.summary.inner_calls, 2)
  assert.equal(view.budget.outer_calls, trace.head.summary.outer_calls, "the grade budget counts what the trace counts")
  assert.equal(view.budget.inner_calls, trace.head.summary.inner_calls)
  rmSync(dir, { recursive: true, force: true })
})
