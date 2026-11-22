import { test } from "node:test"
import assert from "node:assert/strict"
import { containTrial, verifyOwnedConfig } from "../src/run/owned-containment.mjs"
import { creationOperation, creationID } from "../src/run/container-receipt.mjs"

const id = n => String(n).padStart(64, "0")
const binding = { invocation_id: "11111111-1111-4111-8111-111111111111", manifest_sha256: "a".repeat(64), trial_id: "baseline-direct-a-r1" }
const plan = () => ({ binding, context: "colima-mem-evals-20261122", image: `sha256:${"b".repeat(64)}`, user: "1000:1000", allow: ["opencode.ai"],
  control: "/parent/control", store: "/parent/store", dockerConfig: "/parent/docker", work: "/staged/work", inputs: "/staged/inputs", binaries: "/staged/bin",
  inputs_sha256: "c".repeat(64), binaries_sha256: "d".repeat(64), timeoutMs: 1000, cleanupMs: 1000, operationMs: 100, outputBytes: 4096,
  descriptor: { options: { plugin: "mem" } }, credentialNames: ["OPENCODE_API_KEY"] })
function fake({ reject = false } = {}) {
  let next = 0
  const calls = [], resources = new Map(), journals = []
  const docker = { closed: () => true, stopClients: async () => true, async run(args) {
    calls.push(args)
    const a = args.slice(2), ok = stdout => ({ code: 0, stdout: stdout ?? "", stderr: "", closed: true })
    if (a[0] === "create" || a[0] === "network" && a[1] === "create") { const key = id(++next); resources.set(key, a); return ok(key) }
    if (a[0] === "inspect" || a[0] === "network" && a[1] === "inspect") {
      const command = resources.get(a.at(-1))
      if (!command) return { code: 1, stdout: "", stderr: `Error: No such object: ${a.at(-1)}`, closed: true }
      return ok(JSON.stringify([{ Id: a.at(-1), command }]))
    }
    if (a[0] === "rm" || a[0] === "network" && a[1] === "rm") resources.delete(a.at(-1))
    return ok()
  } }
  const deps = { docker, clock: clock(), journal: async j => journals.push(structuredClone(j)), validateInputs: async () => ({ work: { dev: 1, ino: 2 }, inputs_sha256: "c".repeat(64), binaries_sha256: "d".repeat(64) }),
    inspectConfig: (actual, expected) => !reject && actual.Id === expected.id,
    measure: async () => true, finalize: async proof => { calls.push(["finalize", proof]); return { accounting: { complete: false }, native: "unknown" } } }
  return { calls, resources, journals, deps }
}

test("rejected external config never starts a container or executes a trial", async () => {
  const f = fake({ reject: true })
  const result = await drive(containTrial(plan(), f.deps), f.deps.clock)
  assert.equal(f.calls.some(a => a.includes("start") || a.includes("exec")), false)
  assert.equal(result.cleanup_verified, true)
  assert.equal(result.complete, false)
  assert.equal(f.resources.size, 0)
})

function clock() {
  let time = 0, counter = 0
  const pending = new Map()
  return { now: () => time, set(fn, ms) { const id = ++counter; pending.set(id, { fn, at: time + ms }); return id }, clear: id => pending.delete(id), tick() { const first = [...pending].sort((a,b) => a[1].at - b[1].at)[0]; if (!first) throw new Error("no clock event"); pending.delete(first[0]); time = first[1].at; first[1].fn() } }
}
async function drive(promise, clock) {
  let done = false, result, error
  promise.then(r => { done = true; result = r }, e => { done = true; error = e })
  for (let i = 0; i < 1000 && !done; i++) { for (let j = 0; j < 150; j++) await Promise.resolve(); if (!done) clock.tick() }
  assert.equal(done, true, "bounded parent settles")
  if (error) throw error
  return result
}

test("create receipts recognize create and never accept names, short IDs or cidfile text", () => {
  assert.deepEqual(creationOperation(["create", "--name", "reused", "image"]), { kind: "container", name: "reused" })
  for (const stdout of ["reused", "abc123", `${id(1)}\n${id(2)}`, ""]) assert.equal(creationID({ code: 0, stdout }), null)
  assert.equal(creationID({ code: 1, stdout: id(1) }), null)
  assert.equal(creationID({ code: 0, stdout: `${id(1)}\n` }), id(1))
})

test("parent records/inspects before start, executes full trial by exact ID, finalizes only after resource absence", async () => {
  const f = fake()
  const result = await drive(containTrial(plan(), f.deps), f.deps.clock)
  assert.equal(result.cleanup_verified, true)
  assert.equal(result.complete, false)
  assert.equal(result.successor_allowed, false)
  assert.equal(f.resources.size, 0)
  const exec = f.calls.find(a => a[2] === "exec")
  assert.ok(exec.includes(id(4)))
  assert.ok(exec.includes("/inputs/harness/scripts/run-contained-trial.mjs"))
  assert.ok(exec.includes("OPENCODE_API_KEY"))
  assert.equal(exec.some(a => a.includes("OPENCODE_API_KEY=")), false)
  for (const n of [3, 4]) {
    const inspect = f.calls.findIndex(a => a[2] === "inspect" && a.at(-1) === id(n))
    const start = f.calls.findIndex(a => a[2] === "start" && a.at(-1) === id(n))
    assert.ok(inspect >= 0 && inspect < start)
    assert.ok(f.journals.some(j => j.resources.some(r => r.id === id(n))))
  }
  assert.equal(f.calls.at(-1)[0], "finalize")
  assert.ok(f.calls.filter(a => ["rm", "inspect", "start"].includes(a[2])).every(a => /^[a-f0-9]{64}$/.test(a.at(-1))))
})

test("partial/lost create and client-exit uncertainty retain admission even if all known IDs are removed", async () => {
  for (const failure of ["partial", "lost", "client", "daemon"]) {
    const f = fake(), original = f.deps.docker.run
    f.deps.docker.run = async args => {
      if (failure === "partial" && args[2] === "create") return { code: 1, stdout: "", closed: true }
      if (failure === "lost" && args[2] === "create") throw new Error("lost")
      if (failure === "daemon" && args[2] === "inspect" && !f.resources.has(args.at(-1))) return { code: 1, stderr: "daemon unavailable", closed: true }
      return original(args)
    }
    if (failure === "client") f.deps.docker.closed = () => false
    const r = await drive(containTrial(plan(), f.deps), f.deps.clock)
    assert.equal(r.cleanup_verified, false, failure)
    assert.equal(r.successor_allowed, false)
    assert.equal(f.calls.some(a => a[0] === "finalize"), false)
  }
})

test("independent watchdog bounds allocation, Docker setup, deadlocked worker, disk and finalization", async () => {
  for (const phase of ["inputs", "journal", "network", "create", "inspect", "start", "exec", "rm", "clients", "measure", "finalize"]) {
    const f = fake(), never = () => new Promise(() => {}), original = f.deps.docker.run
    if (phase === "inputs") f.deps.validateInputs = never
    else if (phase === "journal") f.deps.journal = never
    else if (phase === "clients") f.deps.docker.stopClients = never
    else if (["measure", "finalize"].includes(phase)) f.deps[phase] = never
    else f.deps.docker.run = args => args[2] === phase ? never() : original(args)
    const r = await drive(containTrial(plan(), f.deps), f.deps.clock)
    assert.equal(r.complete, false, phase)
    assert.equal(r.successor_allowed, false, phase)
    assert.ok(f.deps.clock.now() <= 2000, phase)
  }
})

test("missing closure and failed cleanup do not overwrite independent known native negative", async () => {
  const f = fake()
  f.deps.finalize = async () => ({ native: "failed", accounting: { complete: false, known_usd: 0.03 } })
  const result = await drive(containTrial(plan(), f.deps), f.deps.clock)
  assert.equal(result.native, "failed")
  assert.equal(result.accounting.complete, false)
  assert.equal(result.cleanup_verified, true)
})

export { fake, plan, id, clock, drive }
