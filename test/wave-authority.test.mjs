import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { main } from "../scripts/run-mem-wave.mjs"
import { createResourceScope, cleanupOwned, launchWave } from "../src/run/wave-launcher.mjs"

const receipt = { schema: "oc-evals-owned/1", batch: "b1234567890", resources: [{ kind: "container", id: "f".repeat(64) }], pending: [], uncertain: false }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "wave-authority-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const wave = { id: "rejected", control: join(root, "control"), store: join(root, "store"), docker_config: join(root, "docker"), runtime: { docker: { path: "/unqualified/docker" } }, trials: [{ id: "baseline-direct-a-r1", case: "a" }] }
  mkdirSync(wave.docker_config)
  const file = join(root, "manifest.json"), calls = []
  const adapter = { worker: () => assert.fail("no worker"), unverified: () => [], command: async spec => { calls.push(spec); return spec.args.includes("inspect") ? { code: 1, stderr: "No such object" } : { code: 0 } } }
  const run = extra => { writeFileSync(file, JSON.stringify(wave)); return main(["--manifest", file], { env: { OPENCODE_API_KEY: "synthetic-review-key" }, identity: () => ({}), adapter, ...extra }) }
  return { root, wave, calls, run }
}

test("rejected production manifest grants no cleanup authority for outside or in-control foreign journals", async t => {
  for (const traversal of [true, false]) {
    const f = fixture(t)
    mkdirSync(join(f.wave.control, "resources"), { recursive: true })
    if (traversal) f.wave.trials[0].id = "../../outside"
    const file = traversal ? join(f.root, "outside.json") : join(f.wave.control, "resources", `${f.wave.trials[0].id}.json`)
    const bytes = JSON.stringify(receipt)
    writeFileSync(file, bytes)
    const report = await f.run()
    assert.equal(report.stop_reason, "qualification-failed")
    assert.equal(report.trials.length, 1)
    assert.equal(report.trials[0].status, "unrun")
    assert.deepEqual(f.calls, [])
    assert.equal(readFileSync(file, "utf8"), bytes)
    assert.equal(existsSync(join(f.wave.control, "wave.json")), false)
  }
})

test("cleanup requires an invocation-owned scope and bound receipt, but reclaims known partial creations", async t => {
  const f = fixture(t)
  mkdirSync(f.wave.control)
  const scope = createResourceScope(f.wave.control, { manifestSha: "a".repeat(64), trials: f.wave.trials })
  const file = join(scope.directory, `${f.wave.trials[0].id}.json`), calls = []
  const exec = async args => { calls.push(args); return { code: args.includes("inspect") ? 1 : 0, stderr: "No such object" } }
  writeFileSync(file, JSON.stringify(receipt))
  assert.equal(await cleanupOwned(scope, exec, () => 10000), false)
  assert.deepEqual(calls, [])
  assert.equal(await cleanupOwned({ ...scope }, exec, () => 10000), false, "a copied scope is not authority")
  const owner = { ...scope.owner, trial_id: f.wave.trials[0].id }
  writeFileSync(file, JSON.stringify({ ...receipt, owner, pending: ["container:lost-response"] }))
  assert.equal(await cleanupOwned(scope, exec, () => 10000), false, "ambiguous create stays unresolved")
  assert.equal(calls[0].at(-1), "f".repeat(64), "the established receipt is still reclaimed")
  writeFileSync(file, JSON.stringify({ ...receipt, owner, resources: [], verified_gone: true }))
  assert.equal(await cleanupOwned(scope, exec, () => 10000), true)
})

test("pre-existing or symlink resource scopes are refused even after an injected successful qualification", async t => {
  for (const symlink of [true, false]) {
    const f = fixture(t)
    mkdirSync(f.wave.control)
    const foreign = join(f.root, "foreign")
    mkdirSync(foreign)
    if (symlink) symlinkSync(foreign, join(f.wave.control, "resources"))
    else mkdirSync(join(f.wave.control, "resources"))
    const file = join(f.wave.control, "resources", `${f.wave.trials[0].id}.json`)
    writeFileSync(file, JSON.stringify(receipt))
    assert.equal((await f.run({ qualify: () => ({ execution_qualified: true }) })).stop_reason, "qualification-failed")
    assert.deepEqual(f.calls, [])
    assert.equal(readFileSync(file, "utf8"), JSON.stringify(receipt))
  }
})

test("post-allocation failure reclaims established IDs but retains uncertainty and the singleton", async t => {
  const f = fixture(t), calls = []
  const report = await launchWave(f.wave, {
    manifestSha: "a".repeat(64), singleton: join(f.wave.docker_config, "singleton.lock"), verify: async () => {},
    allocate: (_lease, scope) => {
      const owner = { ...scope.owner, trial_id: f.wave.trials[0].id }
      writeFileSync(join(scope.directory, `${owner.trial_id}.json`), JSON.stringify({ ...receipt, owner, pending: ["interrupted-second-create"] }))
      throw new Error("setup failed after a successful creation receipt")
    },
    spawnWorker: () => assert.fail("setup never completed"),
    cleanup: (remaining, scope) => cleanupOwned(scope, async args => { calls.push(args); return { code: args.includes("inspect") ? 1 : 0, stderr: "No such object" } }, remaining),
  })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].at(-1), receipt.resources[0].id)
  assert.equal(report.supervision.cleanup_verified, false)
  assert.equal(existsSync(join(f.wave.docker_config, "singleton.lock")), true)
})

test("scope traversal, replaced scope symlinks and outside receipt symlinks grant no deletion authority", async t => {
  for (const replacement of ["scope", "receipt"]) {
    const f = fixture(t)
    mkdirSync(f.wave.control)
    assert.throws(() => createResourceScope(f.wave.control, { manifestSha: "a".repeat(64), trials: [{ id: "../../outside" }] }))
    assert.equal(existsSync(join(f.wave.control, "resources")), false)
    const scope = createResourceScope(f.wave.control, { manifestSha: "a".repeat(64), trials: f.wave.trials })
    const foreign = join(f.root, "outside")
    mkdirSync(foreign)
    const outside = join(foreign, `${f.wave.trials[0].id}.json`), bytes = JSON.stringify({ ...receipt, owner: { ...scope.owner, trial_id: f.wave.trials[0].id } })
    writeFileSync(outside, bytes)
    if (replacement === "scope") { rmSync(scope.directory, { recursive: true }); symlinkSync(foreign, scope.directory) }
    else symlinkSync(outside, join(scope.directory, `${f.wave.trials[0].id}.json`))
    assert.equal(await cleanupOwned(scope, () => assert.fail("no command is authorized"), () => 10000), false)
    assert.equal(readFileSync(outside, "utf8"), bytes)
  }
})

test("a started trial with a missing creation journal is unresolved, not empty cleanup", async t => {
  const f = fixture(t)
  mkdirSync(f.wave.control)
  const scope = createResourceScope(f.wave.control, { manifestSha: "a".repeat(64), trials: f.wave.trials })
  writeFileSync(join(scope.directory, `${f.wave.trials[0].id}.started.json`), "{}")
  assert.equal(await cleanupOwned(scope, () => assert.fail(), () => 10000), false)
})

test("an invalid foreign journal never prevents cleanup of separately proved own receipts", async t => {
  const f = fixture(t)
  mkdirSync(f.wave.control)
  const scope = createResourceScope(f.wave.control, { manifestSha: "a".repeat(64), trials: [{ id: "foreign" }, { id: "own" }] })
  const foreign = join(scope.directory, "foreign.json"), bytes = JSON.stringify(receipt)
  writeFileSync(foreign, bytes)
  writeFileSync(join(scope.directory, "own.json"), JSON.stringify({ ...receipt, owner: { ...scope.owner, trial_id: "own" }, resources: [{ kind: "container", id: "a".repeat(64) }] }))
  const calls = []
  assert.equal(await cleanupOwned(scope, async args => { calls.push(args); return { code: args.includes("inspect") ? 1 : 0, stderr: "No such object" } }, () => 10000), false)
  assert.equal(calls.length, 2)
  assert.equal(calls.every(args => args.at(-1) === "a".repeat(64)), true)
  assert.equal(readFileSync(foreign, "utf8"), bytes)
})
