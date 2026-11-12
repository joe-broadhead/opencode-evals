// A plugin tool is one tool whichever way it was called; a bare name in a case is the case's plugin's tool.
import { test } from "node:test"
import assert from "node:assert/strict"
import { matchesTool, selectCalls, qualify, BUILTIN_TOOLS, builtinCollisions } from "../src/grade/select.mjs"
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

test("a bare name the case's plugin declares is qualified, unless it is one of OpenCode's own tool names", () => {
  const gws = { ns: "gws", tools: new Set(["read", "write", "delete", "send", "plan"]) }
  assert.equal(qualify("plan", gws), "gws.plan")
  for (const name of BUILTIN_TOOLS) assert.equal(qualify(name, gws), name, name)
  assert.equal(qualify("read", scope), "read", "History's read is history.read; bare read is every read")
  assert.equal(qualify("history.read", scope), "history.read")
  assert.equal(qualify("pin", scope), "history.pin")
  // absent:write in a gws case still sees the built-in write.
  const builtinWrite = { calls: [direct("write")], scope: gws }
  assert.equal(evaluateClause(parseClause("absent:write").clause, builtinWrite).state, "fail")
  const calls = [direct("read"), inner("history", "read"), direct("history_read"), direct("edit")]
  assert.equal(selectCalls(calls, "history.read", scope).length, 2, "the prefixed name is History's read alone")
  assert.equal(selectCalls(calls, "read", scope).length, 3, "the bare built-in name is every read")
  assert.equal(evaluateClause(parseClause("absent:history.*").clause, { calls: [direct("history_pin")], scope }).state, "fail", "a direct History call is not an absent History")
})

test("the built-ins are the tested hosts' own: no bash, task, list, todoread or apply_patch, and search is not one", () => {
  assert.deepEqual([...BUILTIN_TOOLS].sort(), ["edit", "execute", "experimental_image_generate", "glob", "grep", "patch", "question", "read", "shell", "skill", "subagent", "todowrite", "webfetch", "websearch", "write"])
  assert.equal(qualify("search", scope), "history.search", "History's search is History's: there is no built-in search")
})

test("compile names the cases whose bare tool names are both a built-in and the plugin's own", () => {
  const kase = { items: [{ evidence: [{ kind: "call", tool: "read" }, { kind: "absent", tool: "write" }], evidence_any: [[{ kind: "before", tool: "history.*", other: "grep" }]], na_when: [] }] }
  assert.deepEqual(builtinCollisions(kase, ["read", "search", "grep"]), ["grep", "read"])
  assert.deepEqual(builtinCollisions(kase, ["pin"]), [])
})

test("compile refuses a case that names a shared tool bare, and writes nothing", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = await import("node:fs")
  const { join } = await import("node:path")
  const { tmpdir } = await import("node:os")
  const { spawnSync } = await import("node:child_process")
  const store = mkdtempSync(join(tmpdir(), "evals-collide-"))
  const dir = join(store, "holdouts", "history")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "ambiguous.md"), "# ambiguous\n- Plugin: history\n- Skill under test: history-recall\n- Tier: T3\n- Source: test\n- Decision tested: test\n\n## Prompt\np\n\n## Items\n- [H-OC01] blocker · It read the session it found.\n  evidence: call:read#1\n")
  const out = spawnSync(process.execPath, [join(import.meta.dirname, "..", "bin", "evals"), "compile", "--plugin", "history", "--holdouts"], { encoding: "utf8", env: { PATH: process.env.PATH, EVALS_STORE: store } })
  assert.notEqual(out.status, 0)
  assert.match(out.stderr, /ambiguous: read/)
  assert.equal(existsSync(join(dir, "ambiguous.json")), false, "nothing written")
  rmSync(store, { recursive: true, force: true })
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
