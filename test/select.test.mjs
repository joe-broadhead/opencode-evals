// A plugin tool is one tool whichever way it was called; a bare name in a case is the case's plugin's tool.
import { test } from "node:test"
import assert from "node:assert/strict"
import { matchesTool, selectCalls, qualify } from "../src/grade/select.mjs"
import { parseClause, evaluateClause } from "../src/grade/evidence.mjs"

const inner = (ns, tool, args = {}) => ({ tool, ns, via: "execute", args, args_parsed: true })
const direct = (tool, args = {}) => ({ tool, via: "direct", args, args_parsed: true })
const scope = { ns: "history", tools: new Set(["search", "read", "pin", "sql"]) }
const check = (view, text) => evaluateClause(parseClause(text).clause, view).state

test("history.* and history.read select the inner call and the direct history_ tool alike", () => {
  assert.equal(matchesTool("history.*", inner("history", "search")), true)
  assert.equal(matchesTool("history.*", direct("history_pin")), true, "a direct history_pin is a History call")
  assert.equal(matchesTool("history.*", direct("read")), false)
  assert.equal(matchesTool("history.*", inner("x", "search_posts_all")), false)
  assert.equal(matchesTool("history.read", inner("history", "read")), true)
  assert.equal(matchesTool("history.read", direct("history_read")), true)
  assert.equal(matchesTool("history.read", direct("read")), false, "the built-in file read is not History's read")
  assert.equal(matchesTool("history_pin", inner("history", "pin")), true)
  assert.equal(matchesTool("history_pin", direct("history_pin")), true)
})

test("a bare name the case's plugin declares is qualified; a built-in stays the built-in", () => {
  assert.equal(qualify("read", scope), "history.read")
  assert.equal(qualify("edit", scope), "edit")
  assert.equal(qualify("history.read", scope), "history.read")
  assert.equal(qualify("read", null), "read", "no plugin scope, no qualification")
  const calls = [direct("read"), inner("history", "read"), direct("history_read"), direct("edit")]
  assert.equal(selectCalls(calls, "read", scope).length, 2)
  assert.equal(selectCalls(calls, "edit", scope).length, 1)
  const view = { calls, scope }
  assert.equal(evaluateClause(parseClause("count:read == 2").clause, view).state, "ok")
  assert.equal(evaluateClause(parseClause("absent:history.*").clause, { calls: [direct("history_pin")], scope }).state, "fail", "a direct History call is not an absent History")
})

test("first: and before: read the order of the calls, skill loads and the execute wrapper aside", () => {
  const skill = direct("skill")
  const execute = { tool: "execute", via: "execute", args: {} }
  const historyFirst = { calls: [skill, execute, inner("history", "search"), direct("bash"), direct("grep")], scope }
  const gitFirst = { calls: [direct("bash"), execute, inner("history", "search")], scope }
  const noHistory = { calls: [direct("grep")], scope }
  assert.equal(check(historyFirst, "first:history.*"), "ok")
  assert.equal(check(gitFirst, "first:history.*"), "fail")
  assert.equal(check(historyFirst, "before:history.*,bash"), "ok")
  assert.equal(check(gitFirst, "before:history.*,bash"), "fail")
  assert.equal(check(noHistory, "before:history.*,bash"), "ok", "bash never ran")
  assert.equal(check(noHistory, "before:history.*,grep"), "fail", "grep ran and History never did")
  assert.equal(check({ calls: [skill], scope }, "first:history.*"), "fail")
})
