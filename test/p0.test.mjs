// The P0 probes G0 rests on (EVALS-232 §1.5, §1.7), run for real: the harness's scripted model, no credential, every trial in
// the harness's container. They need Docker with the sandbox image, an OpenCode 2.3.x binary and bun; the ones that install
// all 24 plugins also need their builds (EVALS_COMPANIONS: a map from plugin id to a built directory). A probe that cannot run
// says why instead of passing. The first two groups run with no builds at all.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { PROBES } from "../src/p0/probes.mjs"
import { findBinary, imageTag } from "../src/run/container.mjs"
import { buildPolicy } from "../src/run/guard/policy.mjs"
import { decideBefore, planIdOf, judgePlan, matchWrite, pick, loadPolicy } from "../src/run/guard/logic.mjs"
import { lockdownPolicies, lockdownPermissions, lockdownProblems, writeActions, loadPacks, LOCKED_TOOLS, COMPANION_CAPS, companionOptions, CONFIRM_ONLY_READS } from "../src/run/lockdown.mjs"

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

test("the guard's policy lists all 457 write tools under names that cannot match a host tool or another plugin's read", () => {
  const policy = buildPolicy()
  assert.equal(policy.writes.length, writeActions().length - CONFIRM_ONLY_READS.length)
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
