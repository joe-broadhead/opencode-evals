import { test } from "node:test"
import assert from "node:assert/strict"
import { extractInnerCalls, dataflow, returnKeyFor, readLiteral } from "../src/trace/innerArgs.mjs"
import { parseFirstJson, resultCounts, costLineOf } from "../src/trace/resultCounts.mjs"
import { shape, grammarTokens, safeArgs } from "../src/trace/redact.mjs"

test("inner call sites carry their literal arguments", () => {
  const code = `const r = await tools.x.search_posts_all({ query: "electric cars", max_results: 10, start_time: "2026-11-01T23:00:00Z" });\nreturn r;`
  const calls = extractInnerCalls(code)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, "search_posts_all")
  assert.equal(calls[0].ns, "x")
  assert.equal(calls[0].parsed, true)
  assert.equal(calls[0].args.max_results, 10)
  assert.equal(calls[0].args.max_results, 10)
})

test("a loop counts once, a computed value is an unseen variable, and an unreadable argument is reported, never guessed", () => {
  const looped = extractInnerCalls("for (const id of ids) await tools.x.get_posts_by_id({ id });")
  assert.equal(looped.length, 1)
  const expression = extractInnerCalls("await tools.x.search_posts_all({ query: makeQuery(a, b), max_results: 10 })")
  assert.equal(expression.length, 1)
  assert.equal(expression[0].parsed, true)
  assert.deepEqual(expression[0].args, { query: { $ref: "(expression)" }, max_results: 10 })
  const broken = extractInnerCalls("await tools.x.search_posts_all({ query: [1, 2 })")
  assert.equal(broken[0].parsed, false)
  assert.match(broken[0].why, /unreadable|expected|unterminated|unbalanced/)
})

test("shorthand properties become references, not literals", () => {
  const lit = readLiteral("{ id, max_results: 10 }")
  assert.equal(lit.ok, true)
  assert.deepEqual(lit.value, { id: { $ref: "id" }, max_results: 10 })
})

test("dataflow resolves which variable holds a result and which key returns it", () => {
  const code = `const me = await tools.x.get_users_me({"user.fields":"username"});\nconst m = await tools.x.get_users_mentions({ id, max_results: 10 });\nreturn { me: me.data, end, m };`
  const flow = dataflow(code)
  assert.equal(flow.bindings.get("m"), "get_users_mentions")
  assert.equal(returnKeyFor(flow.returns, "m"), "m")
  assert.equal(returnKeyFor(flow.returns, "me"), "me")
  assert.equal(returnKeyFor(flow.returns, "nope"), null)
})

test("an output that carries a JSON value plus an appended line still parses", () => {
  const output = '{\n  "r": { "data": [1,2,3], "includes": { "users": [1,2] } }\n}\nCost: 3 posts ($0.015) + 2 authors ($0.020) = $0.035.'
  const parsed = parseFirstJson(output)
  assert.equal(parsed.r.data.length, 3)
  assert.deepEqual(resultCounts("search_posts_all", output), { posts: 3, users: 2 })
})

test("counts are counts: a single-object payload counts as one", () => {
  assert.deepEqual(resultCounts("get_users_me", JSON.stringify({ data: { id: "1" } })), { users: 1 })
  assert.deepEqual(resultCounts("get_posts_counts_recent", JSON.stringify({ data: [{ tweet_count: 4 }, { tweet_count: 6 }] })), { buckets: 2, total: 10 })
  assert.equal(resultCounts("search_posts_all", "not json"), null)
  assert.deepEqual(resultCounts("unknown_tool", "{}"), {})
})

test("the plugin's cost line is read as numbers only", () => {
  const line = costLineOf("x\nCost: 10 posts ($0.05) + 9 authors ($0.09) = $0.14.")
  assert.deepEqual(line.terms.map((t) => [t.n, t.unit, t.usd]), [[10, "posts", 0.05], [9, "authors", 0.09]])
  assert.equal(line.total_usd, 0.14)
  assert.equal(costLineOf("Cost: 1 count read ($0.01) = $0.01.").total_usd, 0.01)
  assert.equal(costLineOf("Cost: 0 users returned ($0.00).").total_usd, 0)
  assert.equal(costLineOf("no line here"), null)
})

test("a query's shape keeps operators and loses content", () => {
  const shaped = shape('from:someone since:2026-01-01 min_faves:5 "a real sentence"')
  assert.match(shaped, /from:/)
  assert.match(shaped, /since:/)
  assert.doesNotMatch(shaped, /someone/)
  assert.doesNotMatch(shaped, /real sentence/)
  assert.deepEqual(grammarTokens("from:someone since:2026-01-01"), ["from", "since"])
})

test("arguments are made safe: numbers and timestamps survive, content does not", () => {
  const args = safeArgs({
    max_results: 10,
    start_time: "2026-11-01T23:00:00Z",
    query: "electric cars -is:retweet",
    username: "someone_real",
    code: "return await tools.x.search_posts_all({})",
  })
  assert.equal(args.max_results, 10)
  assert.equal(args.start_time.value, "2026-11-01T23:00:00Z")
  assert.equal(args.query.kind, "redacted")
  assert.equal(args.username.kind, "redacted")
  assert.equal(args.code.kind, "code")
  assert.equal(JSON.stringify(args).includes("someone_real"), false)
  assert.equal(JSON.stringify(args).includes("electric cars"), false)
})

test("a spread or a computed value inside an argument object keeps the literal keys beside it", () => {
  const code = `do { const r = await tools.history.sessions({ since: "14d", scope: "project", limit: 100, ...(cursor ? { cursor } : {}) }) } while (cursor)
const s = await tools.history.sql({ sql: "select 1", params: [new Date(Date.now() - 30*864e5).toISOString()], limit: 200 })
const t = await tools.history.search({ query: ["a", "b"], since: cutoff ? "7d" : "30d", ...opts })`
  const [sessions, sql, search] = extractInnerCalls(code)
  assert.equal(sessions.parsed, true)
  assert.deepEqual(sessions.args, { since: "14d", scope: "project", limit: 100, $spread: true })
  assert.equal(sql.parsed, true)
  assert.deepEqual(sql.args.params, [{ $ref: "(expression)" }])
  assert.equal(sql.args.limit, 200)
  assert.deepEqual(search.args, { query: ["a", "b"], since: { $ref: "(expression)" }, $spread: true })
  assert.equal(readLiteral("{ a: 1, ...rest }").value.$spread, true)
  assert.equal(readLiteral("{ a: (1 + ").ok, false, "an unterminated expression is still unparsed")
})

test("beside a spread, a written key is seen and an unwritten one is unverifiable, never missing", async () => {
  const { argState } = await import("../src/grade/evidence.mjs")
  const args = safeArgs({ since: "14d", limit: 100, $spread: true })
  assert.equal(argState(args, "args.limit").state, "value")
  assert.equal(argState(args, "args.cursor").state, "opaque")
  assert.equal(argState(safeArgs({ since: "14d" }), "args.cursor").state, "missing")
  assert.equal(argState({ filter: { kind: "object", keys: ["$spread", "lang"] } }, "args.filter.tag").state, "opaque")
})
