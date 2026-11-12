// T1 scripted cases that need their own plugin options (HG-9): one host per options value, the effects each access
// value should resolve to, and the `allowed` kind.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { optionGroups, toolsAt } from "../src/t1/run.mjs"
import { checkScriptedTurn } from "../src/t1/checks.mjs"
import { verifySnapshot } from "../src/pack/snapshot.mjs"

const history = JSON.parse(readFileSync(join(import.meta.dirname, "..", "packs", "history", "pack.json"), "utf8"))

test("History's T1 cases verify, and group into one host per access value, the default first", () => {
  assert.equal(verifySnapshot(history, { id: "history" }).ok, true)
  const groups = optionGroups(history)
  assert.deepEqual(groups.map((g) => [g.label, g.options?.access ?? null, g.cases.map((c) => c.kind)]), [
    [null, null, ["allowed", "allowed", "allowed"]],
    ["ask-changes", "ask-changes", ["asked"]],
    ["read-only", "read-only", ["refused"]],
  ])
})

test("under an access value, the changes resolve ask or deny and the reads stay allowed", () => {
  const effect = (options, name) => toolsAt(history, options).find((tool) => tool.name === name).effect
  assert.equal(effect(null, "pin"), "allow", "access all: pin is allowed, as declared")
  assert.equal(effect({ access: "ask-changes" }, "pin"), "ask")
  assert.equal(effect({ access: "read-only" }, "pin"), "deny")
  for (const options of [null, { access: "ask-changes" }, { access: "read-only" }]) assert.equal(effect(options, "events_list"), "allow")
  assert.deepEqual(toolsAt({ tools: [{ name: "w", class: "write", effect: "allow" }] }, { access: "read-only" }), [{ name: "w", class: "write", effect: "allow" }], "a plugin with no access option is untouched")
})

test("allowed passes when the call completed with no permission asked, and fails otherwise", () => {
  const caseDef = { kind: "allowed", tool: "pin", permission: "history_pin" }
  const result = { exit: 0, lines: [] }
  const ran = [{ kind: "execute_after", tool: "history_pin", status: "completed" }, { kind: "permission", action: "history_pin", effect_in: "allow" }]
  assert.equal(checkScriptedTurn({ pack: history, caseDef, result, capture: ran, fakeCalls: [] }).state, "pass")
  const asked = [{ kind: "execute_after", tool: "history_pin", status: "error" }, { kind: "permission", action: "history_pin", effect_in: "ask" }]
  assert.equal(checkScriptedTurn({ pack: history, caseDef, result, capture: asked, fakeCalls: [] }).state, "fail")
  assert.equal(checkScriptedTurn({ pack: history, caseDef, result, capture: [], fakeCalls: [] }).state, "fail", "never ran")
})

// At v0.0.0, History's reads other than `pin` are Code Mode tools: a host offers `execute`, not `history_sessions`.
test("History's Code Mode reads are scripted through execute, calling tools.history.<tool>", () => {
  const viaExecute = history.t1.filter((c) => c.via === "execute")
  assert.deepEqual(viaExecute.map((c) => c.tool).sort(), ["sessions", "sql"])
  const ns = history.rpc.split(".")[0]
  for (const c of viaExecute) {
    const match = /^\[\[mock:tool:([a-z_]+):(\{.*\})\]\]/.exec(c.prompt)
    assert.ok(match, c.prompt)
    assert.equal(match[1], "execute", `${c.tool} is called through execute, never as a direct tool`)
    assert.match(JSON.parse(match[2]).code, new RegExp(`tools\\.${ns}\\.${c.tool}\\(`))
    // The scripted mock unescapes its arguments once: no backslash may be needed for the call to parse.
    assert.equal(match[2].includes("\\"), false)
  }
})

test("a Code Mode case passes only when its call ran inside execute", () => {
  const caseDef = { kind: "allowed", tool: "sessions", permission: "history_sessions", via: "execute" }
  const inner = [{ kind: "execute_before", tool: "history_sessions" }, { kind: "execute_after", tool: "history_sessions", status: "completed" }]
  const wrapper = [{ kind: "execute_before", tool: "execute" }]
  const turn = { lines: [] }
  assert.equal(checkScriptedTurn({ pack: history, caseDef, result: turn, capture: [...wrapper, ...inner], fakeCalls: [] }).state, "pass")
  assert.equal(checkScriptedTurn({ pack: history, caseDef, result: turn, capture: inner, fakeCalls: [] }).state, "fail", "a direct call is not the Code Mode path")
})

test("the SDK runner names a case's tool from the plugin under test, never a fixed plugin's prefix", async () => {
  const { directToolId } = await import("../src/t1/checks.mjs")
  const x = JSON.parse(readFileSync(join(import.meta.dirname, "..", "packs", "x", "pack.json"), "utf8"))
  assert.equal(directToolId(history, history.t1.find((c) => c.kind === "asked")), "history_pin")
  assert.equal(directToolId(x, x.t1.find((c) => c.kind === "asked")), "x_create_posts")
  assert.equal(directToolId({ tools: [{ name: "bar", permission: "foo_bar" }] }, { kind: "asked", tool: "bar" }), "foo_bar", "from the pack's own tool when the case names no permission")
  const source = readFileSync(join(import.meta.dirname, "..", "src", "t1", "sdk", "run.mjs"), "utf8")
  assert.doesNotMatch(source, /["'`]x_|x_\$\{|catalog: "x"|flag\("plugin", "x"\)/, "no X assumption in the plugin-generic runner")
  // A case's own options reach the plugin: each one gets a location set up with them.
  assert.match(source, /locationFor\(askCase\)/)
  assert.match(source, /locationFor\(denyCase\)/)
})

// The embedded-SDK run against a real History checkout, when one is configured (EVALS_SDK_DIR and EVALS_REPO_HISTORY;
// bun): the ask-changes and read-only cases reach `history_pin` with their own options, and nothing else.
const sdkReason = !process.env.EVALS_SDK_DIR || !process.env.EVALS_REPO_HISTORY ? "set EVALS_SDK_DIR and EVALS_REPO_HISTORY to a built History checkout" : null
test("the SDK runner asks for history_pin at ask-changes and refuses it at read-only (History checkout)", sdkReason ? { skip: sdkReason } : {}, async () => {
  const { spawnSync } = await import("node:child_process")
  const child = spawnSync(process.env.EVALS_BUN ?? "bun", [join(import.meta.dirname, "..", "src", "t1", "sdk", "run.mjs"), "--plugin", "history"], { encoding: "utf8", timeout: 180_000, env: process.env })
  const out = JSON.parse(String(child.stdout).trim().split("\n").pop())
  const byId = Object.fromEntries(out.checks.map((c) => [c.id, c]))
  assert.equal(byId["history-asked-pin"].state, "pass", JSON.stringify(byId["history-asked-pin"]))
  assert.deepEqual([byId["history-asked-pin"].evidence.tool, byId["history-asked-pin"].evidence.options], ["history_pin", { access: "ask-changes" }])
  assert.equal(byId["history-refused-pin"].state, "pass")
  assert.equal(byId["history-refused-pin"].evidence.offered, true, "refused because denied, not because a wrong name was not registered")
  assert.match(byId["history-refused-pin"].evidence.error, /Permission denied: history_pin/)
})
