import { test } from "node:test"
import assert from "node:assert/strict"
import { gradeCase, runView } from "../src/grade/grade.mjs"
import { parseClause, evaluateClause } from "../src/grade/evidence.mjs"

const head = (over = {}) => ({
  schema: "oc-trace/1",
  run_id: "t/1",
  case: "t",
  exit: 0,
  failure_class: null,
  duration_ms: 1000,
  model: { id: "m" },
  summary: {
    outer_calls: 2,
    failed_outer: 0,
    inner_calls: 1,
    steps: 2,
    skills_loaded: ["x"],
    tokens: { input: 10, output: 10, cacheRead: 100, cacheWrite: 0 },
    cost: { amount_usd: null, source: "missing" },
    text: { sha256: "0".repeat(64) },
  },
  ...over,
})
const call = (seq, tool, args = {}, extra = {}) => ({ seq, ts_ms: 0, kind: "tool_call", tool, via: "execute", args, args_parsed: true, ...extra })
const result = (seq, tool, extra = {}) => ({ seq, ts_ms: 0, kind: "tool_result", tool, for_seq: seq - 1, status: "ok", counts: null, appended: null, ...extra })
const lines = (events, over) => [JSON.stringify(head(over)), ...events.map((e) => JSON.stringify(e))]

const item = (id, evidence, { severity = "major", forbidden = false, na_when = [], evidence_any = [] } = {}) => ({
  id,
  severity,
  ask: `${id} asks something observable`,
  forbidden,
  grader: "code",
  evidence,
  evidence_any,
  na_when,
  maps_to: [],
})
const kase = (items, over = {}) => ({
  schema: "oc-case/1",
  id: "t",
  plugin: "x",
  skill: "x",
  tier: "T3",
  prompt: "p",
  items,
  controls: [],
  budgets: {},
  oracle: [],
  notes: [],
  hashes: { source_sha256: "0" },
  ...over,
})

test("a passing clause, a failing clause and an unverifiable one", () => {
  const view = runView(lines([call(1, "search_posts_all", { max_results: 10 }), result(2, "search_posts_all")]), { text: "" })
  assert.equal(evaluateClause(parseClause("call:search_posts_all#1 args.max_results == 10").clause, view).state, "ok")
  assert.equal(evaluateClause(parseClause("call:search_posts_all#1 args.max_results == 100").clause, view).state, "fail")
  assert.equal(evaluateClause(parseClause("call:search_posts_all#2").clause, view).state, "fail")
  assert.equal(evaluateClause(parseClause("count:search_posts_all <= 1").clause, view).state, "ok")
  assert.equal(evaluateClause(parseClause("absent:create_posts").clause, view).state, "ok")
})

test("a variable-valued argument is unverifiable, not a failure and not a pass", () => {
  const view = runView(lines([call(1, "search_posts_all", { end_time: { kind: "object", keys: ["$ref"] } })]), { text: "" })
  assert.equal(evaluateClause(parseClause("call:search_posts_all#1 args.end_time matches /Z$/").clause, view).state, "unverifiable")
  assert.equal(evaluateClause(parseClause("call:search_posts_all#1 args.end_time present").clause, view).state, "ok")
})

test("a blocked major blocks the case; a blocked minor does not", () => {
  const blockedMajor = kase([item("X-PR01", [{ kind: "call", tool: "search_posts_all", n: 1, arg: "args.end_time", op: "matches", value: { kind: "regex", source: "Z$", flags: "" } }])])
  const view = runView(lines([call(1, "search_posts_all", { end_time: { kind: "object", keys: ["$ref"] } })]), { text: "" })
  assert.equal(gradeCase(blockedMajor, view).verdict, "BLOCKED")

  const blockedMinor = kase([{ ...blockedMajor.items[0], severity: "minor" }])
  const graded = gradeCase(blockedMinor, view)
  assert.equal(graded.verdict, "PASS")
  assert.deepEqual(graded.blocked_minor, ["X-PR01"])
})

test("a failed blocker fails the case; a failed major is a finding", () => {
  const view = runView(lines([call(1, "search_posts_all", { max_results: 100 }), result(2, "search_posts_all")]), { text: "" })
  const evidence = [{ kind: "call", tool: "search_posts_all", n: 1, arg: "args.max_results", op: "==", value: { kind: "number", value: 10 } }]
  const major = gradeCase(kase([item("X-PR01", evidence)]), view)
  assert.equal(major.verdict, "PASS")
  assert.deepEqual(major.findings, ["X-PR01"])
  const blocker = gradeCase(kase([item("X-OC01", evidence, { severity: "blocker" })]), view)
  assert.equal(blocker.verdict, "FAIL")
  assert.deepEqual(blocker.failed_blockers, ["X-OC01"])
})

test("a forbidden item that fails is reported as a violation, whatever its severity", () => {
  const view = runView(lines([call(1, "create_posts", {})]), { text: "" })
  const graded = gradeCase(kase([item("X-SF01", [{ kind: "absent", tool: "create_posts", n: null }], { severity: "blocker", forbidden: true })]), view)
  assert.equal(graded.verdict, "FAIL")
  assert.deepEqual(graded.forbidden_violations, ["X-SF01"])
})

test("an n/a condition removes an item from the denominator", () => {
  const view = runView(lines([call(1, "get_users_mentions", {})]), { text: "" })
  const graded = gradeCase(
    kase([item("X-PR04", [{ kind: "text", span: "any", op: "matches", value: { kind: "regex", source: "status", flags: "" } }], { na_when: [{ kind: "count", tool: "get_users_mentions", op: "==", value: 1 }] })]),
    view,
  )
  assert.deepEqual(graded.na, ["X-PR04"])
  assert.equal(graded.coverage.testable, 0)
  assert.equal(graded.verdict, "PASS")
})

test("a text count clause counts real matches, and a missing text is unverifiable", () => {
  const view = runView(lines([call(1, "search_posts_all", {})]), { text: "a https://x.com/a/status/1 and https://x.com/b/status/2" })
  assert.equal(evaluateClause(parseClause("text:any count /x\\.com/[A-Za-z0-9_]+/status/[0-9]+/ >= 2").clause, view).state, "ok")
  assert.equal(evaluateClause(parseClause("text:any count /status/[0-9]+/ >= 3").clause, view).state, "fail")
  const blind = runView(lines([call(1, "search_posts_all", {})]), { text: null })
  assert.equal(evaluateClause(parseClause("text:any count /status/ >= 1").clause, blind).state, "unverifiable")
})

test("the cost clause compares the answer's amount to the plugin's appended line", () => {
  const trace = lines([call(1, "search_posts_all", {}), result(2, "search_posts_all", { appended: { terms: [], total_usd: 0.15 } })])
  const right = runView(trace, { text: "Cost: 10 posts ($0.05) + 10 authors ($0.10) = $0.15." })
  assert.equal(evaluateClause(parseClause("cost:matches-appended").clause, right).state, "ok")
  const wrong = runView(trace, { text: "Cost: 10 posts ($0.05) = $0.05." })
  assert.equal(evaluateClause(parseClause("cost:matches-appended").clause, wrong).state, "fail")
  const none = runView(lines([call(1, "search_posts_all", {})]), { text: "Cost: 0 posts ($0.00)." })
  assert.equal(evaluateClause(parseClause("cost:matches-appended").clause, none).state, "unverifiable")
})

test("an any-group passes on one alternative and fails only when all fail", () => {
  const view = runView(lines([call(1, "search_users", { max_results: 10 })]), { text: "" })
  const clauseSet = { evidence: [], evidence_any: [[{ kind: "call", tool: "search_users", n: 1, arg: "args.max_results", op: "<=", value: { kind: "number", value: 10 } }, { kind: "call", tool: "search_posts_all", n: 1, arg: "args.max_results", op: "<=", value: { kind: "number", value: 10 } }]] }
  const graded = gradeCase(kase([{ ...item("X-OC01", [], { severity: "blocker" }), ...clauseSet }]), view)
  assert.equal(graded.verdict, "PASS")
})

test("budgets are measured from the trace, and a nil budget is unverifiable", () => {
  const view = runView(lines([call(1, "search_posts_all", {})]), { text: "" })
  assert.equal(evaluateClause(parseClause("budget:inner_calls <= 2").clause, view).state, "ok")
  assert.equal(evaluateClause(parseClause("budget:cost_usd <= 1").clause, view).state, "unverifiable")
})
