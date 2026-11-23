import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bindNativeQualification, darwinSystemProfile } from "../src/run/native-qualification.mjs"
import { validateNativeQualificationRecord, qualifyWave, completeTrials, validateWave } from "../src/run/wave-manifest.mjs"
import { createWarmedDarwinIdentityReader } from "./fixtures/warmed-darwin-identity.mjs"
import { main } from "../scripts/run-mem-wave.mjs"
import { containedFixture, drive, fakeIdentityOwner } from "./support/wave-contained-parent.mjs"
import { processAdapter } from "../src/run/wave-process.mjs"

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex")
const gitBlob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")

// Synthetic owner-supplied record fixture: canonical files on a real filesystem, never a helper.
function recordFixture() {
  const root = mkdtempSync(join(tmpdir(), "native-qualification-"))
  const nodeBytes = Buffer.from("synthetic-parent-node-binary")
  const nodePath = join(root, "parent-node")
  writeFileSync(nodePath, nodeBytes, { mode: 0o755 })
  const ownerDir = join(root, "owner")
  mkdirSync(ownerDir, { mode: 0o700 })
  const helperBytes = Buffer.alloc(96, 9)
  const helperPath = join(ownerDir, "identity")
  writeFileSync(helperPath, helperBytes, { mode: 0o555 })
  const evidenceBytes = Buffer.from("READ-ONLY NATIVE QUALIFICATION — synthetic evidence\n")
  const evidencePath = join(root, "qual-report.md")
  writeFileSync(evidencePath, evidenceBytes)
  const sourceBytes = Buffer.from("// synthetic darwin identity source for binding tests\n")
  const sourcePath = join(root, "darwin-process-identity.c")
  writeFileSync(sourcePath, sourceBytes)
  const record = {
    schema: "oc-mem-native-qualification/1",
    os_profile: { platform: "darwin", arch: "arm64", version: "26.7.1", build: "25G241", sdk: "26.5" },
    node: { path: nodePath, version: "v22.23.2", sha256: sha256(nodeBytes), mode: "0755" },
    helper: { source_blob: gitBlob(sourceBytes), build_manifest_sha256: "b".repeat(64), binary: { path: helperPath, sha256: sha256(helperBytes), size: helperBytes.length, mode: "0555" } },
    budgets: { warmup_ms: 1000, lookup_ms: 100, cleanup_ms: 100 },
    evidence: { path: evidencePath, sha256: sha256(evidenceBytes) },
    qualified_scope: "read-only Darwin identity reader/lifetime: construction warm-up, single-attempt gate, warm lookups within the pinned budgets, QMAC1 grammar/PID/tuple stability, ownership accounting, natural exits; no Docker transport, no-helper behavior, descendants, or signal safety.",
  }
  return { root, record, nodeBytes, nodePath, helperBytes, helperPath, evidencePath, evidenceBytes, sourceBytes, sourcePath, ownerDir }
}

const pinnedWriters = new WeakMap()
function writePinnedBytes(f, record) {
  let entry = pinnedWriters.get(f)
  if (!entry) pinnedWriters.set(f, entry = { n: 0 })
  const path = join(f.root, `record-${++entry.n}.json`)
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
  writeFileSync(path, bytes)
  return { path, sha256: sha256(bytes) }
}

// A fake live profile with an observed reader factory: the real binding logic, fake native world.
function liveWorld(f, { spawn, createReader } = {}) {
  const constructions = []
  const wrapReader = createReader ?? ((pins, deps) => {
    constructions.push({ pins, deps })
    return createWarmedDarwinIdentityReader(pins, { ...deps, spawn })
  })
  return {
    constructions,
    deps: {
      runId: "wave-test", sourcePath: f.sourcePath,
      platform: "darwin", arch: "arm64", nodeVersion: "v22.23.2", execPath: f.nodePath,
      systemProfile: () => ({ version: "26.7.1", build: "25G241", sdk: "26.5" }),
      createReader: wrapReader,
    },
  }
}

const helperSpawn = () => (file, args) => {
  const child = new EventEmitter()
  child.pid = 901
  child.stdout = new EventEmitter()
  queueMicrotask(() => {
    if (args[0] === "0") { child.emit("exit", 64, null); child.emit("close", 64, null); return }
    child.stdout.emit("data", Buffer.from(`QMAC1 ${args[0]} 123 000456\n`))
    child.emit("exit", 0, null)
    child.emit("close", 0, null)
  })
  return child
}

const waveFor = pin => ({ native_qualification: pin, arms: { baseline: { directory: "/safe/baseline" }, candidate: { directory: "/safe/candidate" } } })

test("exact live-profile match constructs the reviewed reader and reports the matched profile for that run", async t => {
  const f = recordFixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const pin = writePinnedBytes(f, f.record)
  const world = liveWorld(f, { spawn: helperSpawn() })
  const result = await bindNativeQualification(waveFor(pin), world.deps)
  assert.equal(result.matched, true)
  assert.equal(world.constructions.length, 1)
  assert.equal(typeof result.identityOwner.readIdentity, "function")
  assert.equal(result.identityOwner.available(), true)
  assert.deepEqual(result.profile, {
    os_profile: { platform: "darwin", arch: "arm64", version: "26.7.1", build: "25G241", sdk: "26.5" },
    node: { version: "v22.23.2", sha256: sha256(f.nodeBytes), mode: "0755" },
    helper: { sha256: sha256(f.helperBytes), size: f.helperBytes.length, mode: "0555" },
    budgets: { warmup_ms: 1000, lookup_ms: 100, cleanup_ms: 100 },
    evidence: { sha256: sha256(f.evidenceBytes) },
    qualified_scope: f.record.qualified_scope,
  })
  // The constructed reader pins bind the record's evidence and this run's deployment facts.
  const pins = world.constructions[0].pins
  assert.equal(pins.schema, "qmac-owner/1")
  assert.equal(pins.platform, "darwin")
  assert.equal(pins.arch, "arm64")
  assert.equal(pins.runId, "wave-test")
  assert.equal(pins.cwd, f.ownerDir)
  assert.deepEqual(pins.helper, { path: f.helperPath, sha256: sha256(f.helperBytes), size: f.helperBytes.length, mode: 0o555, arch: "arm64" })
  assert.equal(pins.sourceSha256, sha256(f.sourceBytes))
  assert.equal(pins.buildManifestSha256, f.record.helper.build_manifest_sha256)
  assert.equal(pins.platformProfileSha256, sha256(Buffer.from(JSON.stringify({ platform: "darwin", arch: "arm64", version: "26.7.1", build: "25G241", sdk: "26.5" }))))
  assert.equal(pins.nodeSha256, sha256(f.nodeBytes))
  assert.equal(pins.lookupMs, 100)
  assert.equal(pins.cleanupMs, 100)
})

test("missing record refuses with zero native construction", async t => {
  const f = recordFixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  for (const wave of [waveFor(undefined), waveFor(null), {}]) {
    const world = liveWorld(f, { spawn: helperSpawn() })
    const result = await bindNativeQualification(wave, world.deps)
    assert.deepEqual(result, { matched: false, reason: "record-missing" })
    assert.equal(world.constructions.length, 0)
  }
})

test("record pins refuse unreadable files and their own digest mismatches", async t => {
  const f = recordFixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const pin = writePinnedBytes(f, f.record)
  const world = liveWorld(f, { spawn: helperSpawn() })
  assert.deepEqual(await bindNativeQualification(waveFor({ path: pin.path, sha256: "0".repeat(64) }), world.deps), { matched: false, reason: "record-hash-mismatch" })
  assert.deepEqual(await bindNativeQualification(waveFor({ path: join(f.root, "absent.json"), sha256: pin.sha256 }), world.deps), { matched: false, reason: "record-unreadable" })
  assert.deepEqual(await bindNativeQualification(waveFor({ path: `${f.root}/../record-1.json`, sha256: pin.sha256 }), world.deps), { matched: false, reason: "record-unreadable" })
  assert.deepEqual(await bindNativeQualification(waveFor({ path: f.root, sha256: pin.sha256 }), world.deps), { matched: false, reason: "record-unreadable" })
  assert.deepEqual(await bindNativeQualification(waveFor({ sha256: pin.sha256 }), world.deps), { matched: false, reason: "record-unreadable" })
  assert.equal(world.constructions.length, 0)
})

test("record field validation refuses every malformed shape without native construction", async t => {
  const f = recordFixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const world = liveWorld(f, { spawn: helperSpawn() })
  const mutations = [
    ["schema", r => { r.schema = "oc-mem-native-qualification/2" }],
    ["extra field", r => { r.extra = true }],
    ["missing scope", r => { delete r.qualified_scope }],
    ["empty scope", r => { r.qualified_scope = " " }],
    ["os platform", r => { r.os_profile.platform = "linux" }],
    ["os build", r => { r.os_profile.build = "25g241" }],
    ["os version", r => { r.os_profile.version = "26.7.x" }],
    ["os sdk", r => { r.os_profile.sdk = "26.x" }],
    ["os arch", r => { r.os_profile.arch = "riscv" }],
    ["os extra field", r => { r.os_profile.extra = 1 }],
    ["node path", r => { r.node.path = "relative-node" }],
    ["node version", r => { r.node.version = "22.23.2" }],
    ["node mode", r => { r.node.mode = "0750" }],
    ["node sha", r => { r.node.sha256 = "g".repeat(64) }],
    ["source blob", r => { r.helper.source_blob = "g".repeat(40) }],
    ["build manifest", r => { r.helper.build_manifest_sha256 = "short" }],
    ["binary path", r => { r.helper.binary.path = "relative-identity" }],
    ["binary mode", r => { r.helper.binary.mode = "0755" }],
    ["binary size", r => { r.helper.binary.size = 0 }],
    ["binary sha", r => { r.helper.binary.sha256 = "z".repeat(64) }],
    ["warmup budget", r => { r.budgets.warmup_ms = 999 }],
    ["lookup budget", r => { r.budgets.lookup_ms = 200 }],
    ["cleanup budget", r => { r.budgets.cleanup_ms = 200 }],
    ["budget extra", r => { r.budgets.extra = 1 }],
    ["evidence path", r => { r.evidence.path = "relative.md" }],
    ["evidence sha", r => { r.evidence.sha256 = 5 }],
  ]
  for (const [label, mutate] of mutations) {
    const record = structuredClone(f.record)
    mutate(record)
    const result = await bindNativeQualification(waveFor(writePinnedBytes(f, record)), world.deps)
    assert.deepEqual(result, { matched: false, reason: "record-invalid" }, label)
  }
  const malformed = join(f.root, "malformed.json")
  writeFileSync(malformed, "{not json")
  const bytes = readFileSync(malformed)
  assert.deepEqual(await bindNativeQualification(waveFor({ path: malformed, sha256: sha256(bytes) }), world.deps), { matched: false, reason: "record-invalid" })
  assert.equal(world.constructions.length, 0)
})

test("a record inside a compared package refuses", async t => {
  const f = recordFixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const pin = writePinnedBytes(f, f.record)
  const world = liveWorld(f, { spawn: helperSpawn() })
  for (const arm of ["baseline", "candidate"]) {
    const wave = waveFor(pin)
    wave.arms[arm].directory = f.root
    assert.deepEqual(await bindNativeQualification(wave, world.deps), { matched: false, reason: "record-in-compared-package" })
  }
  assert.equal(world.constructions.length, 0)
})

test("live OS profile mismatches refuse: platform, arch, version, build and SDK each fail", async t => {
  const f = recordFixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const pin = writePinnedBytes(f, f.record)
  const mismatch = overrides => {
    const world = liveWorld(f, { spawn: helperSpawn() })
    return { world, promise: bindNativeQualification(waveFor(pin), { ...world.deps, ...overrides }) }
  }
  for (const overrides of [{ platform: "linux" }, { arch: "x64" },
    { systemProfile: () => ({ version: "26.7.2", build: "25G241", sdk: "26.5" }) },
    { systemProfile: () => ({ version: "26.7.1", build: "25G242", sdk: "26.5" }) },
    { systemProfile: () => ({ version: "26.7.1", build: "25G241", sdk: "26.4" }) },
    { systemProfile: () => ({ version: null, build: "25G241", sdk: "26.5" }) }]) {
    const { world, promise } = mismatch(overrides)
    assert.deepEqual(await promise, { matched: false, reason: "os-profile-mismatch" })
    assert.equal(world.constructions.length, 0)
  }
})

test("parent Node path, version, mode and bytes each refuse", async t => {
  const f = recordFixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const pin = writePinnedBytes(f, f.record)
  const bind = async overrides => {
    const world = liveWorld(f, { spawn: helperSpawn() })
    return { world, result: await bindNativeQualification(waveFor(pin), { ...world.deps, ...overrides }) }
  }
  let bound = await bind({ execPath: join(f.root, "owner") })
  assert.deepEqual(bound.result, { matched: false, reason: "node-mismatch" })
  bound = await bind({ nodeVersion: "v22.23.3" })
  assert.deepEqual(bound.result, { matched: false, reason: "node-mismatch" })
  chmodSync(f.nodePath, 0o700)
  bound = await bind({})
  assert.deepEqual(bound.result, { matched: false, reason: "node-mismatch" }, "live mode must be 0755")
  chmodSync(f.nodePath, 0o755)
  const changed = Buffer.from("changed parent node bytes")
  writeFileSync(f.nodePath, changed)
  bound = await bind({})
  assert.deepEqual(bound.result, { matched: false, reason: "node-mismatch" }, "record hash still pins the original bytes")
  // A record repinned to the changed live bytes matches: validation compares the record to the live profile.
  const record = structuredClone(f.record)
  record.node.sha256 = sha256(changed)
  const world = liveWorld(f, { spawn: helperSpawn() })
  const repinned = await bindNativeQualification(waveFor(writePinnedBytes(f, record)), world.deps)
  assert.equal(repinned.matched, true)
  assert.equal(world.constructions.length, 1)
  writeFileSync(f.nodePath, f.nodeBytes)
})

test("helper source blob, deployed bytes, size, mode and cwd each refuse", async t => {
  const f = recordFixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const pin = writePinnedBytes(f, f.record)
  const worlds = []
  const fresh = () => { const world = liveWorld(f, { spawn: helperSpawn() }); worlds.push(world); return world }
  // Deployed helper bytes (the 0555 asset is owner-protected; rewrite through 0644).
  chmodSync(f.helperPath, 0o644)
  writeFileSync(f.helperPath, Buffer.alloc(96, 8))
  chmodSync(f.helperPath, 0o555)
  assert.deepEqual(await bindNativeQualification(waveFor(pin), fresh().deps), { matched: false, reason: "helper-mismatch" })
  chmodSync(f.helperPath, 0o644)
  writeFileSync(f.helperPath, f.helperBytes)
  chmodSync(f.helperPath, 0o555)
  // Deployed helper mode.
  chmodSync(f.helperPath, 0o755)
  assert.deepEqual(await bindNativeQualification(waveFor(pin), fresh().deps), { matched: false, reason: "helper-mismatch" })
  chmodSync(f.helperPath, 0o555)
  // Deployed size disagrees with the record.
  const shorter = structuredClone(f.record)
  shorter.helper.binary.size = 95
  assert.deepEqual(await bindNativeQualification(waveFor(writePinnedBytes(f, shorter)), fresh().deps), { matched: false, reason: "helper-mismatch" })
  // Deployed cwd mode.
  chmodSync(f.ownerDir, 0o755)
  assert.deepEqual(await bindNativeQualification(waveFor(pin), fresh().deps), { matched: false, reason: "helper-mismatch" })
  chmodSync(f.ownerDir, 0o700)
  // The harness source blob binds the record's qualified source.
  const changedSource = Buffer.from("// changed harness source\n")
  writeFileSync(f.sourcePath, changedSource)
  assert.deepEqual(await bindNativeQualification(waveFor(pin), fresh().deps), { matched: false, reason: "source-mismatch" })
  writeFileSync(f.sourcePath, f.sourceBytes)
  const ok = await bindNativeQualification(waveFor(pin), fresh().deps)
  assert.equal(ok.matched, true, "restoring the live profile re-opens admission for a new run")
  assert.equal(worlds.flatMap(w => w.constructions).length, 1, "only the matched run constructed a reader")
})

test("qualification evidence reference mismatch refuses", async t => {
  const f = recordFixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const pin = writePinnedBytes(f, f.record)
  const world = liveWorld(f, { spawn: helperSpawn() })
  const staleEvidence = structuredClone(f.record)
  staleEvidence.evidence.sha256 = sha256(Buffer.from("different report"))
  assert.deepEqual(await bindNativeQualification(waveFor(writePinnedBytes(f, staleEvidence)), world.deps), { matched: false, reason: "evidence-mismatch" })
  writeFileSync(f.evidencePath, Buffer.from("changed on disk\n"))
  assert.deepEqual(await bindNativeQualification(waveFor(pin), world.deps), { matched: false, reason: "evidence-mismatch" })
  assert.equal(world.constructions.length, 0)
})

test("failed construction warm-up refuses dispatch and reports no match", async t => {
  const f = recordFixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const pin = writePinnedBytes(f, f.record)
  let warmupExecs = 0
  const failingWarmup = () => (file, args) => {
    warmupExecs++
    const child = new EventEmitter()
    child.pid = 901
    child.stdout = new EventEmitter()
    queueMicrotask(() => { child.emit("exit", 1, null); child.emit("close", 1, null) })
    return child
  }
  // The real reviewed reader with a fake refused-operand helper: construction happens, warm-up fails.
  const result = await bindNativeQualification(waveFor(pin), {
    runId: "wave-test", sourcePath: f.sourcePath,
    platform: "darwin", arch: "arm64", nodeVersion: "v22.23.2", execPath: f.nodePath,
    systemProfile: () => ({ version: "26.7.1", build: "25G241", sdk: "26.5" }),
    spawn: failingWarmup(),
  })
  assert.deepEqual(result, { matched: false, reason: "warmup-failed" })
  assert.equal(warmupExecs, 1, "the refused warm-up used exactly one construction")
})

test("a ready()-throwing owner seam fails closed: no match, zero dispatch, admission closed", async t => {
  const f = recordFixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const pin = writePinnedBytes(f, f.record)
  let constructions = 0
  // The adapter's identityOwner contract has no ready() method; a seam owner that throws
  // from it must fail closed through the binding's own refusal, not crash the dispatch.
  const throwingOwner = () => {
    constructions++
    return Object.freeze({ register: () => true, readIdentity: () => null, reconcile: () => Promise.resolve(true), stop: () => Promise.resolve(true), closed: () => true, available: () => false, ready() { throw Error("synthetic owner seam failure") } })
  }
  const binding = async (wave, context) => bindNativeQualification(wave, {
    runId: context?.runId ?? "wave-test", sourcePath: f.sourcePath,
    platform: "darwin", arch: "arm64", nodeVersion: "v22.23.2", execPath: f.nodePath,
    systemProfile: () => ({ version: "26.7.1", build: "25G241", sdk: "26.5" }),
    createReader: throwingOwner,
  })
  assert.deepEqual(await binding(waveFor(pin)), { matched: false, reason: "warmup-failed" })
  assert.equal(constructions, 1, "the seam owner was constructed once, then refused")
  // Zero dispatch and admission closed at the run level: the refused binding never journals.
  const scenario = ownedWave(t, { record: pin })
  const options = {
    env: { OPENCODE_API_KEY: "synthetic-test-key" }, identity: () => ({}),
    qualify: () => ({ execution_qualified: true, plan: { cases: [{ id: "core-a", set: "core", tier: "wide" }] } }),
    adapter: { supervisionAvailable: true, owned: { snapshot: () => assert.fail("no dispatch after a refused seam"), spawn: () => assert.fail("no spawn after a refused seam") } },
    clock: { monotonic: () => 0, wall: () => 0, set: () => assert.fail(), clear: () => assert.fail() },
    nativeQualification: binding,
  }
  const report = await main(["--manifest", scenario.file], options)
  assert.equal(report.execution_qualified, false)
  assert.equal(report.stop_reason, "qualification-failed")
  assert.equal(existsSync(join(scenario.wave.control, "wave.lock")), false, "admission closed")
  assert.equal(existsSync(join(scenario.wave.control, "progress.json")), false, "zero dispatch")
})

test("each call binds a fresh run: no cross-run caching of qualification", async t => {
  const f = recordFixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const pin = writePinnedBytes(f, f.record)
  const world = liveWorld(f, { spawn: helperSpawn() })
  const first = await bindNativeQualification(waveFor(pin), world.deps)
  const second = await bindNativeQualification(waveFor(pin), world.deps)
  assert.equal(first.matched, true)
  assert.equal(second.matched, true)
  assert.notEqual(first.identityOwner, second.identityOwner, "each run constructs its own reader")
  assert.equal(world.constructions.length, 2)
  // A later run with changed live helper bytes refuses even though an earlier run matched.
  chmodSync(f.helperPath, 0o644)
  writeFileSync(f.helperPath, Buffer.alloc(96, 7))
  chmodSync(f.helperPath, 0o555)
  const third = await bindNativeQualification(waveFor(pin), world.deps)
  assert.deepEqual(third, { matched: false, reason: "helper-mismatch" })
  assert.equal(first.identityOwner.available(), true, "the earlier run's owner is untouched, never reused")
})

test("record structure validation is pure and shared with wave admission", () => {
  const f = recordFixture()
  assert.equal(validateNativeQualificationRecord(f.record), f.record)
  for (const mutate of [r => { r.schema = "other/1" }, r => { delete r.budgets }, r => { r.helper.binary.mode = "0755" }, r => { r.os_profile.arch = "riscv" }]) {
    const record = structuredClone(f.record)
    mutate(record)
    assert.throws(() => validateNativeQualificationRecord(record), /required$/)
  }
  assert.equal(typeof darwinSystemProfile, "function", "the live profile reader stays a named, injectable seam")
})

test("wave admission validates the pinned record without ever setting execution_qualified", t => {
  const f = recordFixture()
  const nodeBytes = Buffer.from("fake Linux Node")
  const nodePath = join(f.root, "runtime-node")
  writeFileSync(nodePath, nodeBytes, { mode: 0o700 })
  const pin = (name, data) => {
    const bytes = JSON.stringify(data)
    const path = join(f.root, name)
    writeFileSync(path, bytes)
    return { path, sha256: sha256(Buffer.from(bytes)) }
  }
  const plan = { schema: "oc-mem-wave-plan/1", cases: [{ id: "case-a", conditions: ["direct", "search"], file: pin("case-a.json", { id: "case-a", sets: ["tune"] }), set: "tune" }] }
  const base = {
    schema: "oc-mem-wave/1", id: "test-wave", model: "opencode/deepseek-v4.1-flash#low", target_usd: 10, total_ms: 3600000, cleanup_ms: 120000,
    docker_context: "colima-mem-evals-20261122", harness_sha: "a".repeat(40), plan: pin("plan.json", plan), trials: completeTrials(plan),
    control: f.root, store: join(f.root, "store"), cases_dir: f.root, docker_config: f.root, trial_timeout_s: 420,
    runtime: { version: "2.2.6", opencode: pin("opencode", "fake"), node: pin("rnode", "n"), docker: pin("rdocker", "d"), launcher_node: { path: nodePath, sha256: sha256(nodeBytes) }, image: `sha256:${"d".repeat(64)}` },
  }
  for (const key of ["opencode", "node", "docker"]) chmodSync(base.runtime[key].path, 0o700)
  const identity = { harnessSha: base.harness_sha, launcherNodeSha: sha256(nodeBytes) }
  const verify = () => qualifyWave(base, identity)
  // Without a record pin the manifest is unaffected; qualification stays false as before.
  assert.equal(validateWave(base, identity).wave, base)
  // A valid record pin passes its own gate and fails later on the still-missing inputs.
  base.native_qualification = writePinnedBytes(f, f.record)
  assert.throws(verify, /file pin and SHA-256 required/, "the record gate passed; later inputs remain required")
  // The pin itself must be a canonical absolute path with its own SHA-256.
  assert.throws(() => qualifyWave({ ...base, native_qualification: { path: `${f.root}/../record.json`, sha256: base.native_qualification.sha256 } }, identity), /native qualification record pin required/)
  assert.throws(() => qualifyWave({ ...base, native_qualification: { path: f.root, sha256: base.native_qualification.sha256 } }, identity), /canonical regular file/)
  // The record's own digest must match its bytes.
  assert.throws(() => qualifyWave({ ...base, native_qualification: { ...base.native_qualification, sha256: "0".repeat(64) } }, identity), /digest mismatch/)
  // A malformed record refuses admission at its own parse.
  const malformed = join(f.root, "malformed.json")
  writeFileSync(malformed, "{bad")
  assert.throws(() => qualifyWave({ ...base, native_qualification: { path: malformed, sha256: sha256(readFileSync(malformed)) } }, identity), /SyntaxError/)
  // A record inside a compared package refuses admission.
  const inside = { ...base, arms: { baseline: { directory: f.root } } }
  assert.throws(() => qualifyWave(inside, identity), /outside compared packages/)
  // A manifest boolean can never replace the record: the same valid pin still only passes its own gate.
  delete inside.arms
  assert.throws(() => qualifyWave({ ...inside, execution_qualified: true }, identity), /file pin and SHA-256 required/)
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
})

function ownedWave(t, { record } = {}) {
  const root = mkdtempSync(join(tmpdir(), "native-qualification-wave-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const wave = { id: "owned", harness_sha: "a".repeat(40), control: join(root, "control"), store: join(root, "store"), docker_config: join(root, "docker"),
    model: "opencode/deepseek-v4.1-flash#low", trial_timeout_s: 5, caps: { path: join(root, "caps.json") }, runtime: { docker: { path: "/pinned/docker" }, image: `sha256:${"b".repeat(64)}` },
    trials: ["first", "second"].map(id => ({ id, case: "core-a", arm: "baseline", condition: "direct" })) }
  mkdirSync(wave.docker_config)
  writeFileSync(wave.caps.path, JSON.stringify({ estimate_run_usd: { [wave.model]: { wide: 0.1 } } }))
  if (record) wave.native_qualification = record
  const file = join(root, "manifest.json")
  writeFileSync(file, JSON.stringify(wave))
  return { root, wave, file }
}

test("owned dispatch reports execution_qualified only from the binding and journals the matched profile", async t => {
  const f = recordFixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const scenario = ownedWave(t)
  const pin = writePinnedBytes(f, f.record)
  scenario.wave.native_qualification = pin
  writeFileSync(scenario.file, JSON.stringify(scenario.wave))
  const x = containedFixture(scenario)
  let bound = 0
  const bindFor = f => (wave, context) => {
    bound++
    const world = liveWorld(f, { spawn: helperSpawn() })
    return bindNativeQualification(wave, { ...world.deps, runId: context.runId, sourcePath: f.sourcePath })
  }
  const options = {
    env: { OPENCODE_API_KEY: "synthetic-test-key" }, identity: () => ({}),
    qualify: () => ({ execution_qualified: true, plan: { cases: [{ id: "core-a", set: "core", tier: "wide" }] } }),
    adapter: { supervisionAvailable: true, worker: () => assert.fail("host worker forbidden"), trial: () => assert.fail("host CLI forbidden"), signal: () => assert.fail("host signal forbidden"), owned: x.owned },
    clock: x.c,
    nativeQualification: bindFor(f),
  }
  const report = await drive(main(["--manifest", scenario.file], options), x.c)
  assert.equal(bound, 1, "the run configuration binds exactly once per run")
  assert.equal(report.execution_qualified, true)
  assert.equal(report.native_qualification.matched, true)
  assert.deepEqual(report.native_qualification.profile.os_profile, f.record.os_profile)
  assert.equal(report.native_qualification.profile.helper.sha256, sha256(f.helperBytes))
  assert.equal(report.native_qualification.profile.evidence.sha256, sha256(f.evidenceBytes))
  assert.equal(report.native_qualification.profile.qualified_scope, f.record.qualified_scope)
  assert.equal(x.descriptors.length, 1, "the identity-owned transport still delivers exactly one bootstrap descriptor")
  const persisted = JSON.parse(readFileSync(join(scenario.wave.control, "report.json"), "utf8"))
  assert.equal(persisted.execution_qualified, true)
  assert.equal(persisted.native_qualification.matched, true)
  const progress = JSON.parse(readFileSync(join(scenario.wave.control, "progress.json"), "utf8"))
  assert.equal(progress.native_qualification.profile.node.version, "v22.23.2")
  // A second run binds again and reports independently; nothing carries over.
  const second = ownedWave(t, { record: pin })
  const y = containedFixture(second)
  const secondReport = await drive(main(["--manifest", second.file], { ...options, adapter: { ...options.adapter, owned: y.owned }, clock: y.c, nativeQualification: bindFor(f) }), y.c)
  assert.equal(bound, 2)
  assert.equal(secondReport.execution_qualified, true)
  assert.notEqual(report.native_qualification, secondReport.native_qualification)
})

test("the default owned path without a record stays refused exactly as before", async t => {
  const scenario = ownedWave(t)
  const adapter = processAdapter({ spawn: () => assert.fail("unqualified native spawn forbidden") })
  const options = {
    env: { OPENCODE_API_KEY: "synthetic-test-key", EVALS_OWNED_QUALIFIED: "true" }, identity: () => ({}),
    qualify: () => ({ execution_qualified: true, plan: { cases: [{ id: "core-a", set: "core", tier: "wide" }] } }),
    adapter,
    clock: { monotonic: () => 0, wall: () => 0, sleep: () => assert.fail("no supervision without dispatch"), set: () => assert.fail(), clear: () => assert.fail() },
  }
  scenario.wave.execution_qualified = true
  scenario.wave.owned = { snapshot: "pretend", spawn: "pretend" }
  writeFileSync(scenario.file, JSON.stringify(scenario.wave))
  const report = await main(["--manifest", scenario.file], options)
  assert.equal(report.complete, false)
  assert.equal(report.stop_reason, "qualification-failed")
  assert.equal(report.execution_qualified, false)
  assert.equal(report.successor_allowed, false)
  assert.equal(existsSync(join(scenario.wave.control, "wave.lock")), false)
  assert.equal(existsSync(join(scenario.wave.control, "progress.json")), false)
})

test("a mismatched record keeps the owned dispatch closed exactly like a missing one", async t => {
  const f = recordFixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const scenario = ownedWave(t)
  const world = liveWorld(f, { spawn: helperSpawn() })
  const stale = structuredClone(f.record)
  stale.node.sha256 = "0".repeat(64)
  scenario.wave.native_qualification = writePinnedBytes(f, stale)
  writeFileSync(scenario.file, JSON.stringify(scenario.wave))
  const options = {
    env: { OPENCODE_API_KEY: "synthetic-test-key" }, identity: () => ({}),
    qualify: () => ({ execution_qualified: true, plan: { cases: [{ id: "core-a", set: "core", tier: "wide" }] } }),
    adapter: { supervisionAvailable: true, owned: { snapshot: () => assert.fail("no snapshot after a refused binding"), spawn: () => assert.fail("no spawn after a refused binding") } },
    clock: { monotonic: () => 0, wall: () => 0, set: () => assert.fail(), clear: () => assert.fail() },
    nativeQualification: (wave, context) => bindNativeQualification(wave, { ...world.deps, runId: context.runId, sourcePath: f.sourcePath }),
  }
  const report = await main(["--manifest", scenario.file], options)
  assert.equal(report.execution_qualified, false)
  assert.equal(report.stop_reason, "qualification-failed")
  assert.equal(world.constructions.length, 0, "a mismatched record constructs nothing native")
  assert.equal(existsSync(join(scenario.wave.control, "wave.lock")), false)
})

test("the fake owner seam used by the contained suite satisfies the adapter's method contract", () => {
  const owner = fakeIdentityOwner()
  assert.equal(["register", "readIdentity", "reconcile", "stop", "closed", "available"].every(k => typeof owner[k] === "function"), true)
})
