import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOwnedCapability } from "../src/run/wave-owned-capability.mjs"
import { validateOwnedInputs } from "../src/run/owned-io.mjs"
import { createOwnedDockerProcess } from "../src/run/owned-docker-process.mjs"
import { createOwnedDockerClient } from "../src/run/owned-docker-client.mjs"
import { fakeIdentityOwner, containedFixture, drive } from "./support/wave-contained-parent.mjs"
import { processAdapter } from "../src/run/wave-process.mjs"
import { main } from "../scripts/run-mem-wave.mjs"

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex")
const CONTEXT = "colima-mem-evals-20261122"

// Canonical staged trees in the reviewed staging validator's exact shape, plus a staged arm tarball.
function stagingFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "wave-owned-capability-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const work = join(root, "work"), inputs = join(root, "inputs"), binaries = join(root, "binaries")
  mkdirSync(work); mkdirSync(binaries)
  for (const p of [inputs, join(inputs, "harness"), join(inputs, "arm"), join(inputs, "cases")]) mkdirSync(p)
  for (const name of ["caps.json", "models.json", "model-map.json", "conditions.json"]) writeFileSync(join(inputs, name), "{}")
  writeFileSync(join(inputs, "harness", "identity"), "synthetic harness")
  writeFileSync(join(inputs, "cases", "core-a.json"), "{}")
  const elf = Buffer.alloc(20); elf.write("\x7fELF"); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(183, 18)
  for (const name of ["node", "opencode"]) writeFileSync(join(binaries, name), elf, { mode: 0o700 })
  const archiveBytes = Buffer.from("synthetic staged arm tarball")
  const archivePath = join(root, "baseline.tgz")
  writeFileSync(archivePath, archiveBytes)
  return { root, work, inputs, binaries, archivePath, archiveBytes, archiveSha256: sha256(archiveBytes) }
}

const stagingPin = (work, inputs, binaries) => ({ work, inputs, binaries, architecture: "arm64", imageEnv: ["PATH=/usr/bin:/bin"], user: "1000:1000", allow: ["opencode.ai"] })

const waveFor = (f, { image = `sha256:${"b".repeat(64)}`, archive } = {}) => ({
  id: "cap", harness_sha: "a".repeat(40), staging: { ...stagingPin(f.work, f.inputs, f.binaries), image }, runtime: { image, docker: { path: "/pinned/docker" } },
  arms: { baseline: { directory: "/safe/baseline", archive: archive ?? { path: f.archivePath, sha256: f.archiveSha256 } } },
  trials: [{ id: "first", case: "core-a", arm: "baseline", condition: "direct" }],
})

const nativeMatched = () => ({ matched: true, identityOwner: fakeIdentityOwner(), profile: { os_profile: { platform: "darwin", arch: "arm64", version: "26.7.1", build: "25G241", sdk: "26.5" } } })
const requestFor = (wave, manifestSha = "c".repeat(64)) => ({ manifestSha, harnessSha: wave.harness_sha, trial: { ...wave.trials[0], status: "unrun", reason: "not-started" } })

test("the attestation records only verified staged facts and matches the staging validator's shape exactly", t => {
  const f = stagingFixture(t)
  const wave = waveFor(f)
  const capability = createOwnedCapability(wave, nativeMatched(), "c".repeat(64))
  assert.equal(typeof capability.snapshot, "function")
  assert.equal(typeof capability.spawn, "function")
  assert.ok(Object.isFrozen(capability))
  const snapshot = capability.snapshot(requestFor(wave))
  // The digests are recomputed at call time by the reviewed staging validator, not copied.
  const proof = validateOwnedInputs({ ...wave.staging, descriptor: { options: { condition: "direct" } } })
  assert.deepEqual(snapshot, {
    manifest_sha256: "c".repeat(64), harness_sha: wave.harness_sha, trial_id: "first",
    image: wave.runtime.image, work: f.work, inputs: f.inputs, binaries: f.binaries,
    architecture: "arm64", inputs_sha256: proof.inputs_sha256, binaries_sha256: proof.binaries_sha256,
    imageEnv: ["PATH=/usr/bin:/bin"], user: "1000:1000", allow: ["opencode.ai"],
  })
  assert.deepEqual(Object.keys(snapshot).sort(), ["allow", "architecture", "binaries", "binaries_sha256", "harness_sha", "image", "imageEnv", "inputs", "inputs_sha256", "manifest_sha256", "trial_id", "user", "work"].sort())
})

test("a tampered arm tarball, wrong image, forged request or broken staging refuses with closed reasons", t => {
  const f = stagingFixture(t)
  const manifestSha = "c".repeat(64)
  const refusals = [
    { reason: "arm-archive", mutate: () => writeFileSync(f.archivePath, Buffer.from("tampered tarball")), restore: () => writeFileSync(f.archivePath, f.archiveBytes) },
    { reason: "arm-archive", mutate: wave => { wave.arms.baseline.archive.sha256 = "0".repeat(64) } },
    { reason: "image", mutate: wave => { wave.staging.image = `sha256:${"d".repeat(64)}` } },
    { reason: "manifest", mutate: (wave, request) => { request.manifestSha = "0".repeat(64) } },
    { reason: "harness", mutate: (wave, request) => { request.harnessSha = "b".repeat(40) } },
    { reason: "trial", mutate: (wave, request) => { request.trial.id = "unknown" } },
    { reason: "staging", mutate: wave => { wave.staging.work = `${f.root}/..` } },
    { reason: "staging", mutate: wave => { delete wave.staging.allow } },
    { reason: "staging", mutate: wave => { wave.staging.architecture = "riscv" } },
    { reason: "staged-trees", mutate: wave => { wave.staging.work = `${f.root}/missing-work` } },
    { reason: "staged-trees", mutate: () => writeFileSync(join(f.inputs, "foreign.json"), "unapproved") },
    { reason: "staged-trees", mutate: () => writeFileSync(join(f.work, "not-fresh"), "occupied") },
  ]
  for (const { reason, mutate, restore } of refusals) {
    const wave = waveFor(f)
    const request = requestFor(wave, manifestSha)
    mutate(wave, request)
    const capability = createOwnedCapability(wave, nativeMatched(), manifestSha)
    assert.throws(() => capability.snapshot(request), new RegExp(`^Error: snapshot-unverified:${reason}$`), reason)
    restore?.()
  }
})

test("spawn composes the reviewed chain with the fixed context and credential shape, mutating no default context", async t => {
  const f = stagingFixture(t)
  const wave = waveFor(f)
  const captured = []
  const leaf = (file, args, options) => {
    captured.push({ file, args: [...args], env: { ...options.env }, shell: options.shell, detached: options.detached, stdio: [...options.stdio] })
    const child = new EventEmitter()
    child.pid = 701 + captured.length; child.exitCode = null; child.signalCode = null
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter()
    const settle = () => { child.emit("exit", 0, null); child.emit("close", 0, null) }
    child.stdin.end = (input, done) => { child.stdin.writableFinished = true; child.stdin.emit("finish"); queueMicrotask(settle); done?.() }
    child.kill = () => true
    queueMicrotask(() => child.emit("spawn"))
    if (options.stdio[0] !== "pipe") queueMicrotask(settle)
    return child
  }
  const capability = createOwnedCapability(wave, nativeMatched(), "c".repeat(64), { spawn: leaf })
  const timers = new Map(); let sequence = 0, now = 0
  const clock = { now: () => now, set(fn, ms) { timers.set(++sequence, fn); return sequence }, clear: key => timers.delete(key) }
  const config = "/parent/docker", id = "a".repeat(64)
  const plan = { context: CONTEXT, dockerConfig: config, binding: { invocation_id: "11111111-1111-4111-8111-111111111111", manifest_sha256: "b".repeat(64), trial_id: "case-a" },
    image: wave.runtime.image, imageEnv: ["PATH=/usr/bin:/bin"], user: "1000:1000", control: "/parent/control", store: "/parent/store", work: "/staged/work", inputs: "/staged/inputs", binaries: "/staged/bin",
    inputs_sha256: "d".repeat(64), binaries_sha256: "e".repeat(64), allow: ["opencode.ai"], credentialNames: ["OPENCODE_API_KEY"], timeoutMs: 1000, cleanupMs: 1000, operationMs: 100, outputBytes: 4096,
    descriptor: { options: { plugin: "mem", iteration: "trial-a", model: "opencode/deepseek-v4.1-flash#low", auth: "env:OPENCODE_API_KEY", cases: "case-a", casesDir: "/inputs/cases", set: "set-a", trials: 1, parallel: 1, arm: "/inputs/arm", world: "/inputs/harness/worlds/mem/index.mjs", host: "2.2.6", timeout: 1, stale: "refuse", tools: "locked", isolation: "owned-container", harnessRetries: 0, processGroup: "inherited", condition: "direct" } } }
  const transport = createOwnedDockerProcess({ binary: "/pinned/docker", config, context: CONTEXT, plan, credentialValues: { OPENCODE_API_KEY: "synthetic" } }, { spawn: capability.spawn, identityOwner: fakeIdentityOwner() })
  assert.equal(transport.qualified, false, "the transport itself never claims qualification")
  const client = createOwnedDockerClient({ binary: "/pinned/docker", config, context: CONTEXT, credentialValues: { OPENCODE_API_KEY: "synthetic" } }, { spawn: transport.spawn, clock })
  const dockerConfigBefore = process.env.DOCKER_CONFIG
  const inspected = client.run(["--context", CONTEXT, "inspect", id], { timeoutMs: 1000, maxBytes: 128 })
  for (let i = 0; i < 40; i++) await Promise.resolve()
  assert.deepEqual(captured.at(-1).args.slice(0, 2), ["--context", CONTEXT], "fixed approved context")
  assert.equal(captured.at(-1).file, "/pinned/docker")
  assert.deepEqual(captured.at(-1).env, { PATH: "/usr/bin:/bin", DOCKER_CONFIG: config }, "non-exec environment shape")
  assert.equal(captured.at(-1).shell, false)
  assert.equal(captured.at(-1).detached, false)
  assert.deepEqual(captured.at(-1).stdio, ["ignore", "pipe", "pipe"])
  assert.equal((await inspected).closed, true)
  // The exec command carries the exact inner environment plus the sole credential.
  const env = { PATH: "/opt/evals/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: "/work/home", TMPDIR: "/work/tmp", EVALS_TMP: "/work/tmp", EVALS_STORE: "/work/store", XDG_CONFIG_HOME: "/work/home/.config", XDG_DATA_HOME: "/work/xdg-data", XDG_STATE_HOME: "/work/xdg-state", XDG_CACHE_HOME: "/work/home/.cache", EVALS_CAPS: "/inputs/caps.json", EVALS_MODELS_CATALOG: "/inputs/models.json", EVALS_MODEL_MAP: "/inputs/model-map.json", EVALS_NODE: "/opt/evals/bin/node", EVALS_OPENCODE_BIN: "/opt/evals/bin/opencode", OPENCODE_BIN_2_2_6: "/opt/evals/bin/opencode", OPENCODE_PASSWORD: "f".repeat(48), HTTPS_PROXY: "http://egress:3128", HTTP_PROXY: "http://egress:3128", NO_PROXY: "127.0.0.1,localhost" }
  const descriptor = { ...plan.descriptor, schema: "oc-owned-launch/1", binding: plan.binding, container_id: id, context: CONTEXT, inputs_sha256: plan.inputs_sha256, binaries_sha256: plan.binaries_sha256 }
  const executed = client.run(["--context", CONTEXT, "exec", "-i", "-w", "/work", ...[...Object.keys(env), "OPENCODE_API_KEY"].flatMap(n => ["-e", n]), id, "/opt/evals/bin/node", "/inputs/harness/scripts/run-contained-trial.mjs"], { env, credentialNames: ["OPENCODE_API_KEY"], input: JSON.stringify(descriptor), timeoutMs: 1000, maxBytes: 128 })
  for (let i = 0; i < 100; i++) await Promise.resolve()
  assert.equal(captured.at(-1).env.OPENCODE_API_KEY, "synthetic", "OPENCODE_API_KEY-only credential shape")
  assert.equal(captured.at(-1).env.DOCKER_CONFIG, config)
  assert.deepEqual(captured.at(-1).args.slice(0, 2), ["--context", CONTEXT])
  assert.equal((await executed).closed, true)
  assert.equal(timers.size, 0, "no timer leaked")
  assert.equal(process.env.DOCKER_CONFIG, dockerConfigBefore, "no default context or configuration mutation")
  // The leaf refuses any foreign context prefix directly.
  assert.throws(() => capability.spawn("/pinned/docker", ["--context", "other", "inspect", id], { env: {}, shell: false, detached: false, stdio: ["ignore", "pipe", "pipe"] }), /^Error: owned-capability-spawn-refused$/)
  assert.equal(processAdapter().owned.snapshot, null, "the frozen adapter default stays byte-unchanged")
  assert.equal(processAdapter().owned.spawn, null)
})

test("an unmatched capability composition refuses to exist", t => {
  const f = stagingFixture(t)
  assert.throws(() => createOwnedCapability(waveFor(f), { matched: false, reason: "record-missing" }, "c".repeat(64)), /^Error: native dispatch refused: qualification binding absent$/)
  assert.throws(() => createOwnedCapability(waveFor(f), { matched: true }, "c".repeat(64)), /^Error: native dispatch refused: qualification binding absent$/)
})

function capabilityWave(t, f) {
  const root = mkdtempSync(join(tmpdir(), "capability-wave-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const wave = { id: "owned", harness_sha: "a".repeat(40), control: join(root, "control"), store: join(root, "store"), docker_config: join(root, "docker"),
    model: "opencode/deepseek-v4.1-flash#low", trial_timeout_s: 5, caps: { path: join(root, "caps.json") }, runtime: { docker: { path: "/pinned/docker" }, image: `sha256:${"b".repeat(64)}` },
    trials: ["first", "second"].map(id => ({ id, case: "core-a", arm: "baseline", condition: "direct" })),
    arms: { baseline: { directory: "/safe/baseline", archive: { path: f.archivePath, sha256: f.archiveSha256 } } },
    // The staging pin names the trees the contained fixture stages under this wave's own root.
    staging: { ...stagingPin(join(root, "work"), join(root, "inputs"), join(root, "binaries")), image: `sha256:${"b".repeat(64)}` } }
  mkdirSync(wave.docker_config)
  writeFileSync(wave.caps.path, JSON.stringify({ estimate_run_usd: { [wave.model]: { wide: 0.1 } } }))
  const file = join(root, "manifest.json")
  writeFileSync(file, JSON.stringify(wave))
  return { root, wave, file }
}

test("a matched binding supplies both capabilities and the composition admits through the existing wave-contained path", async t => {
  const f = stagingFixture(t)
  const scenario = capabilityWave(t, f)
  const x = containedFixture(scenario)
  let composed = 0
  const options = {
    env: { OPENCODE_API_KEY: "synthetic-test-key" }, identity: () => ({}),
    qualify: () => ({ execution_qualified: true, plan: { cases: [{ id: "core-a", set: "core", tier: "wide" }] } }),
    adapter: processAdapter({ spawn: () => assert.fail("the adapter default must not be the dispatch path") }),
    clock: x.c,
    nativeQualification: () => { composed++; return Promise.resolve(nativeMatched()) },
    // The real capability supplies snapshot and spawn; the fixture's disk/io stand-ins ride
    // along exactly as they do for every composition test in the contained suite.
    ownedCapability: (wave, native, manifestSha) => ({ ...createOwnedCapability(wave, native, manifestSha, { spawn: x.owned.spawn }), measure: x.owned.measure, io: x.owned.io }),
  }
  const report = await drive(main(["--manifest", scenario.file], options), x.c)
  assert.equal(composed, 1, "the run script composes the capability exactly once, only on a match")
  assert.equal(report.execution_qualified, true)
  assert.equal(report.native_qualification.matched, true)
  assert.equal(x.descriptors.length, 1, "the composition admitted one physical trial end to end")
  assert.equal(x.journal().owner.trial_id, "first")
  assert.equal(x.descriptors[0].binding.manifest_sha256, sha256(readFileSync(scenario.file)), "the real attestation fed the plan")
  assert.equal(x.resources.size, 0)
  assert.equal(x.finalReads.length > 0, true)
  assert.equal(report.trials[1].status, "unrun")
  assert.equal(x.c.pending(), 0)
  const progress = JSON.parse(readFileSync(join(scenario.wave.control, "progress.json"), "utf8"))
  assert.equal(progress.execution_qualified, true)
  assert.equal(existsSync(join(scenario.wave.control, "wave.lock")), true)
})

test("an unmatched binding composes no capability and the frozen default refuses as today", async t => {
  const f = stagingFixture(t)
  const scenario = capabilityWave(t, f)
  const options = {
    env: { OPENCODE_API_KEY: "synthetic-test-key" }, identity: () => ({}),
    qualify: () => ({ execution_qualified: true, plan: { cases: [{ id: "core-a", set: "core", tier: "wide" }] } }),
    adapter: processAdapter({ spawn: () => assert.fail("unqualified native spawn forbidden") }),
    clock: { monotonic: () => 0, wall: () => 0, sleep: () => assert.fail("no supervision without dispatch"), set: () => assert.fail(), clear: () => assert.fail() },
    nativeQualification: () => Promise.resolve({ matched: false, reason: "record-missing" }),
    ownedCapability: () => { throw new Error("capability composed without a matched binding") },
  }
  const report = await main(["--manifest", scenario.file], options)
  assert.equal(report.complete, false)
  assert.equal(report.stop_reason, "qualification-failed")
  assert.equal(report.execution_qualified, false)
  assert.equal(report.successor_allowed, false)
  assert.equal(existsSync(join(scenario.wave.control, "wave.lock")), false)
  assert.equal(existsSync(join(scenario.wave.control, "progress.json")), false)
})
