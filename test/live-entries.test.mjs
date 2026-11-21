// A live-*.json entry: Code Mode (`code`), a direct tool (`tool` + `args`) or a sequence (`steps`). `@alias` resolves in all
// three, and a direct call's argument gets the alias's raw value (Code Mode needs it escaped into source, JSON needs it as-is).
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { live, liveEntry, p7, resolveArgs } from "../src/p0/probes.mjs"
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

test("p7 judges URLs named in a direct-tool entry, and live requires the final write step itself to be declined", async () => {
  const store = mkdtempSync(join(tmpdir(), "evals-live-probe-"))
  try {
    writeFileSync(join(store, "targets.json"), JSON.stringify({ gws: { folder: "1Folder_evals-sandbox" } }))
    writeFileSync(join(store, "live-reads.json"), JSON.stringify({ gws: { tool: "gws_read", args: { url: "https://extra.gws.example/v1" } } }))
    // M4: if p7 passed code: "" instead of resolved.text, extra.gws.example would land in `unknown` rather than `refused`.
    const readRes = await p7({
      store,
      caller: { EVALS_PROFILE: store },
      scriptedRun: async () => ({
        trials: { "tools-live-read-gws": { calls: [{ tool: "gws_read", status: "completed", output: "ok" }], summary: { guard: { committed: 0, write_calls: 0 } } } },
        egress: { allowed: {}, refused: { "extra.gws.example": { why: ["not-allowed"] } } },
        cleanup: () => {},
      }),
    })
    assert.equal(readRes.ok, false)
    assert.equal(readRes.checks.find((c) => c.name.includes("no host of its own pack was refused")).ok, false)

    // M5(a): a single write call that was NOT declined fails `live`.
    writeFileSync(join(store, "live-writes.json"), JSON.stringify({ gws: { tool: "gws_write", args: { planId: "plan_1" } } }))
    const notDeclined = await live({
      store,
      caller: { EVALS_PROFILE: store },
      scriptedRun: async () => ({
        trials: { "tools-live-gws": { calls: [{ tool: "gws_write", status: "completed", output: "PLAN_NOT_FOUND" }], analysed: { inner: { declined: 0 } }, summary: { guard: { committed: 0, assert_committed: 0 }, host_log: { plugin_load_failures: [] } } } },
        cleanup: () => {},
      }),
    })
    assert.equal(notDeclined.ok, false)
    assert.equal(notDeclined.checks.find((c) => c.name.includes("is declined")).ok, false)

    // M5(b): a two-step entry where step 1 is declined and step 2 is NOT declined fails `live`.
    const step1Only = await live({
      store,
      caller: { EVALS_PROFILE: store },
      scriptedRun: async () => ({
        trials: {
          "tools-live-gws": {
            calls: [
              { tool: "execute", status: "error", error: "Permission denied: cannot ask the user" },
              { tool: "gws_write", status: "completed", output: "ok" },
            ],
            analysed: { inner: { declined: 1 } },
            summary: { guard: { committed: 0, assert_committed: 0 }, host_log: { plugin_load_failures: [] } },
          },
        },
        cleanup: () => {},
      }),
    })
    assert.equal(step1Only.ok, false)

    // M5(c): a two-step entry where step 1 (`plan`) succeeds and step 2 (`gws_write`) IS declined passes `live`.
    const step2Declined = await live({
      store,
      caller: { EVALS_PROFILE: store },
      scriptedRun: async () => ({
        trials: {
          "tools-live-gws": {
            calls: [
              { tool: "execute", status: "completed", output: '{"planId":"plan_1"}' },
              { tool: "gws_write", status: "error", error: "Permission denied: cannot ask the user" },
            ],
            analysed: { inner: { declined: 1 } },
            summary: { guard: { committed: 0, assert_committed: 0 }, host_log: { plugin_load_failures: [] } },
          },
        },
        cleanup: () => {},
      }),
    })
    assert.equal(step2Declined.ok, true)
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})
