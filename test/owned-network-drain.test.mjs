// Round-6 regression (invocation 7): the trial cleanup's network removal raced the
// daemon's endpoint eviction once in seven live runs — the containers' removal was
// confirmed, `docker network rm` refused while the daemon still held the evicted
// containers' endpoints (the network was EMPTY when inspected and a later manual rm
// succeeded instantly), the presence check still saw the network, and the receipt
// honestly recorded verified_gone:false, stopping the sequence at the three-check
// gate. The hardening: one bounded drain interval and ONE retry of the network
// removal, only when the race is what the evidence shows — the rm refused with the
// in-use/endpoint vocabulary or the presence check still seeing the network. The
// retry's own verification decides; a retry that still does not verify records the
// honest unverified state exactly as before, and a first-try success runs the very
// same commands as the parent. The fake lifecycle here models the race offline:
// the egress network's endpoints evict a fixed interval after the first refused rm.
import { test } from "node:test"
import assert from "node:assert/strict"
import { containTrial } from "../src/run/owned-containment.mjs"

const id = n => String(n).padStart(64, "0")
const binding = { invocation_id: "11111111-1111-4111-8111-111111111111", manifest_sha256: "a".repeat(64), trial_id: "baseline-direct-a-r1" }
const plan = () => ({ binding, context: "colima-mem-evals-20261122", image: `sha256:${"b".repeat(64)}`, imageEnv: ["PATH=/usr/bin:/bin"], user: "1000:1000", allow: ["opencode.ai"],
  control: "/parent/control", store: "/parent/store", dockerConfig: "/parent/docker", work: "/staged/work", inputs: "/staged/inputs", binaries: "/staged/bin",
  inputs_sha256: "c".repeat(64), binaries_sha256: "d".repeat(64), timeoutMs: 1000, cleanupMs: 1000, operationMs: 100, outputBytes: 4096,
  descriptor: { options: { plugin: "mem", iteration: "trial-a", model: "opencode/deepseek-v4.1-flash#low", auth: "env:OPENCODE_API_KEY", cases: "core-a", casesDir: "/inputs/cases", set: "core", trials: 1, parallel: 1, arm: "/inputs/arm", world: "/inputs/harness/worlds/mem/index.mjs", host: "2.2.6", timeout: 60, stale: "refuse", tools: "locked", isolation: "owned-container", harnessRetries: 0, processGroup: "inherited" } }, credentialNames: ["OPENCODE_API_KEY"] })

// The parent's exact docker-command sequence when every removal succeeds first
// try (captured at f473270 before the hardening): a first-try success must stay
// byte-identical, so the raced implementation replays this list exactly.
const FIRST_TRY_SEQUENCE = [["--context","colima-mem-evals-20261122","network","create","--driver","bridge","evals-11111111-1111-4111-8111-111111111111-egress"],["--context","colima-mem-evals-20261122","network","inspect","0000000000000000000000000000000000000000000000000000000000000001"],["--context","colima-mem-evals-20261122","network","create","--driver","bridge","--internal","-o","com.docker.network.bridge.gateway_mode_ipv4=isolated","-o","com.docker.network.bridge.gateway_mode_ipv6=isolated","evals-11111111-1111-4111-8111-111111111111-trial"],["--context","colima-mem-evals-20261122","network","inspect","0000000000000000000000000000000000000000000000000000000000000002"],["--context","colima-mem-evals-20261122","create","--name","evals-11111111-1111-4111-8111-111111111111-proxy","--network","0000000000000000000000000000000000000000000000000000000000000001","--user","1000:1000","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges","--log-driver","local","--log-opt","max-size=1m","--log-opt","max-file=1","--log-opt","compress=false","--pids-limit","128","--memory","268435456","--memory-swap","268435456","--cpus","0.25","--workdir","/","--mount","type=bind,src=/staged/bin/node,dst=/opt/evals/bin/node,readonly","-e","EVALS_EGRESS_ALLOW=opencode.ai","-e","EVALS_EGRESS_MAX_PER_CLIENT=16","-e","EVALS_EGRESS_MAX_TOTAL=16","sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","/opt/evals/bin/node","/opt/evals/egress-proxy.mjs","3128"],["--context","colima-mem-evals-20261122","inspect","0000000000000000000000000000000000000000000000000000000000000003"],["--context","colima-mem-evals-20261122","network","connect","--alias","egress","0000000000000000000000000000000000000000000000000000000000000002","0000000000000000000000000000000000000000000000000000000000000003"],["--context","colima-mem-evals-20261122","start","0000000000000000000000000000000000000000000000000000000000000003"],["--context","colima-mem-evals-20261122","logs","0000000000000000000000000000000000000000000000000000000000000003"],["--context","colima-mem-evals-20261122","create","--name","evals-11111111-1111-4111-8111-111111111111-trial","--network","0000000000000000000000000000000000000000000000000000000000000002","--user","1000:1000","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges","--log-driver","local","--log-opt","max-size=1m","--log-opt","max-file=1","--log-opt","compress=false","--pids-limit","512","--memory","3221225472","--memory-swap","3221225472","--cpus","1.5","--workdir","/work","--tmpfs","/tmp:rw,nosuid,nodev,size=256m","--mount","type=bind,src=/staged/inputs,dst=/inputs,readonly","--mount","type=bind,src=/staged/bin,dst=/opt/evals/bin,readonly","--mount","type=bind,src=/staged/work,dst=/work","sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","sleep","infinity"],["--context","colima-mem-evals-20261122","inspect","0000000000000000000000000000000000000000000000000000000000000004"],["--context","colima-mem-evals-20261122","start","0000000000000000000000000000000000000000000000000000000000000004"],["--context","colima-mem-evals-20261122","inspect","0000000000000000000000000000000000000000000000000000000000000003"],["--context","colima-mem-evals-20261122","inspect","0000000000000000000000000000000000000000000000000000000000000004"],["--context","colima-mem-evals-20261122","exec","-i","-w","/work","-e","PATH","-e","HOME","-e","TMPDIR","-e","EVALS_TMP","-e","EVALS_STORE","-e","XDG_CONFIG_HOME","-e","XDG_DATA_HOME","-e","XDG_STATE_HOME","-e","XDG_CACHE_HOME","-e","EVALS_CAPS","-e","EVALS_MODELS_CATALOG","-e","EVALS_MODEL_MAP","-e","EVALS_NODE","-e","EVALS_OPENCODE_BIN","-e","OPENCODE_BIN_2_2_6","-e","OPENCODE_PASSWORD","-e","HTTPS_PROXY","-e","HTTP_PROXY","-e","NO_PROXY","-e","OPENCODE_API_KEY","0000000000000000000000000000000000000000000000000000000000000004","/opt/evals/bin/node","/inputs/harness/scripts/run-contained-trial.mjs"],["--context","colima-mem-evals-20261122","stop","--time","1","0000000000000000000000000000000000000000000000000000000000000004"],["--context","colima-mem-evals-20261122","rm","-f","-v","0000000000000000000000000000000000000000000000000000000000000004"],["--context","colima-mem-evals-20261122","inspect","0000000000000000000000000000000000000000000000000000000000000004"],["--context","colima-mem-evals-20261122","stop","--time","1","0000000000000000000000000000000000000000000000000000000000000003"],["--context","colima-mem-evals-20261122","rm","-f","-v","0000000000000000000000000000000000000000000000000000000000000003"],["--context","colima-mem-evals-20261122","inspect","0000000000000000000000000000000000000000000000000000000000000003"],["--context","colima-mem-evals-20261122","network","rm","0000000000000000000000000000000000000000000000000000000000000002"],["--context","colima-mem-evals-20261122","network","inspect","0000000000000000000000000000000000000000000000000000000000000002"],["--context","colima-mem-evals-20261122","network","rm","0000000000000000000000000000000000000000000000000000000000000001"],["--context","colima-mem-evals-20261122","network","inspect","0000000000000000000000000000000000000000000000000000000000000001"]]

// The stateful fake lifecycle (modeled on the owned-containment suite's own fake),
// with the egress network's endpoint-eviction race: evictAfterMs null = no race
// (the 6-in-7 first-try case); a number = the endpoints finish evicting that many
// virtual ms after the first refused rm (round 6's "empty moments later");
// Infinity = the refusal is permanent (both removals fail).
function raced({ evictAfterMs = Infinity, stderrForm = "in use", inspectError = false } = {}) {
  let next = 0
  const calls = [], resources = new Map(), journals = []
  const clk = clock()
  let firstEgressRmAt = null
  const docker = { closed: () => true, stopClients: async () => true, async run(args) {
    calls.push(args)
    const a = args.slice(2), ok = stdout => ({ code: 0, stdout: stdout ?? "", stderr: "", closed: true })
    if (a[0] === "create" || a[0] === "network" && a[1] === "create") { const key = id(++next); resources.set(key, a); return ok(key) }
    if (a[0] === "network" && a[1] === "rm" && a.at(-1) === id(1) && evictAfterMs !== null) {
      firstEgressRmAt ??= clk.now()
      if (clk.now() < firstEgressRmAt + evictAfterMs) {
        const stderr = stderrForm === "endpoints"
          ? `Error response from daemon: network evals-${binding.invocation_id}-egress (id: ${id(1)}) has active endpoints`
          : `Error response from daemon: network evals-${binding.invocation_id}-egress is in use`
        return { code: 1, stdout: "", stderr, closed: true }
      }
    }
    if (a[0] === "inspect" || a[0] === "network" && a[1] === "inspect") {
      if (inspectError && a[0] === "network" && a.at(-1) === id(1)) return { code: 1, stdout: "", stderr: "daemon unavailable", closed: true }
      const command = resources.get(a.at(-1))
      if (!command) return { code: 1, stdout: "", stderr: `Error: No such object: ${a.at(-1)}`, closed: true }
      return ok(JSON.stringify([{ Id: a.at(-1), command }]))
    }
    if (a[0] === "rm" || a[0] === "network" && a[1] === "rm") resources.delete(a.at(-1))
    if (a[0] === "logs") return ok('{"ev":"listening"}')
    return ok()
  } }
  const deps = { docker, clock: clk, journal: async j => journals.push(structuredClone(j)), validateInputs: async () => ({ work: { dev: 1, ino: 2 }, inputs_sha256: "c".repeat(64), binaries_sha256: "d".repeat(64) }),
    inspectConfig: (actual, expected) => actual.Id === expected.id,
    measure: async () => true, finalize: async proof => { calls.push(["finalize", proof]); return { accounting: { complete: false }, native: "unknown" } } }
  return { calls, resources, journals, deps }
}

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

// The teardown's egress leg only: commands from the first egress rm onward (the
// creation-phase config inspect and everything before it are not the raced leg).
const egressTeardown = calls => { const commands = calls.filter(a => a[0] !== "finalize" && a[2] !== undefined); const first = commands.findIndex(a => a[2] === "network" && a[3] === "rm" && a.at(-1) === id(1)); return first < 0 ? [] : commands.slice(first) }
const egressRms = calls => egressTeardown(calls).filter(a => a[3] === "rm")

test("case (a): a first-try network removal is byte-identical — the same commands, no drain, no retry", async () => {
  const f = raced({ evictAfterMs: null })
  const result = await drive(containTrial(plan(), f.deps), f.deps.clock)
  assert.equal(result.cleanup_verified, true)
  assert.equal(f.calls.some(a => a[0] === "finalize"), true)
  assert.equal(f.resources.size, 0)
  assert.deepEqual(f.calls.filter(a => a[0] !== "finalize"), FIRST_TRY_SEQUENCE, "the command sequence is exactly the parent's")
  assert.equal(egressRms(f.calls).length, 1, "one rm for the egress network")
})

test("case (b): the first rm refuses with the in-use vocabulary and the network is gone at the retry — verified_gone:true", async () => {
  for (const stderrForm of ["in use", "endpoints"]) {
    const f = raced({ evictAfterMs: 250, stderrForm })
    const result = await drive(containTrial(plan(), f.deps), f.deps.clock)
    // Red at the parent: the single-rm path left the honest unverified state.
    assert.equal(result.cleanup_verified, true, `the drained retry verifies removal (${stderrForm})`)
    assert.equal(f.journals.at(-1).verified_gone, true)
    assert.equal(f.calls.some(a => a[0] === "finalize"), true)
    assert.equal(f.resources.size, 0)
    // One bounded drain and exactly ONE retry — no polling loop.
    assert.equal(egressRms(f.calls).length, 2, `exactly one retry rm (${stderrForm})`)
    assert.equal(egressTeardown(f.calls).length, 4, `one rm and one inspect per attempt (${stderrForm})`)
    // The commands before the raced leg are the parent's, and the containers' leg is untouched.
    const racedAt = f.calls.findIndex(a => a[2] === "network" && a[3] === "rm" && a.at(-1) === id(1))
    assert.deepEqual(f.calls.filter(a => a[0] !== "finalize").slice(0, racedAt), FIRST_TRY_SEQUENCE.slice(0, racedAt))
  }
})

test("case (c): both removals refuse — verified_gone:false exactly as today, one retry only", async () => {
  const f = raced({ evictAfterMs: Infinity })
  const result = await drive(containTrial(plan(), f.deps), f.deps.clock)
  assert.equal(result.cleanup_verified, false)
  assert.equal(f.journals.at(-1).verified_gone, false, "the honest unverified state, reachable and unchanged")
  assert.equal(f.calls.some(a => a[0] === "finalize"), false)
  assert.equal(egressRms(f.calls).length, 2, "exactly one retry — no polling loop")
  assert.equal(f.resources.size, 1, "the refused network is retained, never swept by name")
})

test("no other semantics: a daemon error on the presence check is never absence and never triggers the drain", async () => {
  const f = raced({ evictAfterMs: null, inspectError: true })
  const result = await drive(containTrial(plan(), f.deps), f.deps.clock)
  assert.equal(result.cleanup_verified, false, "a daemon error stays NOT verified-gone")
  assert.equal(egressRms(f.calls).length, 1, "no retry for an error that is neither in-use nor presence")
  assert.equal(f.calls.some(a => a[0] === "finalize"), false)
})
