// Regression for dispatch BLOCKER 5: the approved case is in the `commit` set, and the
// owned composition had no commit-plan path at all — the in-container runner refused
// with "1 selected case(s) are in set commit ... run only with --commit-plan <file>"
// before any child spawn. The closed descriptor schema now admits one optional
// commitPlan pin (canonical container path + sha256, authored from the manifest's
// reviewed dossier pin), the wave threads it, the staging validator admits the pinned
// plan and targets seed inside the inputs tree, and the bootstrap seeds the fresh
// store's targets.json from the staged inputs before runBatch executes.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { runBatch } from "../src/run/runner.mjs"
import { resolveCommitPlan } from "../src/run/commit-plan.mjs"
import { flatten } from "../src/grade/targets.mjs"
import { completeTrials } from "../src/run/wave-manifest.mjs"
import { qualifyWave } from "../src/run/wave-manifest.mjs"
import { authorizeOwnedLaunch } from "../src/run/owned-launch.mjs"
import { validateOwnedInputs as stagingInputs } from "../src/run/owned-io.mjs"
import { containedFixture, drive, fakeIdentityOwner } from "./support/wave-contained-parent.mjs"
import { main } from "../scripts/run-mem-wave.mjs"
import { WAVE_MODEL } from "../src/run/wave-manifest.mjs"

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex")

// The authored plan dossier for the mem commit write (the lead's exact contract) and
// its targets seed: the reserved synthetic aliases only, resolved at run time against
// the store's seeded targets.json.
const PLAN_DOSSIER = { actions: ["mem_commitments"], writes: { mem_commitments: { memory: "commitments", allow: ["@mem.personal", "@mem.shared"] } } }
const TARGETS_SEED = { "mem.personal": ["spc-eval-personal"], "mem.shared": ["spc-eval-shared"] }

// A minimal compiled case in the commit set, valid through the repo's case schema.
const COMMIT_CASE = {
  schema: "oc-case/1", id: "commit-synthetic-case", plugin: "mem", skill: "mem.usage", tier: "T3", status: "active", data: "synthetic",
  prompt: "Add sending the Quartz draft to what I owe. I have not chosen a deadline.", sets: ["commit"],
  items: [{ id: "MEM-CT01", severity: "major", grader: "code", ask: "The typed invocation and the scoped backend truth agree on the stored promise.",
    evidence: [{ kind: "text", span: "any", op: "matches", value: { kind: "regex", source: "^Stored the Quartz promise without a date\\.$", flags: "" } }] }],
}

/** Drives the REAL runBatch to the commit-set guard: an unconfined batch with a
 * synthetic compiled commit case, a temp store the test seeds with targets.json, and
 * a world path that does not exist — so a run that passes the guard fails later at
 * the world load, never at the guard. */
function guardDrive(t, { plan, caseSets = ["commit"] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "commit-guard-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const casesDir = join(root, "cases"), store = join(root, "store"), home = join(root, "home")
  mkdirSync(casesDir); mkdirSync(store); mkdirSync(home)
  const caseObject = { ...COMMIT_CASE, id: caseSets[0] === "commit" ? "commit-synthetic-case" : `tools-synthetic-${caseSets[0]}`, sets: caseSets }
  writeFileSync(join(casesDir, `${caseObject.id}.json`), JSON.stringify(caseObject))
  writeFileSync(join(store, "targets.json"), JSON.stringify(TARGETS_SEED))
  const planPath = join(root, "commit-plan.json")
  if (plan !== undefined) { writeFileSync(planPath, JSON.stringify(plan)); }
  return runBatch({
    isolation: "none", unsafeNoIsolation: true, plugin: "mem", iteration: "commit-guard", model: WAVE_MODEL, auth: "none",
    cases: caseObject.id, casesDir, set: caseSets[0], arm: "none", trials: 1, parallel: 1, keep: false,
    ...(plan !== undefined ? { commitPlan: planPath } : {}),
    world: join(root, "no-such-world.mjs"),
  }, { caller: { EVALS_STORE: store, EVALS_TMP: join(root, "tmp"), EVALS_RAW: join(root, "raw"), HOME: home, PATH: process.env.PATH }, log: () => {} })
}

test("the authored plan dossier resolves through the real commit-plan validator against the pinned seed", () => {
  const resolved = resolveCommitPlan(PLAN_DOSSIER, flatten(TARGETS_SEED))
  assert.deepEqual(resolved.actions, ["mem_commitments"])
  assert.deepEqual(resolved.writes.mem_commitments, { memory: "commitments", allow: ["spc-eval-personal", "spc-eval-shared"] })
})

test("a commit-set case with the plan and the seeded targets passes the commit guard", async t => {
  // RED at the parent: the guard itself refuses with the exact blocker message.
  // Green: the guard passes, the plan resolves against the seeded targets, and the run
  // fails later at the world load — never with the commit-set message.
  const error = await guardDrive(t, { plan: PLAN_DOSSIER }).then(() => null, error => error)
  assert.ok(error instanceof Error, "the unconfined batch stops after the guard")
  assert.equal(/in set commit/.test(error.message), false, `the commit guard passed: ${error.message}`)
  assert.equal(/commit plan:/.test(error.message), false, `the plan resolved: ${error.message}`)
  assert.equal(/no world at/.test(error.message), true, `the run reached the world load: ${error.message}`)
})

test("a commit-set case without a plan refuses with the exact blocker message", async t => {
  await assert.rejects(guardDrive(t, { plan: undefined }), /1 selected case\(s\) are in set commit \(commit-synthetic-case\): they really write, and run only with --commit-plan <file> naming what they may write/)
})

test("a plan whose actions and writes disagree refuses with the validator's own refusal", async t => {
  const mismatched = { actions: ["mem_commitments", "mem_page"], writes: { mem_commitments: PLAN_DOSSIER.writes.mem_commitments } }
  await assert.rejects(guardDrive(t, { plan: mismatched }), /commit plan: `actions` and `writes` must name the same actions/)
})

test("a non-commit case without a plan is unaffected", async t => {
  const error = await guardDrive(t, { plan: undefined, caseSets: ["wide"] }).then(() => null, error => error)
  assert.ok(error instanceof Error)
  assert.equal(/in set commit/.test(error.message), false, `the commit guard is not armed for non-commit cases: ${error.message}`)
  assert.equal(/no world at/.test(error.message), true, `the run passed every commit-path check: ${error.message}`)
})

test("the owned descriptor's commitPlan pin passes the guard and reaches the runner's plan reader", async t => {
  const root = mkdtempSync(join(tmpdir(), "commit-owned-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const casesDir = join(root, "cases"), store = join(root, "store")
  mkdirSync(casesDir); mkdirSync(store)
  writeFileSync(join(casesDir, `${COMMIT_CASE.id}.json`), JSON.stringify(COMMIT_CASE))
  // The pinned container path does not exist on a test host: the run passes the
  // commit-set guard with the pin, then fails reading the pinned file — proving the
  // pin flowed through the real runner to its reader. The live in-container proof is
  // the next dispatch round's evidence, as with every preceding blocker.
  await assert.rejects(runBatch({
    isolation: "none", unsafeNoIsolation: true, plugin: "mem", iteration: "commit-pin", model: WAVE_MODEL, auth: "none",
    cases: COMMIT_CASE.id, casesDir, set: "commit", arm: "none", trials: 1, parallel: 1,
    commitPlan: { path: "/inputs/commit-plan.json", sha256: "d".repeat(64) },
    world: join(root, "no-such-world.mjs"),
  }, { caller: { EVALS_STORE: store, EVALS_TMP: join(root, "tmp"), EVALS_RAW: join(root, "raw"), HOME: root, PATH: process.env.PATH }, log: () => {} }),
    error => error.code === "ENOENT" && !/in set commit|commit plan pin/.test(error.message))
})

test("the contained entry hands the runner the descriptor's pin unchanged, so the runner's options comparison holds", async () => {
  const { runContainedEntry } = await import("../src/run/owned-entry.mjs")
  const descriptor = { schema: "oc-owned-launch/1", binding: { invocation_id: "11111111-1111-4111-8111-111111111111", manifest_sha256: "a".repeat(64), trial_id: "trial-a" },
    container_id: "1".repeat(64), context: "colima-mem-evals-20261122", inputs_sha256: "b".repeat(64), binaries_sha256: "c".repeat(64),
    options: { plugin: "mem", iteration: "trial-a", model: WAVE_MODEL, auth: "env:OPENCODE_API_KEY", cases: "core-a", casesDir: "/inputs/cases", set: "core", trials: 1, parallel: 1, arm: "/inputs/arm", world: "/inputs/harness/worlds/mem/index.mjs", host: "2.2.6", timeout: 60, stale: "refuse", tools: "locked", isolation: "owned-container", harnessRetries: 0, processGroup: "inherited", commitPlan: { path: "/inputs/commit-plan.json", sha256: "d".repeat(64) } } }
  const observation = { platform: "linux", mounts: "/ ro\n/inputs ro\n/opt/evals/bin ro\n/work rw", password: "synthetic-password" }
  let seen = null
  const files = new Map(), sink = { open(name) { files.set(name, Buffer.alloc(0)); return { append: () => {}, close() {} } } }
  await runContainedEntry(Buffer.from(JSON.stringify(descriptor)), { observation, sink, caller: {}, execute: async options => {
    const session = (await import("../src/run/owned-launch.mjs")).ownedSession(options.ownedSession)
    session.recordExecution({ exit: 0 })
    const { ownedSession, ...rest } = options
    seen = rest
  } })
  assert.deepEqual(seen.commitPlan, { path: "/inputs/commit-plan.json", sha256: "d".repeat(64) }, "the pin reaches the runner unchanged")
  assert.deepEqual(seen, descriptor.options, "the runner's options equal the descriptor's, so the owned comparison holds")
})

test("the descriptor schema admits exactly one commitPlan pin shape, or nothing", () => {
  const observation = { platform: "linux", mounts: "/ ro\n/inputs ro\n/opt/evals/bin ro\n/work rw", password: "synthetic-password" }
  const base = { schema: "oc-owned-launch/1", binding: { invocation_id: "11111111-1111-4111-8111-111111111111", manifest_sha256: "a".repeat(64), trial_id: "trial-a" },
    container_id: "1".repeat(64), context: "colima-mem-evals-20261122", inputs_sha256: "b".repeat(64), binaries_sha256: "c".repeat(64),
    options: { plugin: "mem", iteration: "trial-a", model: WAVE_MODEL, auth: "env:OPENCODE_API_KEY", cases: "core-a", casesDir: "/inputs/cases", set: "core", trials: 1, parallel: 1, arm: "/inputs/arm", world: "/inputs/harness/worlds/mem/index.mjs", host: "2.2.6", timeout: 60, stale: "refuse", tools: "locked", isolation: "owned-container", harnessRetries: 0, processGroup: "inherited" } }
  const pinned = { ...base, options: { ...base.options, commitPlan: { path: "/inputs/commit-plan.json", sha256: "d".repeat(64) } } }
  assert.ok(authorizeOwnedLaunch(pinned, observation), "a canonical pin is admitted")
  for (const bad of [
    { path: "/inputs/other-plan.json", sha256: "d".repeat(64) },
    { path: "/inputs/commit-plan.json", sha256: "not-a-sha" },
    { path: "/inputs/commit-plan.json" },
    "commit-plan.json",
  ]) {
    const malformed = { ...base, options: { ...base.options, commitPlan: bad } }
    assert.throws(() => authorizeOwnedLaunch(malformed, observation), /single contained trial options required/, JSON.stringify(bad))
  }
  assert.ok(authorizeOwnedLaunch(base, observation), "no commitPlan still authorizes")
})

test("the wave threads the manifest's commit-plan pin into the descriptor", async t => {
  const root = mkdtempSync(join(tmpdir(), "commit-wave-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const planBytes = Buffer.from(JSON.stringify(PLAN_DOSSIER))
  const targetsBytes = Buffer.from(JSON.stringify(TARGETS_SEED))
  const planPath = join(root, "commit-plan.json"), targetsPath = join(root, "targets.json")
  writeFileSync(planPath, planBytes); writeFileSync(targetsPath, targetsBytes)
  const wave = { id: "owned", harness_sha: "a".repeat(40), control: join(root, "control"), store: join(root, "store"), docker_config: join(root, "docker"),
    model: WAVE_MODEL, trial_timeout_s: 3480, caps: { path: join(root, "caps.json") }, runtime: { docker: { path: "/pinned/docker" }, image: `sha256:${"b".repeat(64)}` },
    trials: ["first", "second"].map(id => ({ id, case: "core-a", arm: "baseline", condition: "direct" })),
    commit_plan: { path: planPath, sha256: sha256(planBytes) }, targets: { path: targetsPath, sha256: sha256(targetsBytes) } }
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
  assert.equal(x.descriptors.length, 1)
  assert.deepEqual(x.descriptors[0].options.commitPlan, { path: "/inputs/commit-plan.json", sha256: wave.commit_plan.sha256 }, "the descriptor carries the manifest pin")
  assert.equal(report.execution_qualified, true)
})

test("qualifyWave admits the commit-plan and targets pins and requires the seed with a plan", t => {
  const root = mkdtempSync(join(tmpdir(), "commit-admission-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const nodeBytes = Buffer.from("fake Linux Node"), nodePath = join(root, "runtime-node")
  writeFileSync(nodePath, nodeBytes, { mode: 0o700 })
  const pin = (name, data) => { const bytes = Buffer.from(JSON.stringify(data)); const path = join(root, name); writeFileSync(path, bytes); return { path, sha256: sha256(bytes) } }
  const caseFile = pin("case-a.json", { id: "case-a", sets: ["tune"] })
  const plan = { schema: "oc-mem-arm/1", source_commit: "6".repeat(40), archive_sha256: "b".repeat(64), files: {} }
  const planPin = (name, bytes) => { const path = join(root, name); writeFileSync(path, bytes); return { path, sha256: sha256(bytes) } }
  const planBytes = Buffer.from(JSON.stringify(PLAN_DOSSIER)), targetsBytes = Buffer.from(JSON.stringify(TARGETS_SEED))
  const armBase = join(root, "baseline"); mkdirSync(armBase)
  const manifestBase = { schema: "oc-mem-wave/1", id: "commit-wave", model: WAVE_MODEL, target_usd: 10, total_ms: 3600000, cleanup_ms: 120000,
    docker_context: "colima-mem-evals-20261122", harness_sha: "a".repeat(40), plan: pin("plan.json", { schema: "oc-mem-wave-plan/1", cases: [{ id: "case-a", conditions: ["direct", "search"], file: caseFile, set: "tune" }] }),
    trials: completeTrials({ schema: "oc-mem-wave-plan/1", cases: [{ id: "case-a", conditions: ["direct", "search"], file: caseFile, set: "tune" }] }),
    control: root, store: join(root, "store"), cases_dir: root, docker_config: root, trial_timeout_s: 420,
    runtime: { version: "2.2.6", opencode: pin("opencode", "fake"), node: pin("rnode", "n"), docker: pin("rdocker", "d"), launcher_node: { path: nodePath, sha256: sha256(nodeBytes) }, image: `sha256:${"d".repeat(64)}` } }
  for (const key of ["opencode", "node", "docker"]) chmodSync(manifestBase.runtime[key].path, 0o700)
  const identity = { harnessSha: manifestBase.harness_sha, launcherNodeSha: sha256(nodeBytes) }
  const verify = () => qualifyWave(manifestBase, identity)
  // Without any commit-plan pin, admission is unchanged.
  assert.throws(verify, /file pin and SHA-256 required/, "the next missing pin is the usual one — no commit coupling armed")
  // A pinned plan with its pinned seed passes this block and proceeds to the next.
  const withBoth = { ...manifestBase, commit_plan: planPin("commit-plan.json", planBytes), targets: planPin("targets.json", targetsBytes) }
  assert.throws(() => qualifyWave(withBoth, identity), /file pin and SHA-256 required/, "the block passed; the next pin is still missing")
  // A pinned plan without the seed refuses at admission.
  const withoutTargets = { ...manifestBase, commit_plan: planPin("commit-plan.json", planBytes) }
  assert.throws(() => qualifyWave(withoutTargets, identity), /targets seed pin required with a commit plan/)
  // A mismatched seed hash refuses with the existing digest vocabulary.
  const tampered = { ...manifestBase, commit_plan: planPin("commit-plan.json", planBytes), targets: { ...planPin("targets.json", targetsBytes), sha256: "0".repeat(64) } }
  assert.throws(() => qualifyWave(tampered, identity), /file pin digest mismatch/)
  // The plan must live outside the compared arms.
  const inside = { ...manifestBase, arms: { baseline: { directory: root } }, commit_plan: planPin("commit-plan.json", planBytes), targets: planPin("targets.json", targetsBytes) }
  assert.throws(() => qualifyWave(inside, identity), /commit plan dossier must live outside compared packages/)
  // A malformed plan pin refuses on shape.
  assert.throws(() => qualifyWave({ ...manifestBase, commit_plan: { path: "relative.json", sha256: sha256(planBytes) } }, identity), /commit plan dossier pin required/)
})

test("the staged inputs tree admits the pinned plan and targets seed files", t => {
  const root = mkdtempSync(join(tmpdir(), "commit-staging-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const inputs = join(root, "inputs"), binaries = join(root, "binaries"), work = join(root, "work")
  mkdirSync(work); mkdirSync(binaries)
  for (const p of [inputs, join(inputs, "harness"), join(inputs, "arm"), join(inputs, "cases")]) mkdirSync(p)
  for (const name of ["caps.json", "models.json", "model-map.json", "conditions.json"]) writeFileSync(join(inputs, name), "{}")
  writeFileSync(join(inputs, "harness", "identity"), "synthetic harness")
  writeFileSync(join(inputs, "cases", "core-a.json"), "{}")
  const elf = Buffer.alloc(20); elf.write("\x7fELF"); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(183, 18)
  for (const name of ["node", "opencode"]) writeFileSync(join(binaries, name), elf, { mode: 0o700 })
  const base = { work, inputs, binaries, architecture: "arm64", descriptor: { options: { condition: "direct" } } }
  writeFileSync(join(inputs, "commit-plan.json"), JSON.stringify(PLAN_DOSSIER))
  writeFileSync(join(inputs, "targets.json"), JSON.stringify(TARGETS_SEED))
  assert.doesNotThrow(() => stagingInputs(base), "the pinned plan and seed are admissible staging")
})

test("the bootstrap seeds the fresh store from the staged inputs before the runner executes", () => {
  const bootstrap = readFileSync(new URL("../scripts/run-contained-trial.mjs", import.meta.url), "utf8")
  // The offline suites cannot execute the in-container bootstrap; the seeding contract
  // is pinned here and the live proof is the next dispatch round's evidence.
  assert.equal(/copyFileSync\("\/inputs\/targets\.json", join\("\/work\/store", "targets\.json"\)\)/.test(bootstrap), true, "the bootstrap copies the staged seed into the store")
  assert.equal(/descriptor\?\.options\?\.commitPlan/.test(bootstrap), true, "the seeding is armed exactly when the descriptor pins a plan")
})
