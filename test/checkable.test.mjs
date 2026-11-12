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

test("a key inside a value the trace keeps only as a shape is unseen, never missing: != cannot pass on it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-opaque-"))
  const code = 'const q = "en"\nawait tools.x.search_posts_all({ query: q, filter: { lang: "en" } })'
  const lines = [tool("execute", { code }, "{}", 1), tool("x_search_posts_all", { query: "en", filter: { lang: "en" }, kind: "recent" }, "{}", 2)].map((line) => JSON.stringify(line))
  writeFileSync(join(dir, "c.jsonl"), lines.join("\n"))
  const trace = traceFromFiles({ caseName: "c", iteration: "it", plugin: "x", base: join(dir, "c"), manifest: {}, model: "mock/m1", catalog: { providers: {} }, mapping: {} })
  const view = runView(trace.lines, { scope: { ns: "x", tools: new Set(["search_posts_all"]) } })
  // The probes: the call passed lang "en"; the trace kept {kind: "object", keys: ["lang"]}.
  assert.equal(check(view, 'call:search_posts_all#1 args.filter.lang != "en"'), "unverifiable")
  assert.equal(check(view, 'call:search_posts_all#2 args.filter.lang != "en"'), "unverifiable")
  assert.equal(check(view, "call:search_posts_all#1 args.query != en"), "unverifiable", "a variable is not missing")
  assert.equal(check(view, "call:search_posts_all#1 args.query.text != en"), "unverifiable", "nor is anything under a variable")
  assert.equal(check(view, "call:search_posts_all#2 args.query.text != en"), "unverifiable", "a path under a redacted string cannot be negated")
  assert.equal(check(view, "call:search_posts_all#2 args.query.length != 1"), "unverifiable")
  assert.equal(check(view, "call:search_posts_all#2 args.query.length excludes x"), "unverifiable")
  assert.equal(check(view, "call:search_posts_all#2 args.query.length not-matches /1/"), "unverifiable")
  assert.equal(check(view, "call:search_posts_all#2 args.query.length >= 2"), "fail", "a single string is not a list of phrasings")
  assert.equal(check(view, "call:search_posts_all#1 args.filter.lang present"), "ok", "the wrapper lists the key: it was passed")
  // A key the wrapper says is absent is missing, and the negations hold on it.
  assert.equal(check(view, "call:search_posts_all#1 args.filter.country != us"), "ok")
  assert.equal(check(view, "call:search_posts_all#1 args.filter.country == us"), "fail")
  // The arguments themselves are never a wrapper, even when a tool takes arguments named `kind` and `keys`.
  const own = { calls: [{ tool: "search_posts_all", ns: "x", via: "execute", args_parsed: true, args: { kind: "object", keys: ["x"], n: 2 } }], scope: null }
  assert.equal(check(own, "call:search_posts_all#1 args.n == 2"), "ok")
  rmSync(dir, { recursive: true, force: true })
})

test("absent-arg: no call of the tool passed the argument (HG-8), and an unseen value is unverifiable, never a pass", () => {
  const { lines, trace } = recorded()
  const view = runView(trace.lines, { scope })
  assert.equal(check(view, "absent-arg:history.search args.limit == 100"), "ok", "the key was never passed")
  assert.equal(check(view, "absent-arg:history.read args.full == true"), "ok", "the tool was never called")
  assert.equal(check(view, "absent-arg:history.search args.scope == all"), "fail")
  assert.equal(check(view, "absent-arg:history.search args.scope present"), "fail")
  assert.equal(check(view, "absent-arg:history.pin args.sessionID matches /ses_a1b2/"), "unverifiable", "a value kept only as its shape cannot be shown absent")
  const raw = runView(trace.lines, { scope, rawArgs: rawCallArgs(lines), checkable: ["sessionID", "command"] })
  assert.equal(check(raw, "absent-arg:history.pin args.sessionID == ses_a1b2c3d4e5f6g7h8i9j0kl"), "fail")
  assert.equal(check(raw, "absent-arg:shell args.command matches /\\brm\\b|sqlite3|opencode\\.db/"), "ok")
  assert.equal(check(raw, "absent-arg:bash args.command matches /^git log/"), "fail")
  const blind = runView(trace.lines, { scope, checkable: ["command"] })
  assert.equal(check(blind, "absent-arg:bash args.command matches /rm/"), "unverifiable", "a checkable key with no recording settles nothing")
  assert.equal(parseClause("absent-arg:history.read args.full != true").ok, false, "a negative comparison is refused")
  assert.equal(parseClause("absent-arg:history.read args.full").ok, false)
})
