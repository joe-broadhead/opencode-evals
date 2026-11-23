// Regression for dispatch BLOCKER 3: docker daemon 29.5.2 refuses to START any
// container with the local log driver's default compression and a single log file
// ("compression cannot be enabled when max file count is 1"). The reviewed create
// args must disable compression explicitly; the closed transport grammar and the
// containment spec must stay in lockstep. Offline fakes never execute docker start,
// which is why the live-only refusal reached the dispatch worker first.
import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { main } from "../scripts/run-mem-wave.mjs"
import { WAVE_MODEL } from "../src/run/wave-manifest.mjs"
import { containedFixture, drive, fakeIdentityOwner } from "./support/wave-contained-parent.mjs"
import { createOwnedDockerProcess } from "../src/run/owned-docker-process.mjs"

const CONTEXT = "colima-mem-evals-20261122"

test("the container create args disable local-log compression, and the transport grammar accepts the exact same args", async t => {
  const root = mkdtempSync(join(tmpdir(), "owned-logdriver-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const wave = { id: "owned", harness_sha: "a".repeat(40), control: join(root, "control"), store: join(root, "store"), docker_config: join(root, "docker"),
    model: WAVE_MODEL, trial_timeout_s: 3480, caps: { path: join(root, "caps.json") }, runtime: { docker: { path: "/pinned/docker" }, image: `sha256:${"b".repeat(64)}` },
    trials: ["first", "second"].map(id => ({ id, case: "core-a", arm: "baseline", condition: "direct" })) }
  mkdirSync(wave.docker_config)
  writeFileSync(wave.caps.path, JSON.stringify({ estimate_run_usd: { [WAVE_MODEL]: { wide: 0.1 } } }))
  const file = join(root, "manifest.json")
  writeFileSync(file, JSON.stringify(wave))
  const x = containedFixture({ root, wave, file })
  const options = {
    env: { OPENCODE_API_KEY: "synthetic-test-key" }, identity: () => ({}),
    qualify: () => ({ execution_qualified: true, plan: { cases: [{ id: "core-a", set: "core", tier: "wide" }] } }),
    adapter: { supervisionAvailable: true, owned: x.owned, worker: () => assert.fail("host worker forbidden"), trial: () => assert.fail("host CLI forbidden"), signal: () => assert.fail("host signal forbidden") },
    clock: x.c,
    nativeQualification: () => Promise.resolve({ matched: true, identityOwner: fakeIdentityOwner(), profile: { os_profile: { platform: "darwin", arch: "arm64", version: "26.7.1", build: "25G241", sdk: "26.5" } } }),
    ownedCapability: () => x.owned,
  }
  const report = await drive(main(["--manifest", file], options), x.c)
  assert.equal(x.descriptors.length, 1, "the trial dispatched end to end")
  assert.equal(report.execution_qualified, true)
  // The real makeContainer output: every container create (proxy and workload) carries
  // compress=false grouped with the other log options, keeping the single-file local log.
  const creates = x.calls.filter(a => a[0] === "create")
  assert.equal(creates.length, 2, "one proxy and one workload create")
  for (const call of creates) {
    const at = call.indexOf("compress=false")
    assert.ok(at > 0, `compress=false is present: ${JSON.stringify(call.slice(0, 20))}`)
    assert.equal(call[at - 1], "--log-opt", "compress=false is a log option")
    assert.equal(call.includes("max-size=1m") && call.includes("max-file=1"), true, "the size and single-file limits are unchanged")
  }
  // Lockstep: the closed transport grammar validates the exact same recorded args for
  // both roles. A spec/grammar drift would throw owned-docker-process-refused here.
  const invocation = x.journal().owner.invocation_id
  for (const call of creates) {
    const plan = { context: CONTEXT, dockerConfig: wave.docker_config, binding: { invocation_id: invocation, manifest_sha256: "b".repeat(64), trial_id: "first" },
      image: wave.runtime.image, imageEnv: ["PATH=/usr/bin:/bin"], user: "1000:1000", control: wave.control, store: wave.store,
      work: x.work, inputs: join(root, "inputs"), binaries: join(root, "binaries"),
      inputs_sha256: "d".repeat(64), binaries_sha256: "e".repeat(64), allow: ["opencode.ai"], credentialNames: ["OPENCODE_API_KEY"],
      timeoutMs: 1000, cleanupMs: 1000, operationMs: 100, outputBytes: 4096,
      descriptor: { options: { plugin: "mem", iteration: "trial-a", model: WAVE_MODEL, auth: "env:OPENCODE_API_KEY", cases: "core-a", casesDir: "/inputs/cases", set: "set-a", trials: 1, parallel: 1, arm: "/inputs/arm", world: "/inputs/harness/worlds/mem/index.mjs", host: "2.2.6", timeout: 1, stale: "refuse", tools: "locked", isolation: "owned-container", harnessRetries: 0, processGroup: "inherited", condition: "direct" } } }
    const leaf = (file2, args, opts) => {
      const child = new EventEmitter()
      child.pid = 900; child.exitCode = null; child.signalCode = null
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      queueMicrotask(() => { child.emit("exit", 0, null); child.emit("close", 0, null) })
      return child
    }
    const transport = createOwnedDockerProcess({ binary: "/pinned/docker", config: wave.docker_config, context: CONTEXT, plan, credentialValues: { OPENCODE_API_KEY: "synthetic" } }, { spawn: leaf, identityOwner: fakeIdentityOwner() })
    // The grammar's create validation runs for real inside spawn; a mismatch refuses.
    transport.spawn("/pinned/docker", ["--context", CONTEXT, ...call], { env: { PATH: "/usr/bin:/bin", DOCKER_CONFIG: wave.docker_config }, shell: false, detached: false, stdio: ["ignore", "pipe", "pipe"] })
    await new Promise(resolve => { setImmediate(resolve) })
  }
  // The dispatch's config verification passed with the compress:false LogConfig the
  // fixture derives from these args (the flow reached the exec), so every existing
  // verifyOwnedConfig check is unchanged and green.
  assert.equal(x.journal().verified_gone, true)
  assert.equal(x.resources.size, 0)
  assert.equal(x.c.pending(), 0)
})
