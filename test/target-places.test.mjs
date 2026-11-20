// `target:` places beyond an alias's exact values: a prefix alias (`@boxd.prefix*`) and `created` (made earlier in the same trial), for the writes whose argument has no alias.
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseClause, evaluateClause } from "../src/grade/evidence.mjs"
import { runView } from "../src/grade/grade.mjs"
import { flatten } from "../src/grade/targets.mjs"
import { dataPreflight } from "../src/run/gate.mjs"
import { compileCase } from "../src/case/compile.mjs"
import { scalarLeaves, newIds, ID_SHAPE } from "../src/run/guard/logic.mjs"

const head = { schema: "oc-trace/1", run_id: "t/0", case: "t", trial: 1, arm: "a", exit: 0, failure_class: null, model: { id: "m", params: {} }, summary: { outer_calls: 1, inner_calls: 0, tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } }
const call = (seq, ns, tool, via = "execute") => ({ seq, ts_ms: 0, kind: "tool_call", tool, ns, via, args: {}, args_parsed: true })
const result = (seq, forSeq, status = "ok") => ({ seq, ts_ms: 0, kind: "tool_result", for_seq: forSeq, status })
const view = (events, opts = {}) => runView([head, ...events], opts)
const check = (line, v) => {
  const parsed = parseClause(line)
  assert.ok(parsed.ok, `${line}: ${parsed.why}`)
  return evaluateClause(parsed.clause, v)
}

// ---------------------------------------------------------------------------------------------- prefix aliases

const TARGETS = flatten({ boxd: { prefix: "evals-232-", name: "evals-232-main", empty: "", short_prefix: "ev-", loose_prefix: "evals-232", machine: "evals-232-" }, slack: { self_dm: "D0SELF" } })
const exec = (name) => view([call(1, "boxd", "machine_new"), result(2, 1)], { rawArgs: [{ name }], targets: TARGETS })

test("target: an alias written @name* admits a value that starts with one of its values (boxd's evals-232- machine names)", () => {
  const line = "target:boxd.machine_new#1 args.name in @boxd.prefix*"
  assert.deepEqual(parseClause(line).clause.aliases, ["@boxd.prefix*"])
  assert.equal(check(line, exec("evals-232-trial-1")).state, "ok")
  assert.equal(check(line, exec("evals-232-")).state, "fail", "the prefix alone is not a name inside it")
  assert.equal(check(line, exec("evals-232")).state, "fail", "a prefix of the prefix is not a match")
  assert.equal(check(line, exec("other-machine")).state, "fail")
  assert.equal(check(line, exec("my-evals-232-box")).state, "fail", "a prefix, not a substring")
  assert.equal(check(line, exec("EVALS-232-x")).state, "fail", "case counts")
  // every value of a list
  assert.equal(check(line, view([call(1, "boxd", "machine_new"), result(2, 1)], { rawArgs: [{ name: ["evals-232-a", "evals-232-b"] }], targets: TARGETS })).state, "ok")
  assert.equal(check(line, view([call(1, "boxd", "machine_new"), result(2, 1)], { rawArgs: [{ name: ["evals-232-a", "prod"] }], targets: TARGETS })).state, "fail")
  // exact and prefix in one list; without the star an alias is exact as before
  assert.equal(check("target:boxd.machine_new#1 args.name in @boxd.name,@boxd.prefix*", exec("evals-232-main")).state, "ok")
  assert.equal(check("target:boxd.machine_new#1 args.name in @boxd.name,@slack.self_dm", exec("evals-232-trial-1")).state, "fail")
  assert.equal(check("target:boxd.machine_new#1 args.name in @boxd.prefix", exec("evals-232-trial-1")).state, "fail", "no star: the value must be the alias's, not start with it")
  // a star is allowed only for an alias the targets file DECLARES a prefix, at least 8 characters, ended by a separator
  assert.match(check("target:boxd.machine_new#1 args.name in @slack.self_dm*", exec("D0SELFxyz")).detail, /is used as a prefix, but slack\.self_dm is not declared one/, "an exact id used as a prefix")
  assert.match(check("target:boxd.machine_new#1 args.name in @boxd.name*", exec("evals-232-main-and-more")).detail, /not declared one/, "an ordinary alias")
  assert.match(check("target:boxd.machine_new#1 args.name in @boxd.short_prefix*", exec("ev-anything")).detail, /is 3 character\(s\): at least 8/, "a short prefix admits engine-prod")
  assert.match(check("target:boxd.machine_new#1 args.name in @boxd.loose_prefix*", exec("evals-2321")).detail, /does not end in a separator/, "evals-232 would match evals-2321")
  const declared = flatten({ prefixes: ["boxd.machine"], boxd: { machine: "evals-232-" } })
  assert.equal(check("target:boxd.machine_new#1 args.name in @boxd.machine*", view([call(1, "boxd", "machine_new"), result(2, 1)], { rawArgs: [{ name: "evals-232-x1" }], targets: declared })).state, "ok", "declared in `prefixes`")
  // a prefix is textual, and a path escapes it: refused
  for (const escape of ["evals-232-../../prod", "evals-232-/../real", "evals-232-a\\..\\b", "evals-232-x/.."]) assert.equal(check("target:boxd.machine_new#1 args.name in @boxd.prefix*", exec(escape)).state, "fail", escape)
  assert.equal(check("target:boxd.machine_new#1 args.name in @boxd.prefix*", exec("evals-232-a..b")).state, "ok", "two dots inside a name are a name")
  // what cannot be decided is not passed
  assert.equal(check("target:boxd.machine_new#1 args.name in @boxd.nope*", exec("evals-232-x")).state, "unverifiable", "an alias the store lacks")
  assert.equal(check("target:boxd.machine_new#1 args.name in @boxd.empty*", exec("anything")).state, "unverifiable", "empty targets are no targets, so a prefix of nothing is unknown, never everything")
  assert.equal(check(line, view([call(1, "boxd", "machine_new")], { targets: TARGETS })).state, "unverifiable", "no recording")
  assert.equal(check(line, view([call(1, "boxd", "machine_new")], { rawArgs: [{}], targets: TARGETS })).state, "fail", "the argument was not passed")
  // the grammar
  for (const bad of ["target:boxd.machine_new#1 args.name in @boxd.prefix**", "target:boxd.machine_new#1 args.name in @*", "target:boxd.machine_new#1 args.name in *"]) assert.equal(parseClause(bad).ok, false, bad)
  assert.equal(parseClause("gws-plan:#1 target in @gws.folder*").ok, false, "the plan clause takes exact aliases only")
})

test("the data preflight looks for the alias a prefix names, without its star", () => {
  const c = compileCase("cases/boxd/tools-m.md", `# tools-m
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: t
- Decision tested: x
- Data: own
- Set: wide

## Prompt
create a machine

## Items
- [BOX-WR01] blocker · Only a machine of the evals.
  evidence: target:boxd.machine_new#1 args.name in @boxd.prefix*
`)
  assert.deepEqual(dataPreflight([c], { targets: TARGETS, canaries: new Map() }), [])
  assert.match(dataPreflight([c], { targets: flatten({}), canaries: new Map() })[0].why, /@boxd\.prefix\*, which the store lacks/)
})

// ---------------------------------------------------------------------------------------------- created in this trial: read from the guard's log

const UPDATE = ["granola", "update_folder"]
const guardView = (log, calls = [[...UPDATE]], extra = {}) => view(calls.flatMap(([ns, tool], i) => [call(2 * i + 1, ns, tool), result(2 * i + 2, 2 * i + 1)]), { guardLog: log, targets: TARGETS, scope: { ns: "granola", tools: new Set(["create_folder", "update_folder", "search_meetings"]) }, ...extra })
// the guard logs a write's input as the scalar leaves it flattens to (`folder_ids.0`)
const before = (tool, args) => ({ kind: "execute_before", tool: `granola_${tool}`, call: `c-${Math.random()}`, write: true, pass: true, args: scalarLeaves(args) })
const noArgs = (tool) => ({ kind: "execute_before", tool: `granola_${tool}`, call: "r", write: false, pass: true })
const wrote = (tool, ids) => ({ kind: "write_result", tool: `granola_${tool}`, call: "w", ids })
const line = "target:granola.update_folder#1 args.folder_id in created"
const created = (log) => check(line, guardView(log))

test("target: `in created` passes an id that an earlier COMPLETED WRITE returned and the call did not give it, including inside one script; and nothing else", () => {
  assert.deepEqual(parseClause(line).clause, { kind: "target", tool: "granola.update_folder", n: 1, arg: "args.folder_id", aliases: [], created: true })
  const ok = created([before("create_folder", { name: "Sprint notes" }), wrote("create_folder", ["fld_9f3a21b7"]), before("update_folder", { folder_id: "fld_9f3a21b7", name: "Sprint" })])
  assert.equal(ok.state, "ok")
  assert.match(ok.detail, /1 returned by an earlier write of this trial/)
  // S4: create and use in ONE script is the same log, in the same order: accepted
  // S1: a pre-existing id that a READ returned, with a write in the same script: reads add no id, so the write's own result is the only source
  assert.equal(created([before("update_folder", { folder_id: "fld_existing_REAL1" })]).state, "fail", "nothing created it")
  assert.equal(created([before("create_folder", { name: "x" }), wrote("create_folder", ["fld_9f3a21b7"]), before("update_folder", { folder_id: "fld_existing_REAL1" })]).state, "fail", "a create next to a read of another id does not make that id created")
  // S2: an update of a pre-existing object echoes its id: an update's result adds none (the id was in its input)
  assert.equal(created([before("update_folder", { folder_id: "fld_existing_REAL1" }), wrote("update_folder", []), before("update_folder", { folder_id: "fld_existing_REAL1" })]).state, "fail")
  // S5: a write that failed (caught) has no write_result; an id the script invented is not one
  assert.equal(created([before("create_folder", { name: "x" }), before("update_folder", { folder_id: "fld_invented_by_script" })]).state, "fail")
  // S6: a small number is not an id, whatever else the result said
  assert.equal(created([wrote("create_folder", ["7"]), before("update_folder", { folder_id: "7" })]).state, "fail", "too short and no id shape")
  assert.equal(created([wrote("create_folder", ["12345678"]), before("update_folder", { folder_id: "12345678" })]).state, "ok", "8 digits is an id")
  // the id must have come BEFORE the call that uses it
  assert.equal(created([before("update_folder", { folder_id: "fld_9f3a21b7" }), wrote("create_folder", ["fld_9f3a21b7"])]).state, "fail")
  // a value that looks nothing like an id is not accepted even if a result named it (a word)
  assert.equal(created([wrote("create_folder", ["completed1"]), before("update_folder", { folder_id: "completed" })]).state, "fail")
  // lists: every value
  const many = "target:granola.update_folder#1 args.folder_ids in created"
  const log = [wrote("create_folder", ["fld_aaaa1111", "fld_bbbb2222"])]
  assert.equal(check(many, guardView([...log, before("update_folder", { folder_ids: ["fld_aaaa1111", "fld_bbbb2222"] })])).state, "ok")
  assert.equal(check(many, guardView([...log, before("update_folder", { folder_ids: ["fld_aaaa1111", "fld_cccc3333"] })])).state, "fail", "one of two is not created")
  assert.equal(check(many, guardView([...log, before("update_folder", {})])).state, "fail", "not passed")
  // the call it names
  assert.equal(check("target:granola.update_folder#2 args.folder_id in created", guardView([before("update_folder", { folder_id: "x" })])).state, "fail", "no second call")
  assert.equal(created([wrote("create_folder", ["fld_9f3a21b7"]), before("update_folder", { folder_id: "fld_9f3a21b7" }), before("update_folder", { folder_id: "other" })]).state, "ok", "the first call")
})

test("target: `in created` reads the value the tool REALLY got, so a variable the script resolved is judged, not skipped", () => {
  // the script text said `folder_id: made.id`; the recording's argument is opaque; the guard saw the value
  const opaque = view([call(1, "granola", "update_folder"), result(2, 1)], { rawArgs: [{ folder_id: { kind: "variable" } }], guardLog: [wrote("create_folder", ["fld_9f3a21b7"]), before("update_folder", { folder_id: "fld_9f3a21b7" })], scope: { ns: "granola", tools: new Set(["update_folder"]) } })
  assert.equal(check(line, opaque).state, "ok")
})

test("target: `in created` is unverifiable without the guard's log or for a tool the guard does not log the input of; an alias and `created` are alternatives", () => {
  assert.equal(check(line, view([call(1, "granola", "update_folder"), result(2, 1)], { rawArgs: [{ folder_id: "x" }], scope: { ns: "granola", tools: new Set(["update_folder"]) } })).state, "unverifiable", "no log")
  assert.equal(check(line, guardView([noArgs("update_folder")])).state, "unverifiable", "not a write of a pack")
  const both = "target:granola.update_folder#1 args.folder_id in @granola.sandbox_folder,created"
  const targets = flatten({ granola: { sandbox_folder: "fld_sandbox" } })
  const at = (log) => check(both, { ...guardView(log), targets })
  assert.equal(at([before("update_folder", { folder_id: "fld_sandbox" })]).state, "ok", "the sandbox's own")
  assert.equal(at([wrote("create_folder", ["fld_new0001"]), before("update_folder", { folder_id: "fld_new0001" })]).state, "ok", "or made in the trial")
  assert.equal(at([wrote("create_folder", ["fld_new0001"]), before("update_folder", { folder_id: "fld_elsewhere" })]).state, "fail")
  assert.equal(check(line, { ...guardView([wrote("create_folder", ["fld_new0001"]), before("update_folder", { folder_id: "fld_new0001" })]), targets: null }).state, "ok", "`created` alone needs no targets file")
  assert.equal(check("target:granola.update_folder#1 args.folder_id in @granola.nowhere,created", guardView([wrote("create_folder", ["fld_new0001"]), before("update_folder", { folder_id: "fld_new0001" })])).state, "unverifiable", "an alias the store lacks")
})

test("`in created` is advisory: a blocker may not rest on it", () => {
  const text = (severity) => `# tools-update-folder\n- Plugin: granola\n- Skill under test: granola\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: real\n- Set: wide\n\n## Prompt\nrename the folder you just made\n\n## Items\n- [GRA-WR01] ${severity} · Only a folder of this trial.\n  evidence: target:granola.update_folder#1 args.folder_id in created\n`
  assert.throws(() => compileCase("cases/granola/tools-update-folder.md", text("blocker")), /\`in created\` is advisory: a blocker may not rest on it/)
  assert.equal(compileCase("cases/granola/tools-update-folder.md", text("major")).items[0].evidence[0].created, true)
  assert.equal(compileCase("cases/granola/tools-update-folder.md", text("minor")).items[0].severity, "minor")
})

test("the guard's two helpers: the leaves of a write's input, and the ids its result names that its input did not", () => {
  assert.deepEqual(scalarLeaves({ folder_id: "fld_9f3a21b7", items: [{ to: "x" }, { to: "y" }], n: 3, nothing: null, deep: { a: { b: "c" } } }), { folder_id: "fld_9f3a21b7", "items.0.to": "x", "items.1.to": "y", n: "3", "deep.a.b": "c" })
  assert.equal(Object.keys(scalarLeaves(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, "v"])))).length, 60, "bounded")
  assert.equal(scalarLeaves({ a: "x".repeat(500) }).a.length, 200)
  // a create's new id, in each shape a result takes
  assert.deepEqual(newIds('{"id":"fld_9f3a21b7","name":"Sprint notes","count":7}', { name: "Sprint notes" }), ["fld_9f3a21b7"])
  assert.deepEqual(newIds({ content: [{ type: "text", text: '{"page":{"id":"3f2a9c1e-77aa-4b21-9c11-0d3e5f6a7b8c"}}' }] }, {}, { tool: "notion-create-pages" }), ["3f2a9c1e-77aa-4b21-9c11-0d3e5f6a7b8c"])
  assert.deepEqual(newIds("Created page in the sandbox. id: pg-12345678", {}), ["pg-12345678"])
  assert.deepEqual(newIds("Created page pg-12345678 in the sandbox", {}), [], "prose that names an id without saying it is the id is not read")
  assert.deepEqual(newIds({ ts: "1757000001.000100" }, {}), ["1757000001.000100"], "a Slack ts")
  // an update echoes the id it was given: none; a word and a small number are not ids
  assert.deepEqual(newIds('{"id":"fld_existing1"}', { folder_id: "fld_existing1" }), [])
  assert.deepEqual(newIds({ id: 7, item_count: 7, status: "completed", word: "completedxx" }, {}), [])
  assert.deepEqual(newIds(null, {}), [])
  // review of #14, K1: only the id the write's result gives to what it MADE. A parent, an owner, a workspace, a list of ids, a timestamp and the id an update merely echoes are not new.
  assert.deepEqual(newIds({ id: "fld_new00001", workspace_id: "ws_REAL0042", owner: "usr_REAL0007", parent_id: "fld_realparent9", created_at: "2026-09-17T12:00:00Z" }, { name: "x" }, { tool: "create_folder" }), ["fld_new00001"])
  assert.deepEqual(newIds({ id: "fld_existing1", parent_id: "fld_realparent9", owner: "usr_REAL0007" }, { folder_id: "fld_existing1" }, { tool: "update_folder" }), [], "an update of a pre-existing folder names its parent and owner: neither is new")
  assert.deepEqual(newIds({ ids: ["fld_a0000001", "fld_b0000002"], updated: 2 }, {}, { tool: "update_folders" }), [], "a bulk update's list of ids")
  assert.deepEqual(newIds({ folder: { id: "fld_new00002" }, parent: { id: "fld_realparent9" }, owner: { id: "usr_REAL0007" } }, {}, { tool: "create_folder" }), ["fld_new00002"], "the written thing's own key is walked; a parent's and an owner's are not")
  assert.deepEqual(newIds({ data: { id: "iss_new00003", team: { id: "team_REAL001" }, project: { id: "prj_REAL0001" } } }, {}, { tool: "save_issue" }), ["iss_new00003"], "an envelope is walked; the team and project the issue belongs to are not")
  assert.deepEqual(newIds({ pages: [{ id: "pg_new000001", parent: { page_id: "pg_realparent1" } }, { id: "pg_new000002" }] }, {}, { tool: "notion-create-pages" }), ["pg_new000001", "pg_new000002"], "a create of several")
  assert.deepEqual(newIds({ folder_id: "fld_new00004", workspace_id: "ws_REAL0042" }, {}, { tool: "create_folder" }), ["fld_new00004"], "`<noun>_id` is the thing's id")
  assert.deepEqual(newIds({ owner: { id: "usr_REAL0007" }, id: "x" }, {}, { tool: "create_folder" }), [], "an owner's id alone, and a short id")
  assert.equal(ID_SHAPE.test("fld_9f3a21b7"), true)
  assert.equal(ID_SHAPE.test("abcdefghij"), false, "no digit")
  assert.equal(ID_SHAPE.test("a1"), false, "short")
})
