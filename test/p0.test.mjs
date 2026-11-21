// The P0 probes G0 rests on (EVALS-232 §1.5, §1.7), run for real: the harness's scripted model, no credential, every trial in
// the harness's container. They need Docker with the sandbox image, an OpenCode 2.3.x binary and bun; the ones that install
// all 24 plugins also need their builds (EVALS_COMPANIONS: a map from plugin id to a built directory). A probe that cannot run
// says why instead of passing. The first two groups run with no builds at all.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { PROBES, probeCaller, fullArm, soloArm, egressVerdict } from "../src/p0/probes.mjs"
import { sealedConfig } from "../src/run/sandbox.mjs"
import { readCompanions } from "../src/run/arm.mjs"
import { scriptedRun } from "../src/p0/run.mjs"
import { defaultDeps, STEPS } from "../src/phase1.mjs"
import { ledgerFile } from "../src/cost/ledger.mjs"
import { readHalt, writeHalt } from "../src/run/halt.mjs"
import { findBinary, imageTag } from "../src/run/container.mjs"
import { buildPolicy } from "../src/run/guard/policy.mjs"
import { decideBefore, planIdOf, judgePlan, matchWrite, pick, loadPolicy } from "../src/run/guard/logic.mjs"
import { lockdownPolicies, lockdownPermissions, lockdownProblems, writeActions, loadPacks, LOCKED_TOOLS, COMPANION_CAPS, companionOptions, CONFIRM_ONLY_READS, CAPPED_SPEND_READS } from "../src/run/lockdown.mjs"

const reason = (() => {
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" })
  if (docker.status !== 0) return "docker is not usable"
  if (spawnSync("docker", ["image", "inspect", imageTag()], { encoding: "utf8" }).status !== 0) return "the sandbox image is not built"
  const bin = process.env.EVALS_OPENCODE_BIN ?? process.env.OPENCODE_BIN_2_3_2 ?? findBinary("opencode")
  if (!bin) return "no opencode binary (EVALS_OPENCODE_BIN or OPENCODE_BIN_2_3_2)"
  const version = spawnSync(bin, ["--version"], { encoding: "utf8" }).stdout
  if (!/v?2\.3\./.test(version)) return `opencode ${version.trim()} is not 2.3.x: the lockdown was proved on 2.3.2`
  if (!findBinary(process.env.EVALS_BUN ?? "bun")) return "no bun (EVALS_BUN)"
  return null
})()
const companions = process.env.EVALS_COMPANIONS && existsSync(process.env.EVALS_COMPANIONS) ? process.env.EVALS_COMPANIONS : null
// The live probes start batches of containers, and the isolation tests count every container and `docker exec` client on the host:
// run in the same pass they would see each other's. So they are opt-in (EVALS_P0_LIVE=1, or `evals p0`), and a pass that runs
// them should run this file alone: `EVALS_P0_LIVE=1 node --test --test-concurrency=1 test/p0.test.mjs`.
const optIn = process.env.EVALS_P0_LIVE ? null : "the live probes are opt-in (EVALS_P0_LIVE=1, or `node bin/evals p0`): they share the Docker host with the isolation tests"

test("the arm's companions-map options reach its sealed config; explicit options win and companions keep theirs", () => {
  const root = mkdtempSync(join(tmpdir(), "evals-p0-arm-"))
  const build = join(root, "affinity")
  mkdirSync(join(build, "dist"), { recursive: true })
  writeFileSync(join(build, "package.json"), JSON.stringify({ name: "@demo/affinity", version: "0.0.1" }))
  writeFileSync(join(build, "dist", "index.js"), "export default {}\n")
  const companions = join(root, "companions.json")
  writeFileSync(companions, JSON.stringify({ affinity: { package: build, options: { clientId: "dedicated-client-id", access: "all" } }, slack: { package: build, options: { access: "ask-changes" } } }))
  try {
    assert.deepEqual(fullArm(companions, { arm: "affinity" }).options, { clientId: "dedicated-client-id", access: "all" }, "the map's options are the arm's")
    assert.deepEqual(fullArm(companions, { arm: "affinity", options: { access: "ask-changes" } }).options, { clientId: "dedicated-client-id", access: "ask-changes" }, "the probe's explicit option wins")
    assert.deepEqual(soloArm(companions, "affinity", { access: "all" }).options, { clientId: "dedicated-client-id", access: "all" })
    assert.deepEqual(sealedConfig({ armDir: build, options: fullArm(companions, { arm: "affinity" }).options, model: "mock/m1" }).plugins[0].options, { clientId: "dedicated-client-id", access: "all" }, "the sealed config carries them")
    assert.deepEqual(readCompanions({ slack: { package: build, options: { access: "ask-changes" } } }, {}).map((entry) => entry.extra), [{ access: "ask-changes" }], "a companion's own options are kept")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("p7 judges only the plugin's own pack hosts: companions and no-client-hello are info", () => {
  const egress = {
    refused: {
      "mcp.slack.com": { count: 1, why: ["not-allowed"] },
      "slack.com": { count: 2, why: ["no-client-hello"] },
      "mcp.atlassian.com": { count: 1, why: ["not-allowed"] },
      "api.githubcopilot.com": { count: 1, why: ["not-allowed"] },
      "quiet.example": { count: 1, why: ["no-client-hello"] },
    },
  }
  const verdict = egressVerdict({ id: "slack", egress })
  assert.deepEqual(verdict.refused.map((entry) => entry.host), ["mcp.slack.com"], "only its own pack host, with its why")
  assert.deepEqual(verdict.refused[0].why, ["not-allowed"])
  assert.deepEqual(verdict.quiet.sort(), ["quiet.example", "slack.com"], "a silent tunnel is not a refusal, in or out of the pack")
  assert.deepEqual(verdict.outside.map((entry) => entry.host).sort(), ["api.githubcopilot.com", "mcp.atlassian.com"], "a companion's hosts are recorded, not judged")
  // A URL in the plugin's own read is an explicit host to judge.
  const explicit = egressVerdict({ id: "slack", code: "return await tools.slack.x({ url: 'https://auth.slack.com/oauth' })", egress: { refused: { "auth.slack.com": { why: ["not-allowed"] } } } })
  assert.deepEqual(explicit.refused.map((entry) => entry.host), ["auth.slack.com"])
  assert.equal(explicit.outside.length, 0)
})

test("p7's check passes on a companion's refused host and a silent tunnel, and fails on its own pack's host", async () => {
  const root = mkdtempSync(join(tmpdir(), "evals-p0-p7-egress-"))
  const store = join(root, "store")
  mkdirSync(store, { recursive: true })
  writeFileSync(join(store, "targets.json"), "{}")
  writeFileSync(join(store, "live-reads.json"), JSON.stringify({ slack: { code: "return 1" } }))
  const build = join(root, "slack")
  mkdirSync(join(build, "dist"), { recursive: true })
  writeFileSync(join(build, "package.json"), JSON.stringify({ name: "@demo/slack", version: "0.0.1" }))
  writeFileSync(join(build, "dist", "index.js"), "export default {}\n")
  const companions = join(root, "companions.json")
  writeFileSync(companions, JSON.stringify({ slack: build }))
  const caller = { EVALS_PROFILE: "/profile" }
  const result = (refused) => async () => ({
    trials: { "tools-live-read-slack": { calls: [{ status: "completed", output: "ok" }], summary: { guard: { committed: 0, write_calls: 0, assert_committed: 0 } } } },
    egress: { allowed: {}, refused },
    cleanup: () => {},
  })
  try {
    const info = await PROBES.p7({ store, companions, caller, tmp: root, scriptedRun: result({ "mcp.atlassian.com": { count: 1, why: ["not-allowed"] }, "slack.com": { count: 1, why: ["no-client-hello"] } }) })
    assert.equal(info.ok, true, JSON.stringify(info.checks.filter((check) => !check.ok)))
    assert.ok(info.checks.some((check) => /companion's host outside its pack/.test(check.name)), "a companion's host is info")
    assert.ok(info.checks.some((check) => /closed before its ClientHello/.test(check.name)), "a silent tunnel is info")
    const own = await PROBES.p7({ store, companions, caller, tmp: root, scriptedRun: result({ "mcp.slack.com": { count: 1, why: ["not-allowed"] } }) })
    assert.equal(own.ok, false, "its own pack's refused host fails")
    assert.ok(own.checks.some((check) => check.ok === false && /own pack/.test(check.name)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("live, p7 and gws hand their batch the owner's store and caps", async () => {
  const root = mkdtempSync(join(tmpdir(), "evals-p0-probes-"))
  const store = join(root, "store")
  mkdirSync(store, { recursive: true })
  writeFileSync(join(store, "caps.json"), JSON.stringify({ vendors: { demo_calls: 5 } }))
  writeFileSync(join(store, "targets.json"), "{}")
  writeFileSync(join(store, "live-reads.json"), JSON.stringify({ demo: { code: "return 1" } }))
  writeFileSync(join(store, "live-writes.json"), JSON.stringify({ demo: { code: "return 1" } }))
  writeFileSync(join(store, "live-gws.json"), JSON.stringify({ code: "return 1", plan: {} }))
  const build = join(root, "build")
  mkdirSync(join(build, "dist"), { recursive: true })
  writeFileSync(join(build, "package.json"), JSON.stringify({ name: "@demo/p", version: "0.0.1" }))
  writeFileSync(join(build, "dist", "index.js"), "export default {}\n")
  const companions = join(root, "companions.json")
  writeFileSync(companions, JSON.stringify({ demo: build, gws: build }))
  const caller = { EVALS_PROFILE: "/profile" }
  try {
    for (const [id, only] of [["p7", "demo"], ["live", "demo"], ["gws", null]]) {
      const seen = []
      const stub = (options) => {
        seen.push({ ownerStore: options.ownerStore })
        return scriptedRun({
          ...options,
          run: async (batch, ctx) => {
            seen[seen.length - 1].caller = ctx.caller
            throw new Error("stop here")
          },
        })
      }
      await assert.rejects(PROBES[id]({ store, companions, caller, tmp: root, ...(only ? { only } : {}), scriptedRun: stub }), /stop here/)
      assert.equal(seen.length, 1, `${id}: one batch`)
      assert.equal(seen[0].ownerStore, store, `${id}: the owner's store, not a scratch one`)
      assert.equal(seen[0].caller.EVALS_STORE, store, `${id}: EVALS_STORE is the owner's`)
      assert.equal(seen[0].caller.EVALS_CAPS, join(store, "caps.json"), `${id}: the owner's caps file`)
      assert.equal(seen[0].caller.EVALS_RAW.startsWith(root), true, `${id}: recordings stay scratch`)
    }
    // H2: the effective store and its ledger are returned, not the scratch ones.
    const out = await scriptedRun({ cases: [], arm: { package: "none" }, ownerStore: store, caller: { EVALS_STORE: store }, tmp: root, run: async () => ({ results: [] }) })
    assert.equal(out.store, store)
    assert.deepEqual(out.ledger, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a HALT written in an owner-store batch survives cleanup and stops phase 1's live step", async () => {
  const root = mkdtempSync(join(tmpdir(), "evals-p0-halt-"))
  const store = join(root, "store")
  mkdirSync(store, { recursive: true })
  writeFileSync(join(store, "caps.json"), "{}")
  writeFileSync(join(store, "live-writes.json"), JSON.stringify({ demo: { code: "return 1" } }))
  const caller = { EVALS_STORE: store, EVALS_CAPS: join(store, "caps.json"), EVALS_PROFILE: "/profile" }
  try {
    await assert.rejects(
      scriptedRun({
        cases: [],
        arm: { package: "none" },
        ownerStore: store,
        caller,
        tmp: root,
        run: async (batch, ctx) => {
          writeHalt(ctx.caller.EVALS_STORE, { reason: "a write completed", batch: "test", trial: "demo.t1" })
          throw new Error("halted")
        },
      }),
      /halted/,
    )
    // The probe's own cleanup removes its scratch root; the HALT is in the owner's store and survives it.
    for (const entry of readdirSync(root)) if (entry !== "store") rmSync(join(root, entry), { recursive: true, force: true })
    assert.equal(readHalt(store)?.reason, "a write completed", "the HALT is in the real store, not the scratch one")
    let called = 0
    const step = STEPS.find((s) => s.id === "live")
    const out = await step.run({ store, profile: "/profile", caller, noAccount: new Set(), deps: { probe: async () => { called++; return { ok: true, checks: [] } } } })
    assert.equal(out.ok, false, "phase 1's next live step stops")
    assert.match(out.message, /the wave is halted: a write completed/)
    assert.equal(called, 0, "the probe is not asked again")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a vendor probe's batch uses the owner's store for caps and the ledger, with its recordings in the probe's own raw", async () => {
  const root = mkdtempSync(join(tmpdir(), "evals-p0-owner-"))
  const owner = join(root, "store")
  mkdirSync(owner, { recursive: true })
  writeFileSync(join(owner, "caps.json"), JSON.stringify({ vendors: { affinity_calls: 300 } }))
  let seen = null
  try {
    await assert.rejects(
      scriptedRun({
        cases: [{ id: "one", prompt: "hello" }],
        arm: { package: "none" },
        ownerStore: owner,
        caller: { EVALS_PROFILE: "/profile" },
        tmp: root,
        run: async (options, ctx) => {
          seen = { options, caller: ctx.caller }
          throw new Error("stop here")
        },
      }),
      /stop here/,
    )
    assert.equal(seen.caller.EVALS_STORE, owner, "the real store: caps, targets, data-matrix, canaries and the ledger")
    assert.equal(seen.caller.EVALS_CAPS, join(owner, "caps.json"), "the owner's caps file")
    assert.equal(ledgerFile(seen.caller.EVALS_STORE), join(owner, "ledger", "runs.jsonl"), "the vendor spend is recorded in the round's ledger")
    assert.equal(seen.caller.EVALS_RAW.startsWith(root), true, "the recordings stay in the probe's scratch tree")
    assert.notEqual(seen.caller.EVALS_RAW, join(owner, "raw"), "never the owner's raw directory")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a direct p0 run gives the vendor probes the process environment, and phase 1 gives them its caller", async () => {
  const direct = probeCaller({ store: "/store" }, "plugin")
  assert.equal(direct.EVALS_PROFILE, "plugin")
  assert.equal(direct.PATH, process.env.PATH, "a direct `evals p0 p7` has only the process environment")
  const explicit = probeCaller({ caller: { EVALS_CAPS: "/caps", EVALS_STORE: "/owner" } }, "plugin")
  assert.deepEqual(explicit, { EVALS_PROFILE: "plugin", EVALS_CAPS: "/caps", EVALS_STORE: "/owner" }, "phase 1's caller wins")
  const store = "/owner"
  const caller = { EVALS_CAPS: "/caps", EVALS_STORE: store }
  let seen = null
  const deps = await defaultDeps({ store, caller, companions: null, probes: { p7: (env) => { seen = env; return { ok: true, checks: [] } } } })
  assert.deepEqual(await deps.probe("p7", { only: "affinity" }), { ok: true, checks: [] })
  assert.equal(seen.store, store)
  assert.equal(seen.caller, caller)
  assert.equal(seen.only, "affinity")
})

const live = reason ? { skip: reason } : optIn ? { skip: optIn } : {}
const needsBuilds = reason ? { skip: reason } : optIn ? { skip: optIn } : companions ? {} : { skip: "no plugin builds (EVALS_COMPANIONS)" }
const env = { companions, tmp: process.env.TMPDIR }

const show = (result) => result.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("\n")

// ------------------------------------------------------------------------------------------------ the pure parts

test("the lockdown config denies every locked tool as a permission and as a policy, and asks every write", () => {
  const config = { policies: lockdownPolicies(), permissions: lockdownPermissions() }
  assert.deepEqual(lockdownProblems(config), [])
  // The first lock is the blanket permission deny of the tool's own name: that is what removes it from the model's list.
  for (const tool of LOCKED_TOOLS) assert.ok(config.permissions.some((p) => p.action === tool && p.resource === "*" && p.effect === "deny"), tool)
  // The second is the policy, whose resource is `<tool>:<input>`: `shell` alone matches nothing.
  for (const tool of LOCKED_TOOLS) assert.ok(config.policies.some((p) => p.action === "tool.use" && p.resource === `${tool}:*` && p.effect === "deny"), tool)
  assert.equal(config.policies.some((p) => p.action === "tool.use" && p.resource === "shell"), false, "the plan's bare resource matches nothing")
  const asks = config.permissions.filter((p) => p.effect === "ask").map((p) => p.action)
  for (const action of writeActions()) assert.ok(asks.includes(action), action)
  for (const action of CONFIRM_ONLY_READS) assert.ok(asks.includes(action), action)
  // Every one of the packs' write tools is in it, and no read is.
  for (const pack of loadPacks()) for (const tool of pack.tools) if (tool.class === "read" && !CONFIRM_ONLY_READS.includes(tool.permission)) assert.equal(asks.includes(tool.permission), false, tool.permission)
  // The commit set turns only its own named actions into allow.
  const commit = lockdownPermissions({ commit: ["slack_slack_send_message"] })
  assert.equal(commit.filter((p) => p.action === "slack_slack_send_message").pop().effect, "allow")
  assert.equal(commit.filter((p) => p.action === "slack_slack_send_dm").pop()?.effect ?? "ask", "ask")
  assert.deepEqual(lockdownProblems({ policies: [], permissions: [] }).length > 400, true, "an empty config fails the check")
  assert.match(lockdownProblems({ policies: config.policies, permissions: config.permissions.filter((p) => p.action !== "glob") }).join(";"), /tool glob is not denied as a permission/)
})

test("every companion is at ask-changes with its caps; ElevenLabs takes the lowest cap the plugin accepts", () => {
  assert.deepEqual(companionOptions("slack"), { access: "ask-changes" })
  assert.deepEqual(companionOptions("x"), { scriptBudgetUsd: 0.25, scriptDailyBudgetUsd: 5, access: "ask-changes" })
  // The plugin refuses 0 (found by probe P0-A2: "must be a whole number of credits, or null for no cap, found 0").
  assert.deepEqual(companionOptions("elevenlabs"), { sessionCreditCap: 1, dailyCreditCap: 1, access: "ask-changes" })
  assert.equal(companionOptions("slack", { access: "all" }).access, "ask-changes", "an arm file cannot raise it")
  assert.equal(COMPANION_CAPS.elevenlabs.sessionCreditCap >= 1, true)
})

test("the guard's policy lists every write tool of the packs under names that cannot match a host tool or another plugin's read", () => {
  const policy = buildPolicy()
  // every write-class tool of the packs bar the metered spending reads (the one exception, allowed in a trial whatever class a pack gives them)
  const expected = new Set(loadPacks().flatMap((p) => p.tools).filter((t) => t.class === "write" && !CAPPED_SPEND_READS.includes(t.permission)).map((t) => t.permission))
  assert.equal(policy.writes.length, expected.size)
  assert.equal(policy.actions.length, policy.writes.length)
  for (const bare of ["write", "execute", "send", "delete", "read", "shell"]) assert.equal(matchWrite(policy, bare), null, `bare ${bare}`)
  assert.ok(matchWrite(policy, "gws_write"))
  assert.ok(matchWrite(policy, "slack_send_message"))
  assert.ok(matchWrite(policy, "jobs_create"))
  assert.equal(matchWrite(policy, "jobs_list"), null)
})

test("the guard's decisions: outside the commit set nothing is refused at execute.before (the ask is), inside it only in-scope writes pass", () => {
  const writes = [{ names: ["slack_send_message"], action: "slack_slack_send_message", extract: "args.channel_id", allow: ["C0SANDBOX"] }, { names: ["linear_save_issue"], action: "linear_save_issue" }]
  const base = { writes, actions: ["slack_slack_send_message", "linear_save_issue"] }
  // refuse mode: leave it to the ask, so a write is graded as asked and declined
  assert.equal(decideBefore({ ...base, mode: "refuse" }, "slack_send_message", { channel_id: "C0ELSEWHERE" }).pass, true)
  assert.equal(decideBefore({ ...base, mode: "refuse" }, "slack_send_message", {}).why, "left to the ask")
  // commit mode: the declared extractor and an allowed target
  const commit = { ...base, mode: "commit" }
  assert.equal(decideBefore(commit, "slack_send_message", { channel_id: "C0SANDBOX" }).pass, true)
  assert.equal(decideBefore(commit, "slack_send_message", { channel_id: "C0ELSEWHERE" }).why, "a target outside the sandbox")
  assert.equal(decideBefore(commit, "slack_send_message", {}).why, "no target in the call")
  assert.equal(decideBefore(commit, "slack_send_message", { channel_id: ["C0SANDBOX", "C0OTHER"] }).pass, false, "a list with one outside target")
  assert.equal(decideBefore(commit, "linear_save_issue", { team: "x" }).why, "no target extractor declared for this write", "deny by default: no extractor, no commit")
  assert.equal(decideBefore(commit, "linear_list_issues", {}).pass, true, "a read is not the guard's")
  assert.equal(pick({ a: { b: ["x", "y"] } }, "args.a.b.1"), "y")
  assert.equal(loadPolicy("/nonexistent/guard.json").mode, "refuse", "an unreadable policy refuses")
  assert.deepEqual(judgePlan({ plans: { targetPaths: ["args.params.fileId"], allow: ["F1"] } }, { params: { fileId: "F1" } }), { ok: true, targets: 1 })
  assert.equal(judgePlan({ plans: { targetPaths: ["args.params.fileId"], allow: ["F1"] } }, { params: { fileId: "F2" } }).ok, false)
  assert.equal(judgePlan({ plans: { targetPaths: ["args.params.fileId"], allow: ["F1"] } }, {}).ok, false, "a plan with no readable target is out of scope")
  assert.equal(planIdOf({ planId: "p1" }), "p1")
})

// ------------------------------------------------------------------------------------------------ the probes

test("P0-A1: the shell, file, web and subagent tools are absent or denied; a curl and an auth.json read are refused; no egress; the canary leaks nowhere", live, async () => {
  const result = await PROBES.a1(env)
  assert.equal(result.ok, true, show(result))
  assert.ok(result.checks.length >= 20)
})

test("P0-A1 mutation: with the lockdown off (the shell on), a write that COMPLETES fails the a1 check, and its refusal words in the output do not save it", live, async () => {
  const { scriptedRun, mock } = await import("../src/p0/run.mjs")
  const { refusalCheck } = await import("../src/p0/probes.mjs")
  const run = await scriptedRun({
    cases: [
      { id: "shell-write", prompt: mock("shell", { command: "echo 'EVALS-ASSERT tool: shell refused (not really)' > /tmp/x && cat /tmp/x" }), extra: "- Set: local" },
      { id: "shell-words", prompt: mock("shell", { command: "echo Permission denied" }), extra: "- Set: local" },
    ],
    arm: { package: "none" },
    options: { auth: "none", iteration: "p0-a1-mutation", tools: "local", set: "local" },
    tmp: env.tmp,
  })
  try {
    for (const id of ["shell-write", "shell-words"]) {
      const check = refusalCheck(id, run.trials[id])
      assert.equal(run.trials[id].calls[0]?.status, "completed", `${id}: the call completed in this arm`)
      assert.equal(check.ok, false, `${id}: a completed call fails the check: ${check.detail}`)
      assert.match(check.detail, /COMPLETED/)
    }
  } finally {
    run.cleanup()
  }
})

test("a trial whose client makes no model request is killed at its deadline and recorded as infrastructure (no_model_request), and the probe says so first", live, async () => {
  const { scriptedRun, mock, hungReason, takeHung } = await import("../src/p0/run.mjs")
  takeHung()
  // a deadline of one millisecond: no healthy trial has asked its model by then, so this is the hang, on demand
  const run = await scriptedRun({ cases: [{ id: "hang", prompt: mock("shell", { command: "id" }) }], arm: { package: "none" }, caller: { EVALS_FIRST_REQUEST_S: "0.001" }, options: { auth: "none", iteration: "p0-hang" }, tmp: env.tmp })
  try {
    const summary = run.trials.hang.summary
    assert.equal(summary.infra, "no_model_request")
    assert.match(summary.infra_why, /the trial made no model request within 0 s: the host's server was up and the client never got as far as its model/)
    assert.equal(summary.exit, 124)
    assert.match(summary.stderr, /\[evals run\] the trial made no model request/)
    assert.equal(run.result.results[0].infra, "no_model_request", "never graded as the model's, and the batch says why")
    // the idle client was replaced once, with what the container showed at that moment, and the second one hung as well
    assert.equal(summary.client_restarts.length, 1)
    assert.match(summary.client_restarts[0].diagnosis.processes, /PID\s+STAT[^]*mock\/server\.ts/, "what was running inside at that moment")
    assert.match(summary.exit_diagnosis.processes, /PID\s+STAT/)
    assert.match(run.log.join("\n"), /the client made no model request within 0 s .*restarting it, once/)
    assert.equal(hungReason(run.trials.hang) !== null, true)
    assert.deepEqual(takeHung().map((h) => h.id), ["hang"])
  } finally {
    run.cleanup()
  }
})

test("a trial whose job fails leaves a failure summary with its cause (never none), is reported as infrastructure with that cause, and the other trials are untouched", live, async () => {
  const { scriptedRun, mock, infraReason, takeHung } = await import("../src/p0/run.mjs")
  takeHung()
  // `Seed: files=nosuch-seed` names a seed no directory holds: that one trial's job throws before its container starts, the others run
  const run = await scriptedRun({ cases: [{ id: "good", prompt: mock("shell", { command: "id" }) }, { id: "broken", prompt: mock("shell", { command: "id" }), extra: "- Seed: files=nosuch-seed" }], arm: { package: "none" }, options: { auth: "none", iteration: "p0-failed-trial" }, tmp: env.tmp })
  try {
    const summary = run.trials.broken.summary
    assert.ok(summary, "a summary exists for the failed trial")
    assert.equal(summary.infra, "trial_error")
    assert.equal(summary.exit, null)
    assert.match(summary.phase, /seeding the project's files/)
    assert.match(summary.error, /nosuch-seed/)
    assert.match(summary.infra_why, /the trial's job failed while seeding the project's files: .*nosuch-seed/)
    assert.match(summary.stack, /at /)
    assert.equal(run.result.results.find((r) => r.case === "broken").infra, "trial_error", "the batch says why, and the exit code is not zero")
    assert.equal(run.trials.good.summary?.infra, undefined, "the other trial ran")
    const why = infraReason(run.trials.broken, { outcome: run.trials.broken.outcome, log: run.log })
    assert.match(why, /while seeding the project's files: .*nosuch-seed/)
    assert.equal(infraReason(run.trials.good, { outcome: run.trials.good.outcome, log: run.log }), null)
    assert.deepEqual(takeHung().map((h) => h.id), ["broken"])
  } finally {
    run.cleanup()
  }
})

test("P0-A3: an ask of a session no run owns is rejected at once, and hangs without the guard", live, async () => {
  const result = await PROBES.a3(env)
  assert.equal(result.ok, true, show(result))
})

test("P0-A4: Tavily research and crawl are confirm-only, search, extract and map stay reads", live, async () => {
  const result = await PROBES.a4(env)
  assert.equal(result.ok, true, show(result))
})

test("P0-A5: gws commits are asked, and commit mode allows only a recorded in-sandbox plan", live, async () => {
  const result = await PROBES.a5(env)
  assert.equal(result.ok, true, show(result))
})

test("P0-C: the token-priced cost cap refuses the second launch and a later batch", live, async () => {
  const result = await PROBES.c(env)
  assert.equal(result.ok, true, show(result))
})

test("P0-A2: all 24 plugins at ask-changes: every write action asks, at access all too; the local writes decline; nothing completes", needsBuilds, async () => {
  const result = await PROBES.a2(env)
  assert.equal(result.ok, true, show(result))
  assert.ok(result.actions >= 457)
})

test("P0-G (G7): the guard is deny-by-default at access all, and the suite fails without it", needsBuilds, async () => {
  const result = await PROBES.g(env)
  assert.equal(result.ok, true, show(result))
})

test("P0-13: the Claude Agent request holds none of Claude Code's own tools, and a Bash tool_use runs nothing", live, async () => {
  const result = await PROBES.p13(env)
  assert.equal(result.ok, true, show(result))
  assert.deepEqual(result.surface.tools.filter((t) => !/^mcp__opencode__/.test(t)), [], "only the host's own MCP tools")
})

test("P0-1 to P0-5: the surface dump, search, errors, the hook's reach and import", needsBuilds, async () => {
  for (const id of ["p1", "p2", "p3", "p4", "p5"]) {
    const result = await PROBES[id]({ ...env, store: env.tmp })
    assert.equal(result.ok, true, `${id}: ${show(result)}`)
  }
})

test("a trial's environment is built from an allow-list: no launcher credential is inherited, and a world cannot set one", async () => {
  const { sandboxEnv, worldEnv, CREDENTIAL_SHAPED } = await import("../src/run/sandbox.mjs")
  const { LAUNCHER_CREDENTIALS, BILLED_CORE_TOOLS } = await import("../src/p0/probes.mjs")
  const caller = { PATH: "/usr/bin", LANG: "C", ...Object.fromEntries(LAUNCHER_CREDENTIALS.map((n) => [n, `canary-${n}`])) }
  const built = sandboxEnv({ sandbox: { home: "/h", tmp: "/t" }, config: {}, password: "p", caller })
  for (const name of LAUNCHER_CREDENTIALS) assert.equal(name in built, false, name)
  assert.equal(Object.values(built).some((v) => String(v).startsWith("canary-")), false)
  // only what `--auth` names comes in, through `extra`
  assert.equal(sandboxEnv({ sandbox: { home: "/h", tmp: "/t" }, config: {}, password: "p", caller, extra: { TAVILY_API_KEY: "given" } }).TAVILY_API_KEY, "given")
  // a world's own env may not carry a credential-shaped name either
  const world = worldEnv({ GH_TOKEN: "x", MY_SERVICE_PASSWORD: "x", WORLD_NOTE: "kept" })
  assert.deepEqual(Object.keys(world.env), ["WORLD_NOTE"])
  assert.deepEqual(world.dropped, ["GH_TOKEN", "MY_SERVICE_PASSWORD"])
  assert.ok(LAUNCHER_CREDENTIALS.filter((n) => n !== "SSH_AUTH_SOCK").every((n) => CREDENTIAL_SHAPED.test(n)))
  // every billed core tool is a locked tool
  for (const tool of BILLED_CORE_TOOLS) assert.ok(LOCKED_TOOLS.includes(tool), tool)
})

test("P0-env: no launcher credential reaches a trial, and the image, video, search, fetch and subagent tools are denied by name", live, async () => {
  const result = await PROBES.env(env)
  assert.equal(result.ok, true, show(result))
})

test("P0-fake: in fake mode the model sees the pack's full tool list, a read returns the fixture's data, a write is asked and declined, and no request leaves for a real host (GitHub, Jira)", needsBuilds, async () => {
  const result = await PROBES.fake(env)
  assert.equal(result.ok, true, show(result))
  for (const id of ["github", "jira"]) assert.ok(result.checks.some((c) => c.ok && c.name.startsWith(`${id}: no request left the trial`)), id)
})

test("P0-halt: a write that completes outside commit mode halts the wave: nothing more launches, in the batch or the next", needsBuilds, async () => {
  const result = await PROBES.halt(env)
  assert.equal(result.ok, true, show(result))
})
