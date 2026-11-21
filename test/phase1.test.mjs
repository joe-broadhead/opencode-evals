// The credentialed phase's gated order (G0 re-check, section D): each step only if the previous one passed, and a clear stop otherwise.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { STEPS, runPhase1, readState, entriesOf, STATE_FILE, pulseLinkVerdict, defaultDeps } from "../src/phase1.mjs"
import { writeHalt } from "../src/run/halt.mjs"
import { SIGNIN_ORDER, exportTarget, LOGIN_TARGET as WALK_TARGETS } from "../scripts/profile/profile-lib.mjs"
import { exportTarget as HARNESS_TARGET, LOGIN_TARGET as HARNESS_TARGETS } from "../scripts/profile/auth-targets.mjs"

const scratch = () => mkdtempSync(join(tmpdir(), "evals-phase1-"))
const ids = STEPS.map((s) => s.id)

/** Stand-in dependencies: every call is recorded, and any of them can be made to fail. */
function stand({ fail = {}, signedIn = ["linear", "slack"], github = "oauth" } = {}) {
  const calls = []
  const deps = {
    linksIn: () => [],
    assertDistinctPort: () => {
      if (fail.port) throw new Error("the evals profile's service port (49374) is the real service's")
    },
    signedIn: () => signedIn,
    checkReal: ({ integration }) => {
      calls.push(`check-real ${integration}`)
      return fail["check-real"] === integration ? { ok: false, line: `FAIL ${integration}: the evals profile holds the SAME access token` } : { ok: true, line: `PASS ${integration}` }
    },
    keepOnce: () => {
      calls.push("keeper")
      return signedIn.map((integration) => ({ integration, ok: fail.keeper !== integration, ...(fail.keeper === integration ? { why: "its token was due and its expiry did not move" } : {}) }))
    },
    seedCanaries: async () => {
      calls.push("canaries")
      if (fail.canaries) throw new Error("the canaries manifest is refused, nothing was created: container linear.production is not an alias in targets.json")
      return { created: ["linear_issue"], reused: ["slack_pinned_ts"] }
    },
    credentialType: () => github,
    logout: (ctx, vendor) => {
      calls.push(`logout ${vendor}`)
      return { ok: true, code: 0 }
    },
    probe: async (id, { only } = {}) => {
      calls.push(`${id}${only ? ` ${only}` : ""}`)
      const bad = fail[id] === (only ?? true)
      return { ok: !bad, checks: [{ ok: !bad, name: `${id} ${only ?? ""} check`, detail: "it failed" }] }
    },
    runBatch: async (options) => {
      calls.push(`pilot ${options.iteration}`)
      return { launched: 1, planned: 1, stopped: null, bad: 0 }
    },
  }
  return { deps, calls }
}

function world({ writes = ["slack", "linear"], reads = ["slack", "linear"], pilot = true } = {}) {
  const root = scratch()
  const store = join(root, "store")
  const profile = join(root, "profile")
  mkdirSync(store)
  mkdirSync(profile)
  writeFileSync(join(store, "targets.json"), "{}")
  writeFileSync(join(store, "live-writes.json"), JSON.stringify(Object.fromEntries(writes.map((p) => [p, { code: "x" }]))))
  writeFileSync(join(store, "live-reads.json"), JSON.stringify({ _note: "n", ...Object.fromEntries(reads.map((p) => [p, { code: "x" }])) }))
  if (pilot) writeFileSync(join(store, "pilot.json"), JSON.stringify([{ plugin: "history", iteration: "pilot-a", model: "claude-agent/haiku" }]))
  return { root, store, profile, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test("preflight: the pulse runtime link is accepted, a stale one is removed, and anything else refuses (the walk\'s rule)", async () => {
  const w = world()
  const pulse = join(w.profile, ".config", "pulse")
  mkdirSync(pulse, { recursive: true })
  const live = join("/tmp", `pulse-${randomBytes(4).toString("hex")}`)
  mkdirSync(live)
  const gone = join("/tmp", `pulse-${randomBytes(4).toString("hex")}`)
  const okLink = join(pulse, "abcdef-runtime")
  const staleLink = join(pulse, "123456-runtime")
  const badLink = join(pulse, "notruntime")
  symlinkSync(live, okLink)
  symlinkSync(gone, staleLink)
  symlinkSync("/home/elsewhere", badLink)
  try {
    const step = STEPS.find((s) => s.id === "preflight")
    assert.ok(step)
    const s = stand()
    // the verdict itself: exactly the shell's three cases
    assert.equal(pulseLinkVerdict(okLink, w.profile), "ok")
    assert.equal(pulseLinkVerdict(staleLink, w.profile), "stale")
    assert.equal(pulseLinkVerdict(badLink, w.profile), "refuse")
    const good = await step.run({ store: w.store, profile: w.profile, deps: { ...s.deps, linksIn: () => [okLink, staleLink] } })
    assert.equal(good.ok, true, good.message)
    assert.equal(existsSync(staleLink), false, "the stale link was removed")
    assert.equal(existsSync(okLink), true, "the legitimate one is kept")
    assert.match(good.lines.join("\n"), /removed the stale PulseAudio link/)
    const refused = await step.run({ store: w.store, profile: w.profile, deps: { ...s.deps, linksIn: () => [badLink] } })
    assert.equal(refused.ok, false)
    assert.match(refused.message, /a symbolic link under the profile: .*notruntime/)
  } finally {
    rmSync(live, { recursive: true, force: true })
    w.cleanup()
  }
})

test("signedIn: gws and Wispr Flow are found by their export target, and a missing SIGNIN_ORDER credential fails", async () => {
  const root = scratch()
  const profile = join(root, "profile")
  mkdirSync(profile)
  const bin = join(root, "opencode")
  const log = join(root, "calls.log")
  const bodyFor = (vendor) => {
    const integrationID = vendor === "gws" ? "gws-default" : vendor === "wisprflow" ? "mcp_abc123" : vendor
    const label = vendor === "gws" ? "default" : vendor === "wisprflow" ? "Wispr Flow" : vendor
    return JSON.stringify([{ id: "cred_x", integrationID, label, active: true, value: { type: "oauth" } }])
  }
  const writeStub = (available) => {
    const map = Object.fromEntries(SIGNIN_ORDER.map((v) => [exportTarget(v), available.includes(v) ? bodyFor(v) : "[]"]))
    writeFileSync(bin, `#!${process.execPath}\nconst a = process.argv.slice(2)\nconst fs = require("fs")\nfs.appendFileSync(${JSON.stringify(log)}, [process.env.HOME, ...a].join(" ") + "\\n")\nif (a[0] === "auth" && a[1] === "export") { console.log(${JSON.stringify(map)}[a[2]] || "[]"); process.exit(0) }\nprocess.exit(0)\n`, { mode: 0o700 })
  }
  const caller = { EVALS_REAL_HOME: root, HOME: root, PATH: process.env.PATH }
  const ctx = { opencode: bin, profile, caller, noAccount: new Set(), store: join(root, "store") }
  try {
    writeStub([...SIGNIN_ORDER])
    const deps = await defaultDeps({ store: ctx.store, caller, companions: [] })
    const all = deps.signedIn(ctx)
    assert.ok(all.includes("gws"), "gws-default is found")
    assert.ok(all.includes("wisprflow"), "the Wispr Flow label is found")
    assert.equal(all.length, SIGNIN_ORDER.length)
    assert.equal(deps.credentialType(ctx, "gws"), "oauth", "credentialType uses the export target")
    assert.equal(deps.logout(ctx, "gws").ok, true)
    assert.match(readFileSync(log, "utf8"), /auth logout gws-default/)
    // a vendor the walk was supposed to sign in must fail, not be skipped
    writeStub(SIGNIN_ORDER.filter((v) => v !== "gws"))
    const d2 = await defaultDeps({ store: ctx.store, caller, companions: [] })
    assert.throws(() => d2.signedIn(ctx), /the evals profile holds no credential for gws: sign it in with signin\.sh --from gws/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const run = async (w, s, extra = {}, options = {}) => {
  const lines = []
  const ctx = { store: w.store, caller: { EVALS_ROUND_CEILING_USD: "10" }, opencode: "oc", profile: w.profile, vendors: [], logout: null, pilot: false, confirmLabels: false, deps: s.deps, ...extra }
  const result = await runPhase1({ store: w.store, ctx, log: (l) => lines.push(l), ...options })
  return { ...result, lines }
}

test("the order is section D's: sign-in checks, keeper, the canaries, logout, egress, live writes, gws, the paid pilot last", () => {
  assert.deepEqual(ids, ["preflight", "check-real", "keeper", "canaries", "p6c", "p7", "live", "gws", "pilot"])
  for (const step of STEPS) assert.ok(step.title && step.needs, step.id)
})

test("every step runs, in order, when each passes; a step needing a person stops the sequence at the pilot with what to do", async () => {
  const w = world()
  const s = stand()
  try {
    const r = await run(w, s)
    assert.equal(r.ok, false)
    assert.equal(r.stopped.id, "pilot")
    assert.equal(r.stopped.manual, true)
    assert.match(r.stopped.message, /THE LEAD'S STEP: the pilot spends money/)
    assert.deepEqual(s.calls, ["check-real linear", "check-real slack", "keeper", "canaries", "p7 slack", "p7 linear", "live slack", "live linear", "gws"], "the canaries are planted after the sign-ins and before any probe or case; p6c skips (no --logout); the one-plugin-at-a-time probes run in the file's order")
    assert.deepEqual(r.ran.map((x) => x.id), ids)
    assert.ok(r.lines.some((l) => /nothing after pilot ran/.test(l)))
    const state = readState(w.store)
    assert.deepEqual(Object.keys(state.steps).filter((k) => state.steps[k].ok), ids.slice(0, -1))
    // with the lead's confirmation, a ceiling and a plan, the pilot runs
    const done = await run(w, s, { pilot: true, confirmLabels: true }, { from: "pilot" })
    assert.equal(done.ok, true, JSON.stringify(done.stopped))
    assert.ok(s.calls.includes("pilot pilot-a"))
    assert.match(done.lines.at(-1), /every step passed/)
  } finally {
    w.cleanup()
  }
})

test("the first failure stops everything after it, with the sentence that says what to do", async () => {
  const cases = [
    [{ port: true }, "preflight", /service port \(49374\) is the real service's/],
    [{ "check-real": "slack" }, "check-real", /check-real failed for slack: sign the real profile back in for slack and sign in NO further vendor/],
    [{ keeper: "linear" }, "keeper", /the keeper failed for linear/],
    [{ canaries: true }, "canaries", /the canaries manifest is refused, nothing was created: container linear\.production is not an alias/],
    [{ p7: "linear" }, "p7", /P0-7 failed for linear/],
    [{ live: "slack" }, "live", /the live write probe failed for slack: .*A completed write is a HALT/],
    [{ gws: true }, "gws", /the gws plan-and-commit failed/],
  ]
  for (const [fail, id, message] of cases) {
    const w = world()
    const s = stand({ fail })
    try {
      const r = await run(w, s)
      assert.equal(r.ok, false, id)
      assert.equal(r.stopped.id, id)
      assert.match(r.stopped.message, message)
      const after = ids.slice(ids.indexOf(id) + 1)
      assert.deepEqual(r.ran.map((x) => x.id), ids.slice(0, ids.indexOf(id) + 1), `nothing after ${id} ran`)
      assert.ok(r.lines.some((l) => new RegExp(`nothing after ${id} ran`).test(l)))
      assert.equal(readState(w.store).steps[id].ok, false)
      for (const later of after) assert.equal(readState(w.store).steps[later], undefined, `${later} left no mark`)
    } finally {
      w.cleanup()
    }
  }
  // inside a step, the first failing vendor or plugin stops the rest of that step
  const w = world()
  const s = stand({ fail: { "check-real": "linear" } })
  try {
    await run(w, s)
    assert.deepEqual(s.calls, ["check-real linear"], "slack was never checked after linear failed")
  } finally {
    w.cleanup()
  }
  const w2 = world()
  const s2 = stand({ fail: { live: "slack" } })
  try {
    await run(w2, s2)
    assert.equal(s2.calls.includes("live linear"), false, "linear's write was never tried after slack's failed")
  } finally {
    w2.cleanup()
  }
})

test("a step cannot run before the ones ahead of it have passed, and a stopped run resumes where it stopped", async () => {
  const w = world()
  const s = stand({ fail: { keeper: "slack" } })
  try {
    const skip = await run(w, s, {}, { from: "p7" })
    assert.equal(skip.ok, false)
    assert.match(skip.stopped.message, /step p7 needs preflight to have passed first \(it has not\)/)
    assert.deepEqual(s.calls, [], "nothing ran")
    assert.deepEqual((await run(w, s, {}, { only: "live" })).stopped.id, "preflight")
    const first = await run(w, s)
    assert.equal(first.stopped.id, "keeper")
    // fixed: resume from the failed step, not from the start
    const fixed = stand()
    const callsBefore = s.calls.length
    const resumed = await run(w, fixed, {}, { from: "keeper" })
    assert.equal(resumed.stopped.id, "pilot")
    assert.equal(fixed.calls.includes("check-real linear"), false, "the steps before keeper were not repeated")
    assert.ok(callsBefore > 0)
    // --reset forgets what passed
    const reset = await run(w, stand(), {}, { from: "gws", reset: true })
    assert.match(reset.stopped.message, /needs preflight to have passed first/)
  } finally {
    w.cleanup()
  }
})

test("a HALT in the store stops the sequence before the next step, and in the middle of a step", async () => {
  const w = world()
  const s = stand()
  try {
    writeHalt(w.store, { reason: "slack_send_message completed outside commit mode", batch: "b1", trial: "t.t1" })
    const r = await run(w, s)
    assert.equal(r.ok, false)
    assert.match(r.stopped.message, /the wave is halted: slack_send_message completed/)
    assert.deepEqual(s.calls, [])
    rmSync(join(w.store, "HALT"))
    // a write that completes in the first plugin's live probe halts before the second plugin's
    const s2 = stand()
    const probe = s2.deps.probe
    s2.deps.probe = async (id, extra) => {
      const out = await probe(id, extra)
      if (id === "live" && extra.only === "slack") writeHalt(w.store, { reason: "slack_send_message completed", writes: [{ tool: "slack_send_message" }] })
      return out
    }
    const r2 = await run(w, s2)
    assert.equal(r2.stopped.id, "live")
    assert.match(r2.stopped.message, /the wave is halted/)
    assert.equal(s2.calls.includes("live linear"), false)
  } finally {
    w.cleanup()
  }
})

test("preflight refuses a missing profile, a link, a missing targets file; check-real, keeper and p7 name what they lack", async () => {
  const w = world()
  try {
    const s = stand()
    assert.match((await run(w, s, { profile: join(w.root, "nowhere") })).stopped.message, /does not exist: run evals-profile\.sh once/)
    s.deps.linksIn = () => [join(w.profile, "link")]
    assert.match((await run(w, s, {}, { reset: true })).stopped.message, /a symbolic link under the profile/)
    rmSync(join(w.store, "targets.json"))
    s.deps.linksIn = () => []
    assert.match((await run(w, s, {}, { reset: true })).stopped.message, /targets\.json does not exist/)
    writeFileSync(join(w.store, "targets.json"), "{}")
    const none = stand({ signedIn: [] })
    assert.match((await run(w, none, {}, { reset: true })).stopped.message, /holds no signed-in vendor/)
    rmSync(join(w.store, "live-reads.json"))
    assert.match((await run(w, stand(), {}, { reset: true })).stopped.message, /live-reads\.json names no plugin/)
  } finally {
    w.cleanup()
  }
})

test("the logout runs only when asked, and the pilot needs a ceiling", async () => {
  const w = world()
  try {
    const s = stand({ github: "key" })
    const r = await run(w, s, { logout: "ashby" }, { only: "p6c", reset: false })
    assert.equal(r.stopped.id, "preflight")
    await run(w, s)
    const asked = await run(w, s, { logout: "ashby" }, { only: "p6c" })
    assert.equal(asked.ok, true)
    assert.ok(s.calls.includes("logout ashby"))
    const noCeiling = await run(w, s, { pilot: true, confirmLabels: true, caller: {} }, { only: "pilot" })
    assert.match(noCeiling.stopped.message, /no EVALS_ROUND_CEILING_USD/)
  } finally {
    w.cleanup()
  }
})

test("entriesOf reads a live-*.json file's plugins in order, and `evals phase1 --dry-run` prints the order with no credential and runs nothing", () => {
  const w = world({ writes: ["b", "a"] })
  try {
    assert.deepEqual(entriesOf(w.store, "live-writes.json"), ["b", "a"])
    assert.deepEqual(entriesOf(w.store, "live-reads.json"), ["slack", "linear"], "_note is not a plugin")
    assert.deepEqual(entriesOf(w.store, "absent.json"), [])
    const out = spawnSync(process.execPath, [join(import.meta.dirname, "..", "bin", "evals"), "phase1", "--dry-run"], { encoding: "utf8", env: { PATH: process.env.PATH, EVALS_STORE: w.store, HOME: w.root } })
    assert.equal(out.status, 0, out.stderr)
    assert.match(out.stdout, /the gated order \(each step runs only if the one before it passed\)/)
    for (const id of ids) assert.match(out.stdout, new RegExp(`\\d\\. ${id}`))
    assert.equal(existsSync(join(w.store, STATE_FILE)), false, "a dry run leaves no mark")
  } finally {
    w.cleanup()
  }
})

test("the canaries step: lines say what was created and reused; no seeding configured, or no manifest, is a visible skip, never a failure", async () => {
  const w = world()
  const s = stand()
  try {
    const early = await run(w, s, {}, { only: "canaries" })
    assert.equal(early.ok, false)
    assert.match(early.stopped.message, /step canaries needs preflight to have passed first/, "it needs the sign-ins before it")
    assert.deepEqual(s.calls, [], "and plants nothing")
  } finally {
    w.cleanup()
  }
  const all = world()
  const t = stand()
  try {
    const r = await run(all, t, {}, {})
    assert.deepEqual(r.ran.find((x) => x.id === "canaries").lines, ["created linear_issue", "reused  slack_pinned_ts"])
    // no dependency at all: skipped, and the sequence goes on
    const bare = stand()
    delete bare.deps.seedCanaries
    const again = await run(world({}), bare, {}, { reset: true })
    assert.match(again.ran.find((x) => x.id === "canaries").lines.join(" "), /skipped: no canary seeding in this run/)
    assert.equal(again.ran.find((x) => x.id === "canaries").ok, true)
  } finally {
    all.cleanup()
  }
  // the real dependency, with no manifest: skipped with the path it looked at
  const { defaultDeps } = await import("../src/phase1.mjs")
  const w2 = world()
  try {
    const deps = await defaultDeps({ store: w2.store, caller: {}, companions: null })
    const out = await deps.seedCanaries({ store: w2.store, profile: w2.profile, opencode: "oc", caller: { EVALS_CANARIES_MANIFEST: join(w2.root, "none.json") } })
    assert.match(out.skipped, /no canaries manifest at .*none\.json: every case that names a canary is deferred/)
  } finally {
    w2.cleanup()
  }
})

test("the walk and the harness ask auth export for the same vendor names", () => {
  assert.equal(exportTarget, HARNESS_TARGET, "one function, re-exported by the walk")
  assert.deepEqual(WALK_TARGETS, HARNESS_TARGETS)
  assert.equal(exportTarget("gws"), "gws-default")
  assert.equal(exportTarget("wisprflow"), "Wispr Flow")
  assert.equal(exportTarget("affinity"), "affinity", "an MCP vendor is asked for by its server name")
})
