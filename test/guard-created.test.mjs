// Synthetic after events exercise logging only; they do not imply a blocked write ran.
// The guard logs what `target: ... in created` reads: a write's input leaves at execute.before, and the new ids of a completed write's result at execute.after. Run against a stand-in
// plugin API with bun (the guard is TypeScript); skipped where there is no bun.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { buildPolicy } from "../src/run/guard/policy.mjs"

const ROOT = join(import.meta.dirname, "..")
const bun = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0

test("the guard records a write's input leaves and the ids its completed result returned that its input did not; a read, an update's echo and a failed write add none", { skip: bun ? false : "no bun" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-guard-created-"))
  try {
    const policy = join(dir, "guard.json")
    const built = buildPolicy({ mode: "refuse", commit: {}, plans: null, locked: true })
    writeFileSync(policy, JSON.stringify(built))
    writeFileSync(join(dir, "inventory.json"), JSON.stringify(built.inventory))
    const out = join(dir, "guard.jsonl")
    const script = `
      import { guardPlugin } from ${JSON.stringify(join(ROOT, "src/run/guard/index.ts"))}
      const hooks = {}
      const plugin = guardPlugin({ define: (d) => d }, ${JSON.stringify(policy)})
      await plugin.setup({ permission: { hook: async () => {}, reply: async () => {} }, tool: { hook: async (name, fn) => { hooks[name] = fn } }, event: { subscribe: async function* () {} } })
      const call = async (tool, input, status, result) => {
        try { hooks["execute.before"]({ tool, id: "c", sessionID: "s", input }) } catch {}
        hooks["execute.after"]({ tool, id: "c", sessionID: "s", status, input, result })
      }
      await call("granola_create_folder", { name: "Sprint notes", parent: "fld_parent01" }, "completed", '{"id":"fld_9f3a21b7","name":"Sprint notes","parent":"fld_parent01"}')
      await call("granola_update_folder", { folder_id: "fld_9f3a21b7", name: "Sprint" }, "completed", '{"id":"fld_9f3a21b7"}')
      await call("granola_create_folder", { name: "again" }, "error", '{"id":"fld_neverdone1"}')
      await call("granola_search_meetings", { query: "x" }, "completed", '{"meetings":[{"id":"mtg_existing01"}]}')
      // K1: a parent, an owner and a workspace named beside the new id are not new
      await call("granola_create_folder", { name: "named" }, "completed", '{"id":"fld_new00005","workspace_id":"ws_REAL0042","owner":"usr_REAL0007","parent_id":"fld_realparent9"}')
      // K3: a result that throws when read leaves the safety records and an empty write_result with the error
      const hostile = { get id() { throw new Error("boom") } }
      await call("granola_create_folder", { name: "hostile" }, "completed", hostile)
    `
    const run = spawnSync("bun", ["-e", script], { encoding: "utf8", env: { ...process.env, EVALS_GUARD_OUT: out } })
    assert.equal(run.status, 0, run.stderr)
    const records = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l))
    const before = records.filter((r) => r.kind === "execute_before")
    assert.deepEqual(before[0].args, { name: "Sprint notes", parent: "fld_parent01" }, "a write's input leaves")
    assert.deepEqual(before[1].args, { folder_id: "fld_9f3a21b7", name: "Sprint" })
    assert.equal(before[3].args, undefined, "a read's input is not logged")
    const results = records.filter((r) => r.kind === "write_result")
    assert.deepEqual(results.map((r) => [r.tool, r.ids]), [["granola_create_folder", ["fld_9f3a21b7"]], ["granola_update_folder", []], ["granola_create_folder", ["fld_new00005"]], ["granola_create_folder", []]], "a create's new id; the parent it was given, an update's echo, a workspace, an owner and a parent the result names are not new; the failed write and the read left none")
    assert.match(results[3].error, /boom/, "a result that cannot be read says so")
    // the safety records of the hostile call are there: one committed record per completed write, the hostile one included
    assert.equal(records.filter((r) => r.kind === "committed").length, 4, "every completed write has its committed record, whatever its result looks like")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
