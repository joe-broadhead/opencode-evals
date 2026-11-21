// A live-*.json entry: Code Mode (`code`), a direct tool (`tool` + `args`) or a sequence (`steps`). `@alias` resolves in all
// three, and a direct call's argument gets the alias's raw value (Code Mode needs it escaped into source, JSON needs it as-is).
import assert from "node:assert/strict"
import test from "node:test"
import { liveEntry, resolveArgs } from "../src/p0/probes.mjs"
import { directiveOf, parseToolDirective } from "../src/t1/mock/directive.mjs"

const targets = new Map([
  ["gws.folder", ["1Folder_evals-sandbox"]],
  ["gws.note", ["it's a note"]],
  ["slack.sandbox_channel", ["C0SANDBOX"]],
])

test("a direct-tool entry calls that tool with the aliases resolved in every argument", () => {
  const entry = { tool: "gws_read", args: { operation: "drive.files.list", params: { q: "'@gws.folder' in parents" }, pagination: { maxItems: 5 } } }
  const resolved = liveEntry(entry, targets)
  assert.equal(resolved.error, undefined)
  assert.deepEqual(parseToolDirective("tool", directiveOf(resolved.prompt).arg), {
    name: "gws_read",
    args: { operation: "drive.files.list", params: { q: "'1Folder_evals-sandbox' in parents" }, pagination: { maxItems: 5 } },
  })
  assert.match(resolved.text, /1Folder_evals-sandbox/)
  // A raw value keeps its quotes: it is data, not Code Mode source.
  const quoted = liveEntry({ tool: "gws_write", args: { name: "@gws.note" } }, targets)
  assert.equal(parseToolDirective("tool", directiveOf(quoted.prompt).arg).args.name, "it's a note")
  assert.deepEqual(resolveArgs({ list: ["@gws.folder", "user@example.com"], nested: { id: "@slack.sandbox_channel" } }, targets).value, { list: ["1Folder_evals-sandbox", "user@example.com"], nested: { id: "C0SANDBOX" } }, "an email is not an alias")
})

test("a steps entry is a sequence, with @aliases and {{previous.planId}} preserved for the mock", () => {
  const entry = {
    steps: [
      { code: "const plan = await tools.gws.plan({ operation: 'drive.files.create', body: { parents: '@gws.folder'.split(',') } }); return plan" },
      { tool: "gws_write", args: { planId: "{{previous.planId}}" } },
    ],
  }
  const resolved = liveEntry(entry, targets)
  assert.equal(resolved.error, undefined)
  const directive = directiveOf(resolved.prompt)
  assert.equal(directive.kind, "steps")
  assert.deepEqual(JSON.parse(directive.arg), [
    { code: "const plan = await tools.gws.plan({ operation: 'drive.files.create', body: { parents: '1Folder_evals-sandbox'.split(',') } }); return plan" },
    { tool: "gws_write", args: { planId: "{{previous.planId}}" } },
  ])
})

test("an unresolved alias, an empty step and an entry with no shape are errors, never a throw", () => {
  assert.match(liveEntry({ tool: "gws_read", args: { id: "@gws.nowhere" } }, targets).error, /@gws\.nowhere not in targets\.json/)
  assert.match(liveEntry({ steps: [{ code: "@gws.nowhere" }] }, targets).error, /@gws\.nowhere not in targets\.json/)
  assert.match(liveEntry({ steps: [{ code: "return 1" }, {}] }, targets).error, /step 2 has neither `code` nor `tool`/)
  assert.match(liveEntry({ action: "x" }, targets).error, /no `code`, `tool` or `steps`/)
  assert.match(liveEntry({ tool: "gws_read", args: { id: "@gws.folder" } }, null).error, /not in targets\.json/, "no targets file: an alias cannot resolve")
  // `code` still works exactly as before.
  assert.equal(directiveOf(liveEntry({ code: "return await tools.gws.status({})" }, targets).prompt).kind, "tool")
})
