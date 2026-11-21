import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { p7 } from "../src/p0/probes.mjs"
import { STEPS, runPhase1 } from "../src/phase1.mjs"

test("p0 refuses P7, aggregates and extra arguments before reading poisoned caps", () => {
  const store = mkdtempSync(join(tmpdir(), "p7-cli-"))
  writeFileSync(join(store, "caps.json"), "{invalid")
  for (const args of [["p7"], ["live,p7"], ["p7,gws"], ["all"], [], ["live", "p7"], ["gws", "p7"]]) {
    const out = spawnSync(process.execPath, ["bin/evals", "p0", ...args], {
      cwd: join(import.meta.dirname, ".."),
      env: { PATH: process.env.PATH, HOME: store, TMPDIR: process.env.TMPDIR, EVALS_STORE: store, EVALS_PROFILE: join(store, "missing") },
      encoding: "utf8",
    })
    assert.notEqual(out.status, 0, args.join(" "))
    assert.match(out.stderr + out.stdout, /P0-7 is disabled|one probe list only/)
    assert.doesNotMatch(out.stderr + out.stdout, /JSON|caps\.json/)
  }
})

test("direct p7 and the phase1 P7 step refuse without touching inputs or probes", async () => {
  const poisoned = new Proxy({}, { get() { throw new Error("input touched") } })
  await assert.rejects(p7(poisoned), /input touched/) // Only the explicit in-process seam is inspected.
  await assert.rejects(p7({ get store() { throw new Error("store touched") } }), /P0-7 is disabled/)
  const step = STEPS.find((s) => s.id === "p7")
  const result = await step.run(poisoned)
  assert.equal(result.ok, false)
  assert.match(result.message, /P0-7 is disabled/)
})

test("phase1 stops at P7 and saved passes cannot authorize downstream starts", async () => {
  const store = mkdtempSync(join(tmpdir(), "p7-phase1-"))
  const before = STEPS.slice(0, STEPS.findIndex((s) => s.id === "p7"))
  const state = { steps: Object.fromEntries(STEPS.map((s) => [s.id, { ok: true }])) }
  const file = join(store, "phase1.json")
  writeFileSync(file, JSON.stringify(state))
  const throwing = new Proxy({}, { get() { throw new Error("dependency touched") } })
  for (const id of ["p7", "live", "gws", "pilot"]) {
    for (const field of ["only", "from"]) {
      writeFileSync(file, JSON.stringify(state))
      const result = await runPhase1({ store, ctx: throwing, [field]: id, log: () => {} })
      assert.equal(result.ok, false, `${field} ${id}`)
      assert.equal(result.stopped.id, "p7")
      assert.match(result.stopped.message, /P0-7 is disabled/)
      if (id !== "p7") assert.equal(readFileSync(file, "utf8"), JSON.stringify(state))
    }
  }
  const calls = []
  const steps = [...before.map((s) => ({ ...s, run: async () => { calls.push(s.id); return { ok: true, lines: [] } } })), ...STEPS.slice(before.length).map((s) => s.id === "p7" ? s : { ...s, run: () => { throw new Error("downstream called") } })]
  const result = await runPhase1({ store, ctx: throwing, steps, reset: true, log: () => {} })
  assert.equal(result.stopped.id, "p7")
  assert.deepEqual(calls, before.map((s) => s.id))
})

test("phase1 CLI rejects downstream starts despite a saved P7 pass", () => {
  const store = mkdtempSync(join(tmpdir(), "p7-phase1-cli-"))
  const state = JSON.stringify({ steps: Object.fromEntries(STEPS.map((s) => [s.id, { ok: true }])) })
  writeFileSync(join(store, "phase1.json"), state)
  for (const id of ["live", "gws", "pilot"]) {
    for (const flag of ["--only", "--from"]) {
      const out = spawnSync(process.execPath, ["bin/evals", "phase1", flag, id], {
        cwd: join(import.meta.dirname, ".."),
        env: { PATH: process.env.PATH, HOME: store, TMPDIR: process.env.TMPDIR, EVALS_STORE: store, EVALS_PROFILE: join(store, "missing"), OPENCODE_BIN: join(store, "must-not-run") },
        encoding: "utf8",
      })
      assert.notEqual(out.status, 0, `${flag} ${id}`)
      assert.match(out.stderr + out.stdout, /P0-7 is disabled/)
      assert.equal(readFileSync(join(store, "phase1.json"), "utf8"), state)
    }
  }
})
