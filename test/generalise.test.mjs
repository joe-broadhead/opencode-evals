// What a second plugin (History) needed from the framework that X did not: namespaced inner calls, variable argument
// objects, arrays, a plugin's own vocabulary, a case's runner seed, and provenance axes a policy comparison can name.
import { test } from "node:test"
import assert from "node:assert/strict"
import { matchesTool, selectCalls } from "../src/grade/select.mjs"
import { argState, evaluateClause, parseClause } from "../src/grade/evidence.mjs"
import { extendVocab, safeValue } from "../src/trace/redact.mjs"
import { compileCase } from "../src/case/compile.mjs"
import { comparable } from "../src/policy/comparable.mjs"

test("an inner Code Mode call answers to its bare name, to ns.name, and to the namespace glob", () => {
  const call = { ns: "history", tool: "search", via: "execute" }
  assert.equal(matchesTool("search", call), true)
  assert.equal(matchesTool("history.search", call), true)
  assert.equal(matchesTool("history.*", call), true)
  assert.equal(matchesTool("other.search", call), false)
  assert.equal(matchesTool("history.sql", call), false)
  assert.equal(selectCalls([call, { ns: "other", tool: "search" }], "history.search").length, 1)
})

test("a call whose whole argument object is a variable is unverifiable, never 'the key was not passed'", () => {
  assert.equal(argState({ $ref: "args" }, "args.since").state, "opaque")
  const clause = parseClause("call:events_list#1 args.since present").clause
  const view = { calls: [{ tool: "events_list", ns: "history", args: { $ref: "args" }, args_parsed: true }] }
  assert.equal(evaluateClause(clause, view).state, "unverifiable")
  // A literal object that lacks the key still fails: that is a statement about what the call did.
  view.calls[0].args = { limit: 5 }
  assert.equal(evaluateClause(clause, view).state, "fail")
})

test("an array argument keeps its items, so its length can be asserted", () => {
  const args = { query: [safeValue("query", "login redirect loop"), safeValue("query", "state mismatch")] }
  assert.equal(argState(args, "args.query.length").value, 2)
  const clause = parseClause("call:search#1 args.query.length >= 2").clause
  assert.equal(evaluateClause(clause, { calls: [{ tool: "search", args, args_parsed: true }] }).state, "ok")
  // A single string is a redacted object with no length: that fails the 'two phrasings' check, as it should.
  const single = { query: safeValue("query", "login redirect loop") }
  assert.equal(evaluateClause(clause, { calls: [{ tool: "search", args: single, args_parsed: true }] }).state, "fail")
})

test("a plugin's own vocabulary survives redaction; user text does not", () => {
  assert.equal(typeof safeValue("scope", "history-enum-value-xyz"), "object", "unknown strings are reduced to a shape")
  extendVocab(["history-enum-value-xyz"])
  assert.equal(safeValue("scope", "history-enum-value-xyz"), "history-enum-value-xyz")
  assert.equal(typeof safeValue("query", "what did we decide about caching"), "object")
})

test("a case's Seed header reaches the compiled case, for a runner", () => {
  const text = `# seeded
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Seed: cwd=api time=day
- Budget: outer_calls <= 4

## Prompt
what did I work on yesterday?

## Items
- [H-OC01] major · It lists the day's sessions.
  evidence: count:history.* >= 1
`
  assert.equal(compileCase("seeded.md", text).seed, "cwd=api time=day")
  assert.equal(compileCase("seeded.md", text.replace("- Seed: cwd=api time=day\n", "")).seed, null)
})

test("two arms that differ in exactly one recorded axis are comparable on that axis, and only that axis", () => {
  const axis = (v) => ({ sha256: v, source: "recorded" })
  const batch = (over = {}) => ({
    provenance: {
      skills: axis("s1"), descriptions: axis("d1"), namespace: axis("n"), tools: axis("t1"), rules: axis("r1"),
      cases: { sha256: "c1", source: "recorded" }, model: { value: "m", source: "declared" }, opencode: { value: "2.2.6", source: "recorded" }, ...over,
    },
  })
  assert.equal(comparable(batch(), batch({ skills: axis("s2") }), "skill").ok, true)
  const both = comparable(batch(), batch({ skills: axis("s2"), descriptions: axis("d2") }), "skill")
  assert.equal(both.ok, false)
  assert.match(both.why.join(" "), /description differs/)
  // The host is a recorded axis too: an unrecorded host refuses the comparison.
  assert.equal(comparable(batch({ opencode: { value: null, source: "unrecorded" } }), batch(), "skill").ok, false)
})
