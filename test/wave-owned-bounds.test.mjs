// Regression for the owned wave's unfloored plan bounds (dispatch BLOCKER 2): the
// real lease reads fractional milliseconds (performance.now() differences), while
// validateOwnedPlan requires safe-integer bounds. Every prior offline test injected
// integer clocks, which is why the fractional pre-dispatch refusal
// "finite owned bounds required" never failed offline.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { main } from "../scripts/run-mem-wave.mjs"
import { WAVE_MODEL } from "../src/run/wave-manifest.mjs"
import { containedFixture, drive, fakeIdentityOwner } from "./support/wave-contained-parent.mjs"

test("fractional lease readings still dispatch with floored safe-integer bounds", async t => {
  const root = mkdtempSync(join(tmpdir(), "wave-owned-bounds-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const wave = { id: "owned", harness_sha: "a".repeat(40), control: join(root, "control"), store: join(root, "store"), docker_config: join(root, "docker"),
    model: WAVE_MODEL, trial_timeout_s: 3480, caps: { path: join(root, "caps.json") }, runtime: { docker: { path: "/pinned/docker" }, image: `sha256:${"b".repeat(64)}` },
    trials: ["first", "second"].map(id => ({ id, case: "core-a", arm: "baseline", condition: "direct" })) }
  mkdirSync(wave.docker_config)
  writeFileSync(wave.caps.path, JSON.stringify({ estimate_run_usd: { [WAVE_MODEL]: { wide: 0.1 } } }))
  const file = join(root, "manifest.json")
  writeFileSync(file, JSON.stringify(wave))
  const x = containedFixture({ root, wave, file })
  // A clock whose every monotonic/wall read drifts by a fractional millisecond, exactly
  // the performance.now() race the real lease faces: whichever reading wins the sticky
  // max, the elapsed handed to the plan bounds is fractional.
  let reads = 0
  const timers = []
  const fractional = {
    monotonic: () => x.c.monotonic() + 0.461542 * ++reads,
    wall: () => x.c.wall() + 0.461542 * ++reads,
    set(fn, ms) { timers.push(ms); return x.c.set(fn, ms) },
    clear: key => x.c.clear(key),
  }
  const options = {
    env: { OPENCODE_API_KEY: "synthetic-test-key" }, identity: () => ({}),
    qualify: () => ({ execution_qualified: true, plan: { cases: [{ id: "core-a", set: "core", tier: "wide" }] } }),
    adapter: { supervisionAvailable: true, owned: x.owned, worker: () => assert.fail("host worker forbidden"), trial: () => assert.fail("host CLI forbidden"), signal: () => assert.fail("host signal forbidden") },
    clock: fractional,
    nativeQualification: () => Promise.resolve({ matched: true, identityOwner: fakeIdentityOwner(), profile: { os_profile: { platform: "darwin", arch: "arm64", version: "26.7.1", build: "25G241", sdk: "26.5" } } }),
    ownedCapability: () => x.owned,
  }
  const report = await drive(main(["--manifest", file], options), x.c)
  // The fractional path must admit and dispatch, not refuse pre-dispatch.
  assert.equal(x.descriptors.length, 1, "the fractional lease still dispatches one physical trial")
  assert.equal(existsSync(join(wave.control, "resources", "first.started.json")), true, "the journal started marker exists")
  assert.notEqual(report.trials[0].status, "unrun")
  assert.equal(report.execution_qualified, true)
  // The trial's own timeout timer (the only integer timer in the reserve-dominated
  // bound's magnitude range) observes the real floored bound: a safe integer that
  // never exceeds the trial_timeout_s cap. The composition's validator enforced the
  // same for cleanupMs (safe integer, never above the 120000 cap) or the dispatch
  // would have refused before this assertion. Other timers may stay fractional —
  // only the plan bounds are required to be safe integers.
  const trialTimeout = timers.find(ms => Number.isSafeInteger(ms) && ms >= 3000000)
  assert.ok(trialTimeout !== undefined, `a floored trial-timeout timer was set: ${JSON.stringify(timers)}`)
  assert.equal(trialTimeout <= wave.trial_timeout_s * 1000, true, "the bound never exceeds its cap")
  // The lease really was fractional during the run (a drifted snapshot timer shows it).
  assert.equal(timers.some(ms => !Number.isSafeInteger(ms)), true, "the injected fractional clock was in effect")
  // The worker's arithmetic, floored: a fractional elapsed (the reserve term wins the
  // min at the real-wave timeout cap) and a second fractional reading both produce
  // safe integers within their caps.
  const elapsed = 2462.461542
  const timeoutMs = Math.floor(Math.min(wave.trial_timeout_s * 1000, 3480000 - elapsed))
  assert.equal(timeoutMs, 3477537)
  assert.equal(Number.isSafeInteger(timeoutMs), true)
  assert.equal(timeoutMs <= wave.trial_timeout_s * 1000, true)
  const secondElapsed = 3462.461542
  const cleanupMs = Math.floor(Math.min(120000, 3600000 - secondElapsed - timeoutMs))
  assert.equal(cleanupMs, 119000)
  assert.equal(Number.isSafeInteger(cleanupMs), true)
  assert.equal(cleanupMs <= 120000, true)
  assert.equal(x.resources.size, 0)
  assert.equal(x.c.pending(), 0)
})
