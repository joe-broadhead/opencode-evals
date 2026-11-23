import { test } from "node:test"
import assert from "node:assert/strict"
import { containTrial, verifyOwnedConfig } from "../src/run/owned-containment.mjs"
import { creationOperation, creationID } from "../src/run/container-receipt.mjs"
import { createOwnedDockerClient } from "../src/run/owned-docker-client.mjs"
import { EventEmitter } from "node:events"

const id = n => String(n).padStart(64, "0")
const binding = { invocation_id: "11111111-1111-4111-8111-111111111111", manifest_sha256: "a".repeat(64), trial_id: "baseline-direct-a-r1" }
const plan = () => ({ binding, context: "colima-mem-evals-20261122", image: `sha256:${"b".repeat(64)}`, imageEnv: ["PATH=/usr/bin:/bin"], user: "1000:1000", allow: ["opencode.ai"],
  control: "/parent/control", store: "/parent/store", dockerConfig: "/parent/docker", work: "/staged/work", inputs: "/staged/inputs", binaries: "/staged/bin",
  inputs_sha256: "c".repeat(64), binaries_sha256: "d".repeat(64), timeoutMs: 1000, cleanupMs: 1000, operationMs: 100, outputBytes: 4096,
  descriptor: { options: { plugin: "mem", iteration: "trial-a", model: "opencode/deepseek-v4.1-flash#low", auth: "env:OPENCODE_API_KEY", cases: "core-a", casesDir: "/inputs/cases", set: "core", trials: 1, parallel: 1, arm: "/inputs/arm", world: "/inputs/harness/worlds/mem/index.mjs", host: "2.2.6", timeout: 60, stale: "refuse", tools: "locked", isolation: "owned-container", harnessRetries: 0, processGroup: "inherited" } }, credentialNames: ["OPENCODE_API_KEY"] })
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
    if (a[0] === "logs") return ok('{"ev":"listening"}')
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
  const blocked = fake()
  blocked.deps.docker.closed = () => false
  blocked.deps.nativeSnapshot = () => ({ binding, outcome: "interrupted" })
  const negative = await drive(containTrial(plan(), blocked.deps), blocked.deps.clock)
  assert.equal(negative.native, "interrupted")
  assert.equal(negative.cleanup_verified, false)
  assert.equal(negative.accounting.complete, false)
})

export { fake, plan, id, clock, drive }

test("late/lost creation receipt never adopts a reused name or admits execution after teardown", async () => {
  const f = fake(), original = f.deps.docker.run
  let release
  f.deps.docker.run = async args => {
    const result = await original(args)
    if (args[2] === "create") await new Promise(resolve => { release = resolve })
    return result
  }
  const result = await drive(containTrial(plan(), f.deps), f.deps.clock)
  assert.equal(result.cleanup_verified, false)
  assert.equal(result.creation_unknown, true)
  assert.equal(f.resources.size, 1, "unknown creation is retained, not swept by name")
  release()
  for (let i = 0; i < 100; i++) await Promise.resolve()
  assert.equal(f.calls.some(a => a[2] === "start" || a[2] === "exec"), false)
  assert.ok(f.journals.at(-1).pending.length)
})

test("worker exit does not prove descendants gone; exact outer removal precedes the data reader", async () => {
  const f = fake(), original = f.deps.docker.run
  let descendants = false
  f.deps.docker.run = async args => {
    if (args[2] === "exec") descendants = true
    if (args[2] === "rm" && args.at(-1) === id(4)) descendants = false
    return original(args)
  }
  f.deps.finalize = async () => { assert.equal(descendants, false); return { native: "unknown" } }
  assert.equal((await drive(containTrial(plan(), f.deps), f.deps.clock)).cleanup_verified, true)
})

test("external config proof checks mounts, resource limits, Env, namespaces, entrypoint and image", () => {
  const expected = { kind: "container", id: id(4), image: `sha256:${"a".repeat(64)}`, imageEnv: ["PATH=/usr/bin:/bin"], user: "1000:1000", network: id(2), memory: 3221225472, cpu: 1500000000, pids: 512, entrypoint: ["/usr/bin/tini", "--"], command: ["sleep", "infinity"], cwd: "/work", tmpfs: { "/tmp": "rw,nosuid,nodev,size=256m" }, mounts: [{ source: "/staged/work", target: "/work", readonly: false }] }
  const actual = { Id: id(4), Image: `sha256:${"a".repeat(64)}`, Config: { User: "1000:1000", Env: ["PATH=/usr/bin:/bin"], Entrypoint: ["/usr/bin/tini", "--"], Cmd: ["sleep", "infinity"], WorkingDir: "/work" }, HostConfig: { Privileged: false, ReadonlyRootfs: true, NetworkMode: id(2), CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"], Memory: 3221225472, MemorySwap: 3221225472, NanoCpus: 1500000000, PidsLimit: 512, Tmpfs: { "/tmp": "rw,nosuid,nodev,size=256m" }, LogConfig: { Type: "local", Config: { "max-size": "1m", "max-file": "1" } } }, NetworkSettings: { Networks: { owned: { NetworkID: id(2) } } }, Mounts: [{ Type: "bind", Source: "/staged/work", Destination: "/work", RW: true, Propagation: "rprivate" }], State: { Running: false, Status: "created" } }
  assert.equal(verifyOwnedConfig(actual, expected), true)
  for (const mutate of [x => x.Id = "reused-name", x => x.Image = "wrong", x => x.Config.Env.push("OPENCODE_API_KEY=value"), x => x.Config.Entrypoint = ["/bin/sh"], x => x.HostConfig.Privileged = true, x => x.HostConfig.NetworkMode = "host", x => x.HostConfig.Memory = 0, x => x.HostConfig.PidMode = "host", x => x.Mounts.push({ Type: "bind", Source: "/parent/store", Destination: "/store", RW: true }), x => x.HostConfig.VolumesFrom = ["foreign"], x => x.HostConfig.LogConfig = {}, x => x.NetworkSettings.Networks.other = { NetworkID: id(7) }]) {
    const changed = structuredClone(actual); mutate(changed); assert.equal(verifyOwnedConfig(changed, expected), false)
  }
})

test("parent cancellation closes creation admission before any workload operation", async () => {
  const f = fake(), controller = new AbortController()
  controller.abort(); f.deps.signal = controller.signal
  const result = await drive(containTrial(plan(), f.deps), f.deps.clock)
  assert.equal(result.reason, "cancelled")
  assert.equal(f.calls.length, 0)
  assert.equal(result.successor_allowed, false)
})

test("a blocking parent callback cannot evade its elapsed-time bound by returning before a timer callback runs", async () => {
  const f = fake(), original = f.deps.validateInputs
  let elapsed = 0
  f.deps.clock.now = () => elapsed
  f.deps.validateInputs = async p => { elapsed = 101; return original(p) }
  const result = await drive(containTrial(plan(), f.deps), f.deps.clock)
  assert.equal(result.reason, "inputs")
  assert.equal(f.calls.length, 0)
})

test("successful own ID is journaled and removed despite early original-client exit without close", async () => {
  const f = fake(), original = f.deps.docker.run, child = new EventEmitter(), signals = []
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = signal => signals.push(signal)
  const client = createOwnedDockerClient({ binary: "/pinned/docker", context: plan().context, config: "/parent/docker" }, { spawn: () => child, clock: f.deps.clock, graceMs: 10 })
  f.deps.docker.run = async (args, options) => {
    if (args[2] === "create") {
      const created = await original(args)
      const pending = client.run(args, options)
      child.stdout.emit("data", Buffer.from(`${created.stdout}\n`)); child.emit("exit", 0, null)
      void client.stopClients() // Complete successful output, but no aggregate close: retain only cleanup authority.
      const result = await pending
      assert.equal(result.closed, false); assert.equal(result.overflow, false)
      assert.ok(f.deps.clock.now() < plan().operationMs)
      return result
    }
    if (args[2] === "stop" || args[2] === "rm") assert.ok(f.journals.at(-1).resources.some(r => r.id === args.at(-1)), "persist before removal")
    return original(args)
  }
  f.deps.docker.stopClients = () => client.stopClients()
  f.deps.docker.closed = () => client.closed()
  const r = await drive(containTrial(plan(), f.deps), f.deps.clock)
  assert.ok(f.journals.some(j => j.resources.some(r => r.id === id(3))))
  assert.ok(f.calls.some(a => a[2] === "rm" && a.at(-1) === id(3)))
  assert.equal(f.resources.size, 0, "separately known networks also reclaimed")
  assert.ok(f.journals.at(-1).pending.length)
  assert.equal(r.creation_unknown, true)
  assert.equal(r.host_clients_closed, false)
  assert.equal(r.cleanup_verified, false)
  assert.equal(r.successor_allowed, false)
  assert.equal(f.calls.some(a => a[2] === "start" || a[2] === "exec" || a[0] === "finalize"), false)
  assert.deepEqual(signals, [])
  child.emit("close", 0, null)
  assert.equal(await client.stopClients(), true)
})

test("real client capped invalid creation never records or removes its apparent ID", async () => {
  for (const outputBytes of [64,4096]) {
    const f=fake(),calls=[]
    f.deps.docker=createOwnedDockerClient({binary:"/pinned/docker",context:plan().context,config:"/parent/docker"},{clock:f.deps.clock,spawn:(_binary,args)=>{
      calls.push(args)
      const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>true
      queueMicrotask(()=>{child.stdout.emit("data",Buffer.from(id(1)));child.stdout.emit("data",Buffer.from("NOT-AN-ID\n"));child.emit("exit",0,null);child.emit("close")})
      return child
    }})
    const result=await drive(containTrial({...plan(),outputBytes},f.deps),f.deps.clock)
    assert.equal(calls.length,1,"only the first creation; no cleanup against its prefix")
    assert.deepEqual(f.journals.at(-1).resources,[])
    assert.equal(f.journals.at(-1).pending.length,1)
    assert.equal(result.creation_unknown,true);assert.equal(result.cleanup_verified,false)
    assert.equal(result.successor_allowed,false)
  }
})
