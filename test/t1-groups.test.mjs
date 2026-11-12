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
