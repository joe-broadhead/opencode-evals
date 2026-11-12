// Arguments a case declares checkable are compared from the recording; the trace keeps only their shape.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { traceFromFiles } from "../src/trace/normalise.mjs"
import { rawCallArgs } from "../src/trace/rawArgs.mjs"
import { runView } from "../src/grade/grade.mjs"
import { parseClause, evaluateClause } from "../src/grade/evidence.mjs"
import { compileCase } from "../src/case/compile.mjs"

const tool = (name, input, output, at) => ({ type: "tool_use", timestamp: at, sessionID: "ses_run", part: { tool: name, state: { status: "completed", input, output } } })

function recorded() {
  const dir = mkdtempSync(join(tmpdir(), "evals-checkable-"))
  const code = 'const hits = await tools.history.search({ query: ["why offset pagination", "cursor decision"], scope: "all" })\nawait tools.history.pin({ action: "add", sessionID: "ses_a1b2c3d4e5f6g7h8i9j0kl" })\nreturn hits'
  const lines = [
    tool("bash", { command: "git log --oneline -5" }, "abc", 1000),
    tool("execute", { code }, "{}", 2000),
    { type: "text", timestamp: 3000, sessionID: "ses_run", part: { text: "pinned" } },
  ].map((line) => JSON.stringify(line))
  writeFileSync(join(dir, "c.jsonl"), lines.join("\n"))
  const trace = traceFromFiles({ caseName: "c", iteration: "it", plugin: "history", base: join(dir, "c"), manifest: {}, model: "mock/m1", catalog: { providers: {} }, mapping: {} })
  rmSync(dir, { recursive: true, force: true })
  return { lines, trace }
}

const scope = { ns: "history", tools: new Set(["search", "pin"]) }
const check = (view, text) => evaluateClause(parseClause(text).clause, view).state

test("a checkable argument is compared from the recording, and never reaches the trace", () => {
  const { lines, trace } = recorded()
  const stored = trace.lines.join("\n")
  assert.doesNotMatch(stored, /ses_a1b2c3d4e5f6g7h8i9j0kl/)
  assert.doesNotMatch(stored, /git log/)
  assert.doesNotMatch(stored, /offset pagination/)
  const view = runView(trace.lines, { scope, rawArgs: rawCallArgs(lines), checkable: ["sessionID", "query", "command"] })
  assert.equal(check(view, "call:history.pin#1 args.sessionID == ses_a1b2c3d4e5f6g7h8i9j0kl"), "ok")
  assert.equal(check(view, "call:pin#1 args.sessionID != ses_other"), "ok")
  assert.equal(check(view, "call:search#1 args.query matches /offset/"), "ok", "one phrasing of a list matches")
  assert.equal(check(view, "call:search#1 args.query excludes yesterday"), "ok")
  assert.equal(check(view, "call:search#1 args.query contains CURSOR"), "ok")
  assert.equal(check(view, "call:bash#1 args.command not-matches /\\brm\\b|sqlite3|opencode\\.db/"), "ok")
  assert.equal(check(view, "call:bash#1 args.command matches /^git /"), "ok")
})

test("without the declaration, or without the recording, a redacted value cannot be compared", () => {
  const { lines, trace } = recorded()
  assert.equal(check(runView(trace.lines, { scope }), "call:pin#1 args.sessionID == ses_a1b2c3d4e5f6g7h8i9j0kl"), "unverifiable")
  assert.equal(check(runView(trace.lines, { scope, checkable: ["sessionID"] }), "call:pin#1 args.sessionID == ses_x"), "unverifiable", "the recording is absent")
  assert.equal(check(runView(trace.lines, { scope, rawArgs: rawCallArgs(lines).slice(1), checkable: ["sessionID"] }), "call:pin#1 args.sessionID == ses_x"), "unverifiable", "a recording that does not line up with the trace is not used")
})

test("an argument that was not passed satisfies !=, not-matches and excludes, and nothing else", () => {
  const { trace } = recorded()
  const view = runView(trace.lines, { scope })
  assert.equal(check(view, "call:search#1 args.limit != 100"), "ok")
  assert.equal(check(view, "call:search#1 args.full not-matches /true/"), "ok")
  assert.equal(check(view, "call:search#1 args.since excludes yesterday"), "ok")
  assert.equal(check(view, "call:search#1 args.limit == 100"), "fail")
  assert.equal(check(view, "call:search#1 args.limit present"), "fail")
  assert.equal(check(view, "call:search#1 args.scope == all"), "ok")
})

test("Checkable:, Set: and Status: compile, and a case without them compiles as before", () => {
  const text = `# c
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: test
- Decision tested: test
- Checkable: sessionID, query
- Set: core, smoke
- Status: deferred

## Prompt
p

## Items
- [H-OC01] blocker · It pins the session it found.
  evidence: call:pin#1 args.sessionID == ses_x
`
  const c = compileCase("c.md", text)
  assert.deepEqual(c.checkable, ["sessionID", "query"])
  assert.deepEqual(c.sets, ["core", "smoke"])
  assert.equal(c.status, "deferred")
  const plain = compileCase("c.md", text.replace(/- Checkable.*\n- Set.*\n- Status.*\n/, ""))
  assert.equal("checkable" in plain || "sets" in plain || "status" in plain, false)
  assert.throws(() => compileCase("c.md", text.replace("Status: deferred", "Status: maybe")), /status must be one of/)
})
