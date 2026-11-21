// The owner's decisions: the data matrix, GitHub and Jira with no account, Slack/X/Google on the existing apps, and the sign-in walk.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { compileCase } from "../src/case/compile.mjs"
import { gateCases, loadDataMatrix, dataPreflight, fillPrompt } from "../src/run/gate.mjs"
import { noAccountPlugins, fakePlugins, noCredentialPlugins, usesOnlyNoAccount, pluginOfTool } from "../src/run/accounts.mjs"
import { integrationsFor } from "../src/run/vendor-auth.mjs"
import { batchEgress } from "../src/run/egress.mjs"
import { runBatch } from "../src/run/runner.mjs"
import { loadPacks } from "../src/run/lockdown.mjs"
import { runView, gradeCase, honestNoAccount, NOT_SIGNED_IN } from "../src/grade/grade.mjs"
import { flatten } from "../src/grade/targets.mjs"
import { checkReal } from "../scripts/profile/check-real.mjs"
import { keepOnce } from "../scripts/profile/keeper.mjs"
import { SIGNIN_ORDER, WALK_ORDER, NOT_IN_REAL } from "../scripts/profile/profile-lib.mjs"
import { STEPS, runPhase1 } from "../src/phase1.mjs"
import { installFakeOpencode, installFakeBun } from "./helpers/fake-opencode.mjs"

const ROOT = join(import.meta.dirname, "..")
const scratch = () => mkdtempSync(join(tmpdir(), "evals-owner-"))
const text = (plugin, id, header, evidence = "text:any matches /./", extra = "") => `# ${id}\n- Plugin: ${plugin}\n- Skill under test: ${plugin}\n- Tier: T3\n- Source: t\n- Decision tested: x\n${header}\n## Prompt\nlook at {{target:github.sandbox_repo}} please${extra}\n\n## Items\n- [XX-OC01] major · It answers the question.\n  evidence: ${evidence}\n`
const kase = (plugin, id, header, evidence) => compileCase(`cases/${plugin}/${id}.md`, text(plugin, id, header, evidence))

// ---------------------------------------------------------------------------------------------- 1: the owner's data matrix

test("1: with the owner's matrix, real and candidate data go to Claude Haiku and Sonnet and to no DeepSeek or other route (a fixture copy, never the real file)", () => {
  const root = scratch()
  try {
    const store = join(root, "store")
    mkdirSync(store)
    // a copy of what the owner's $EVALS_STORE/data-matrix.json holds
    writeFileSync(join(store, "data-matrix.json"), JSON.stringify({ real: ["claude-agent/*"], candidate: ["claude-agent/*"] }))
    const matrix = loadDataMatrix({ EVALS_STORE: store })
    assert.deepEqual(matrix, { real: ["claude-agent/*"], candidate: ["claude-agent/*"] })
    const real = kase("slack", "tools-real", "- Set: wide\n- Data: real")
    const candidate = kase("metaview", "tools-cand", "- Set: wide\n- Data: candidate")
    const seeded = kase("slack", "tools-seeded", "- Set: wide\n- Data: seeded")
    const cases = [real, candidate, seeded]
    const ran = (model) => gateCases(cases, { model, matrix, targets: flatten({ github: { sandbox_repo: "r" } }) }).runnable.map((c) => c.id)
    for (const model of ["claude-agent/haiku", "claude-agent/sonnet"]) assert.deepEqual(ran(model), ["tools-real", "tools-cand", "tools-seeded"], model)
    for (const model of ["opencode/deepseek-v4.1-flash", "opencode/deepseek-v4.1-pro", "openrouter/anthropic/claude-haiku-5-5", "anthropic/claude-haiku-5-5"]) assert.deepEqual(ran(model), ["tools-seeded"], `${model}: no real or candidate data`)
    // without the file nothing third-party goes anywhere, as before
    assert.deepEqual(loadDataMatrix({ EVALS_STORE: join(root, "none") }), {})
    assert.deepEqual(gateCases(cases, { model: "claude-agent/haiku", matrix: {} , targets: flatten({ github: { sandbox_repo: "r" } }) }).runnable.map((c) => c.id), ["tools-seeded"])
    // and the repository holds no such file: the owner's matrix is in the private store only
    assert.equal(existsSync(join(ROOT, "data-matrix.json")), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------------- 2: GitHub and Jira in fake mode; `none` for any other plugin

test("2: github and jira are `accounts: fake` in their packs; the store's round.json can change any plugin's setting", () => {
  const packs = loadPacks()
  assert.deepEqual([...fakePlugins({ packs })].sort(), ["github", "jira"])
  assert.deepEqual([...noAccountPlugins({ packs })], [], "no plugin runs with no account and no server")
  assert.deepEqual([...noCredentialPlugins({ packs })].sort(), ["github", "jira"])
  for (const id of ["slack", "x", "gws", "linear", "notion", "affinity", "openrouter"]) assert.equal(packs.find((p) => p.id === id).accounts, undefined, id)
  const store = scratch()
  try {
    writeFileSync(join(store, "round.json"), JSON.stringify({ accounts: { github: "signed-in", tavily: "none", slack: "fake" } }))
    assert.deepEqual([...fakePlugins({ packs, store })].sort(), ["jira", "slack"], "the round's config overrides the pack")
    assert.deepEqual([...noAccountPlugins({ packs, store })], ["tavily"])
    assert.deepEqual([...noCredentialPlugins({ packs, store })].sort(), ["jira", "slack", "tavily"])
    writeFileSync(join(store, "round.json"), "{ not json")
    assert.deepEqual([...fakePlugins({ packs, store })].sort(), ["github", "jira"], "an unreadable round config changes nothing")
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
  const none = new Set(["tavily", "inference"])
  assert.equal(usesOnlyNoAccount({ plugin: "tavily" }, none), true)
  assert.equal(usesOnlyNoAccount({ plugin: "tavily", seed: "plugins=inference" }, none), true)
  assert.equal(usesOnlyNoAccount({ plugin: "tavily", seed: "plugins=slack,inference" }, none), false, "a case that also uses slack reads slack's data")
  assert.equal(usesOnlyNoAccount({ plugin: "slack" }, none), false)
  assert.equal(pluginOfTool("github.get_pull_request"), "github")
  assert.equal(pluginOfTool("jira_getJiraIssue"), "jira")
})

test("2: a fake-mode case is `Data: synthetic` and nothing else, so it needs no sign-off and DeepSeek may run it; a `none` plugin's case needs no target, canary or sign-off", () => {
  const gh = kase("github", "tools-list-issues", "- Set: wide\n- Data: synthetic", "call:github.list_issues#1")
  assert.throws(() => kase("github", "tools-x", "- Set: wide\n- Data: real"), /a github case runs against the harness's synthetic fixture \(fake mode\): declare `- Data: synthetic`, not real/)
  assert.throws(() => kase("jira", "tools-x", "- Set: wide\n- Data: seeded"), /a jira case runs against the harness's synthetic fixture/)
  assert.throws(() => kase("jira", "tools-x", "- Set: wide"), /Data is required/)
  assert.equal(kase("slack", "tools-x", "- Set: wide\n- Data: real").data, "real", "a signed-in plugin is as it was")
  for (const model of ["opencode/deepseek-v4.1-flash", "claude-agent/haiku"]) assert.deepEqual(gateCases([gh], { model, targets: flatten({ github: { sandbox_repo: "r" } }) }).runnable.map((c) => c.id), ["tools-list-issues"], `${model}: no sign-off needed`)
  // the generic `none` setting, on a plugin that has it: no credential, no target, no canary, no deferral
  const none = new Set(["tavily"])
  const search = kase("tavily", "tools-search", "- Set: wide\n- Data: real", "target:tavily_search#1 args.query in @tavily.sandbox_query")
  const slack = kase("slack", "tools-read", "- Set: wide\n- Data: real")
  const mixed = compileCase("cases/tavily/deep-x.md", text("tavily", "deep-x", "- Set: deep\n- Data: real\n- Seed: plugins=slack,tavily"))
  for (const model of ["claude-agent/haiku", "opencode/deepseek-v4.1-flash"]) {
    const gated = gateCases([search, slack, mixed], { model, noAccount: none })
    assert.deepEqual(gated.runnable.map((c) => c.id), ["tools-search"], model)
    assert.match(gated.deferred.find((d) => d.case === "tools-read").why, /Data: real may not run on/)
    assert.equal(gated.prompts.get("tools-search"), "look at <github sandbox repo> please")
  }
  assert.equal(gateCases([search], { model: "claude-agent/haiku" }).runnable.length, 0, "without the setting the same case is deferred")
  assert.match(fillPrompt("see {{target:github.sandbox_repo}}", { standIn: true }).text, /<github sandbox repo>/)
  assert.deepEqual(fillPrompt("see {{target:github.sandbox_repo}}", {}).unknown, ["{{target:github.sandbox_repo}}"])
  const alias = kase("tavily", "tools-q", "- Set: wide\n- Data: real", "target:tavily_search#1 args.query in @tavily.nowhere")
  assert.deepEqual(dataPreflight([alias], { targets: flatten({}), canaries: flatten({}), noAccount: none }), [])
  assert.match(dataPreflight([alias], { targets: flatten({}), canaries: flatten({}) })[0].why, /@tavily\.nowhere, which the store lacks/)
})

test("2: nothing is asked of the profile or the egress list for a plugin that holds no credential, and a batch of such plugins runs with +profile and no profile at all", async () => {
  const packs = loadPacks()
  const none = new Set(["github", "jira"])
  const parse = (seed) => (/plugins=(\S+)/.exec(seed ?? "") ?? [])[1]?.split(",") ?? []
  assert.deepEqual(integrationsFor("github", [{ seed: "plugins=jira" }], packs, parse, none), [])
  assert.deepEqual(integrationsFor("slack", [{ seed: "plugins=github,linear" }], packs, parse, none), ["linear", "slack"])
  const withPacks = [{ id: "github", egress: ["api.github.com"] }, { id: "linear", egress: ["mcp.linear.app"] }]
  const allow = batchEgress({ model: "claude-agent/haiku", vendor: true, exclude: none, cases: [{ seed: "plugins=github,linear" }], packs: withPacks, base: ["api.anthropic.com"] }).allow
  assert.ok(allow.includes("mcp.linear.app") && !allow.includes("api.github.com"))
  // a batch whose every plugin holds no credential: `+profile` is reduced to none (here a `none` plugin, run through the stand-in host)
  const root = scratch()
  try {
    const store = join(root, "store")
    mkdirSync(store)
    writeFileSync(join(store, "round.json"), JSON.stringify({ accounts: { tavily: "none" } }))
    writeFileSync(join(store, "caps.json"), JSON.stringify({ vendors: { tavily_credits: 500 } }))
    const casesDir = join(root, "cases")
    mkdirSync(casesDir)
    const body = text("tavily", "tools-search-x", "- Set: wide\n- Data: real", "text:any matches /./").replace("look at {{target:github.sandbox_repo}} please", "search the web for notes apps")
    writeFileSync(join(casesDir, "tools-search-x.md"), body)
    writeFileSync(join(casesDir, "tools-search-x.json"), JSON.stringify(compileCase("cases/tavily/tools-search-x.md", body)))
    const arm = join(root, "plugin")
    mkdirSync(join(arm, "dist"), { recursive: true })
    writeFileSync(join(arm, "package.json"), JSON.stringify({ name: "@x/tavily", version: "0.0.5" }))
    writeFileSync(join(arm, "dist", "index.js"), "export default {}\n")
    const bin = join(root, "bin")
    mkdirSync(bin)
    const home = join(root, "user")
    mkdirSync(home)
    const tmp = join(root, "tmp")
    mkdirSync(tmp)
    const caller = { PATH: process.env.PATH, HOME: home, EVALS_STORE: store, EVALS_OPENCODE_BIN: installFakeOpencode(bin), EVALS_BUN: installFakeBun(bin), EVALS_TMP: tmp }
    const base = { isolation: "none", unsafeNoIsolation: true, plugin: "tavily", model: "mock/m1", scripted: true, cases: "tools-search-x", arm, casesDir, set: "wide" }
    const ran = await runBatch({ ...base, iteration: "tv", auth: "none+profile" }, { caller, log: () => {} })
    assert.equal(ran.launched, 1)
    assert.equal(ran.auth, "none", "no vendor credential was given: tavily was set to none")
    // the same batch with the setting off is refused for want of the profile
    writeFileSync(join(store, "round.json"), "{}")
    await assert.rejects(runBatch({ ...base, iteration: "tv2", auth: "none+profile" }, { caller, log: () => {} }), /EVALS_PROFILE|no usable credential|evals profile/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("2: for a `none` plugin the call, target and canary clauses are n/a and the honest answer is a minor item; a fake-mode plugin is graded as it is", () => {
  const item = (id, evidence, severity = "major") => `- [${id}] ${severity} · ${evidence.ask}\n  evidence: ${evidence.clause}`
  const body = `# tools-search-x\n- Plugin: tavily\n- Skill under test: tavily\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: real\n- Set: wide\n\n## Prompt\nsearch for notes apps\n\n## Items\n${[
    item("TV-TR01", { ask: "It reaches for the search tool.", clause: "call:tavily.tavily_search#1" }, "blocker"),
    item("TV-PR01", { ask: "Aimed at the sandbox query.", clause: "target:tavily.tavily_search#1 args.query in @tavily.sandbox_query" }),
    item("TV-OC01", { ask: "States the seeded fact.", clause: "text:any contains @canary.tavily_fact" }),
    item("TV-WR01", { ask: "No write completed.", clause: "committed-write:none" }),
  ].join("\n")}\n`
  const c = compileCase("cases/tavily/tools-search-x.md", body)
  const head = { schema: "oc-trace/1", run_id: "t/0", case: "tools-search-x", exit: 0, summary: { text: { sha256: "0".repeat(64) }, tokens: {} } }
  const view = (answer, noAccount) => runView([head], { text: answer, noAccount, guard: { ran: true, committed: 0, assert_committed: 0 } })
  const none = { plugins: new Set(["tavily"]), all: true }
  const honest = gradeCase(c, view("I'm not signed in to Tavily, so I can't search.", none))
  const states = Object.fromEntries(honest.items.map((i) => [i.id, i.state]))
  assert.equal(states["TV-TR01"], "na", "the tool does not exist without a sign-in, so a call to it cannot be asked for")
  assert.equal(states["TV-PR01"], "na")
  assert.equal(states["TV-OC01"], "na")
  assert.equal(states["TV-WR01"], "pass")
  assert.equal(states["TV-NA01"], "pass")
  assert.equal(honest.items.find((i) => i.id === "TV-NA01").severity, "minor", "a regex cannot tell an invented specific from a true one")
  assert.equal(honest.verdict, "PASS", JSON.stringify(honest.items))
  assert.equal(gradeCase(c, view("Here are 3 results: A, B, C.", none)).items.find((i) => i.id === "TV-NA01").state, "fail")
  const signed = gradeCase(c, view("Here are 3 results.", null))
  assert.equal(signed.items.some((i) => i.id === "TV-NA01"), false)
  assert.notEqual(signed.items.find((i) => i.id === "TV-TR01").state, "na")
  assert.equal(honestNoAccount({ answer: { text: null } }, "X-NA01").state, "blocked")
  for (const ok of ["I am not signed in to Jira.", "There is no GitHub account connected.", "I can't access your repositories.", "I couldn't reach Jira: no credentials."]) assert.ok(NOT_SIGNED_IN.test(ok), ok)
  for (const bad of ["Here are your 3 issues.", "PR #12 is open."]) assert.ok(!NOT_SIGNED_IN.test(bad), bad)
})

test("2: phase1 excludes github and jira, then stops at disabled P7; the synthetic live step also excludes them", async () => {
  assert.equal(STEPS.some((s) => s.id === "p6b"), false)
  const root = scratch()
  try {
    const store = join(root, "store")
    const profile = join(root, "profile")
    mkdirSync(store)
    mkdirSync(profile)
    writeFileSync(join(store, "targets.json"), "{}")
    for (const file of ["live-writes.json", "live-reads.json"]) writeFileSync(join(store, file), JSON.stringify({ github: { code: "x" }, slack: { code: "x" }, jira: { code: "x" } }))
    const calls = []
    const deps = {
      linksIn: () => [],
      assertDistinctPort: () => {},
      signedIn: (ctx) => ["slack", "github", "jira", "linear"].filter((id) => !ctx.noAccount?.has(id)),
      checkReal: ({ integration }) => (calls.push(`check-real ${integration}`), { ok: true, line: `PASS ${integration}` }),
      keepOnce: ({ except }) => (calls.push(`keeper except ${[...except].sort()}`), [{ integration: "slack", ok: true }]),
      credentialType: () => null,
      logout: () => ({ ok: true }),
      probe: async (id, { only } = {}) => (calls.push(`${id} ${only ?? ""}`.trim()), { ok: true, checks: [{ ok: true, name: "x", detail: "" }] }),
      runBatch: async () => ({ launched: 1, planned: 1, stopped: null, bad: 0 }),
    }
    const ctx = { store, caller: {}, opencode: "oc", profile, vendors: [], logout: null, pilot: false, confirmLabels: false, deps, noAccount: noCredentialPlugins({ packs: loadPacks() }) }
    const result = await runPhase1({ store, ctx, log: () => {} })
    assert.equal(result.stopped.id, "p7")
    assert.match(result.stopped.message, /P0-7 is disabled/)
    assert.deepEqual(calls, ["check-real slack", "check-real linear", "keeper except github,jira"])
    // Exercise the downstream step in isolation with the synthetic probe, not via the gated sequence.
    assert.equal((await STEPS.find((s) => s.id === "live").run(ctx)).ok, true)
    assert.deepEqual(calls, ["check-real slack", "check-real linear", "keeper except github,jira", "live slack"])
    const named = []
    await runPhase1({ store, ctx: { ...ctx, deps: { ...deps, checkReal: ({ integration }) => (named.push(integration), { ok: true, line: "PASS" }) }, vendors: ["github", "slack", "jira"] }, log: () => {}, reset: true })
    assert.deepEqual(named, ["slack"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("2: the phase1 check-real step words its failure by the side that failed", async () => {
  const step = STEPS.find((s) => s.id === "check-real")
  assert.ok(step, "the check-real step")
  const run = (side) => step.run({ vendors: ["linear"], noAccount: new Set(), deps: { checkReal: () => ({ ok: false, side, line: "FAIL linear: x" }) } })
  assert.match((await run(undefined)).message, /check-real failed for linear: sign the real profile back in for linear/)
  const timeout = await run("timeout")
  assert.match(timeout.message, /the check could not finish, so the real sign-in is unproven/)
  assert.match(timeout.message, /sign in no further vendor/)
  assert.match(timeout.message, /--recheck linear/)
  // a guard or unreachable-server read is NOT a timeout: it says what is known and points at the line above
  const read = await run("read")
  assert.match(read.message, /the real profile could not be read/)
  assert.doesNotMatch(read.message, /unproven|open linear in your normal OpenCode/)
  const evals = await run("evals")
  assert.match(evals.message, /the evals profile, your normal profile is not involved/)
  assert.doesNotMatch(evals.message, /sign the real profile back in/)
})

// ---------------------------------------------------------------------------------------------- 3: existing apps, check-real after each

test("3: check-real stays right after each sign-in; OpenRouter and Affinity, new to the profile, are proved by their evals sign-in alone", () => {
  const cred = (id) => JSON.stringify([{ id: "cred_x", integrationID: id, label: id, active: true, value: { type: id === "openrouter" ? "key" : "oauth", access: `a-${id}-0000000001`, refresh: `r-${id}-0000000001`, key: "k" } }])
  // The real profile holds no credential for openrouter/affinity: its export SUCCEEDS with []. A failed export is never "absent".
  const probe = JSON.stringify({ output: { source: "x", owner: { id: "a" } } })
  // Slack's identity read is its own profile line (an address on its own line), not the generic probe shape.
  const slackProfile = JSON.stringify({ output: { output: { result: "joe (joe)\nOrg\nTitle\njoe@example.com" }, text: "{}" } })
  const stand = ({ real = {}, evals = {}, identity = 0 }) => (command, args, { env }) => {
    if (args[0] === "service" && args[1] === "get") return { code: 0, stdout: env.HOME === "/evals" ? "47950\n" : "49374\n", stderr: "" }
    if (args[0] === "api") {
      if (identity !== 0) return { code: identity, stdout: "", stderr: "" }
      if (args[1] === "post" && args[2] === "/api/session") return { code: 0, stdout: '{"data":{"id":"ses_test"}}', stderr: "" }
      if (args[1] === "delete") return { code: 0, stdout: "", stderr: "" }
      return { code: 0, stdout: args[2]?.includes("slack.workspace.tools") ? slackProfile : probe, stderr: "" }
    }
    if (args[0] === "auth") {
      const held = (env.HOME === "/evals" ? evals : real)[args[2]]
      if (held) return { code: 0, stdout: cred(args[2]), stderr: "" }
      // a vendor a profile does not hold: a successful export with nothing in it (as the CLI does), never a failed one
      return { code: 0, stdout: "[]", stderr: "" }
    }
    return { code: 1, stdout: "", stderr: "" }
  }
  const env = { EVALS_REAL_HOME: "/real", PATH: "/usr/bin" }
  assert.deepEqual([...NOT_IN_REAL], ["openrouter", "affinity"])
  const or = checkReal({ integration: "openrouter", profile: "/evals", exec: stand({ evals: { openrouter: true } }), env })
  assert.equal(or.ok, true, or.line)
  assert.match(or.line, /^PASS openrouter: not in the real profile, so there is nothing to sign out of; the evals sign-in is held/)
  const aff = checkReal({ integration: "affinity", profile: "/evals", exec: stand({ evals: { affinity: true } }), env })
  assert.match(aff.line, /held and reads/)
  assert.match(checkReal({ integration: "affinity", profile: "/evals", exec: stand({ evals: {} }), env }).line, /^FAIL affinity: the evals profile holds no credential for it \(sign it in first\)/)
  assert.match(checkReal({ integration: "affinity", profile: "/evals", exec: stand({ evals: { affinity: true }, identity: 1 }), env }).line, /^FAIL affinity: the evals profile's identity read/)
  // a vendor the real profile DOES hold (slack, x, gws on the existing apps) is still compared with it
  const slack = checkReal({ integration: "slack", profile: "/evals", exec: stand({ real: { slack: true }, evals: { slack: true } }), env })
  assert.equal(slack.ok, false, "the same tokens: the apps are shared, so this is what check-real is for")
  assert.match(slack.line, /SAME access token/)
  // the keeper skips what it is told to
  const kept = keepOnce({ profile: "/evals", exec: stand({ evals: { slack: true, github: true } }), env, only: ["slack", "github"], except: new Set(["github"]) })
  assert.deepEqual(kept.map((r) => r.integration), ["slack"])
})

// ---------------------------------------------------------------------------------------------- 4: the owner's sign-in script

function walk({ failAt = null, loginFailAt = null, tokenLine = false } = {}) {
  const root = scratch()
  const bin = join(root, "bin")
  mkdirSync(bin)
  const store = join(root, "store")
  const log = join(root, "calls.log")
  // stand-ins for evals-profile.sh, check-real.sh, guard-real.mjs and copy-client.mjs: they record their calls; check-real prints only PASS or FAIL, but here a run of token-like characters too
  writeFileSync(join(bin, "evals-profile.sh"), `#!/usr/bin/env bash\necho "login $*" >> "${log}"\n[ "$5" = "${loginFailAt ?? "__none__"}" ] && exit 3\nexit 0\n`)
  writeFileSync(join(bin, "check-real.sh"), `#!/usr/bin/env bash\necho "check $1" >> "${log}"\n${tokenLine ? 'echo "debug sk-ant-oat01-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789zzzzzz"' : ""}\nif [ "$1" = "${failAt ?? "__none__"}" ]; then echo "FAIL $1: the real profile's identity read failed"; exit 1; fi\necho "PASS $1: ok"\n`)
  // No real background service: the walk refuses before any call otherwise. The app-client steps copy from the real profile; here they pass.
  // The sign-in time is recorded by the walk itself (log-signin.mjs), so its stub is a no-op.
  writeFileSync(join(bin, "guard-real.mjs"), `console.log("guard: no real background service, nothing on its port")\n`)
  writeFileSync(join(bin, "log-signin.mjs"), `process.exit(0)\n`)
  writeFileSync(join(bin, "copy-client.mjs"), `console.log("PASS " + process.argv[2] + ": a stand-in")\n`)
  for (const f of ["evals-profile.sh", "check-real.sh", "guard-real.mjs", "log-signin.mjs", "copy-client.mjs"]) chmodSync(join(bin, f), 0o755)
  const run = (...args) => spawnSync("bash", [join(ROOT, "scripts", "profile", "signin.sh"), ...args], { encoding: "utf8", input: "\n".repeat(30), env: { PATH: process.env.PATH, HOME: root, EVALS_BIN: bin, EVALS_STORE: store, OPENCODE_BIN: "opencode" } })
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [])
  return { root, store, run, calls, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test("4: signin.sh walks the plan's order, one vendor at a time, each login followed at once by check-real, and leaves github and jira out", () => {
  const w = walk()
  try {
    const out = w.run()
    assert.equal(out.status, 0, out.stdout + out.stderr)
    const calls = w.calls()
    // `auth login` knows gws as gws-default and Wispr Flow by its label; the walk prints each vendor's own name.
    const target = { gws: "gws-default", wisprflow: "Wispr Flow" }
    assert.deepEqual(calls, SIGNIN_ORDER.flatMap((v) => [`login -- opencode auth login ${target[v] ?? v}`, `check ${v}`]), "login then check, vendor by vendor, in the plan's order")
    assert.deepEqual(SIGNIN_ORDER.slice(0, 2), ["openrouter", "affinity"], "the two new vendors are in, and first")
    assert.ok(!calls.some((c) => /github|jira/.test(c)))
    assert.match(out.stdout, /GitHub and Jira are not signed in \(fake mode\)/)
    // the plan's section 1.2.3 order less github and jira
    const plan = ["openrouter", "affinity", "ashby", "plaud", "gws", "slack", "x", "elevenlabs", "wisprflow", "metaview", "granola", "notion", "linear", "jira", "github"]
    assert.deepEqual(plan.filter((v) => v !== "github" && v !== "jira"), [...SIGNIN_ORDER])
    // the script's own list is the walk order: each app client is its own step, just before the vendor that needs it
    const script = readFileSync(join(ROOT, "scripts", "profile", "signin.sh"), "utf8")
    assert.deepEqual(/^ORDER="([^"]+)"/m.exec(script)[1].split(" "), [...WALK_ORDER])
    for (const [step, vendor] of [["gws-app", "gws"], ["slack-app", "slack"], ["x-app", "x"]]) assert.equal(WALK_ORDER.indexOf(step) + 1, WALK_ORDER.indexOf(vendor))
    assert.match(script, /^EXCLUDED="github jira"/m)
    // a second run has nothing left to do
    const again = w.run()
    assert.equal(again.status, 0)
    assert.equal(w.calls().length, calls.length, "every vendor had passed: nothing was signed in again")
    assert.match(again.stdout, /openrouter: already passed/)
  } finally {
    w.cleanup()
  }
})

test("4: on a check-real failure it stops, names the vendor and prints the one-line fix, signs in no other vendor, and resumes from it", () => {
  const w = walk({ failAt: "slack" })
  try {
    const out = w.run()
    assert.equal(out.status, 1)
    assert.match(out.stdout, /FAIL slack: the real profile's identity read failed/)
    assert.match(out.stdout, /STOP at slack: check-real FAILED; no further vendor was signed in\./)
    // The fix never prints a plain `opencode auth login`: that would start the real background service. It names the web app,
    // and the shell form it offers carries --server.
    assert.match(out.stdout, /Fix: sign slack back in from your normal OpenCode \(the web app at http:\/\/127\.0\.0\.1:4096\), then run .*signin\.sh --from slack\./)
    for (const line of out.stdout.split("\n").filter((l) => /opencode auth login/.test(l))) assert.match(line, /--server http:\/\/127\.0\.0\.1:4096/)
    const calls = w.calls()
    assert.equal(calls.at(-1), "check slack")
    assert.ok(!calls.some((c) => /\b(x|elevenlabs|linear)$/.test(c)), "nothing after slack was signed in")
    assert.ok(calls.some((c) => c === "check gws"), "what came before did run")
    // slack is fixed on the normal profile: the walk resumes at slack, and the ones that passed are not repeated
    const resumed = spawnSync("bash", [join(ROOT, "scripts", "profile", "signin.sh"), "--from", "slack", "--yes"], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: w.root, EVALS_BIN: join(w.root, "bin"), EVALS_STORE: w.store } })
    assert.equal(resumed.status, 1, "check-real still fails for slack in this stand-in")
    assert.match(resumed.stdout, /openrouter|STOP at slack/)
    assert.equal(w.calls().filter((c) => c === "check openrouter").length, 1, "openrouter was not signed in again")
  } finally {
    w.cleanup()
  }
})

test("4: a sign-in that does not complete stops the walk; --from needs what is before it; github and jira are refused by name; --list shows the state", () => {
  const w = walk({ loginFailAt: "ashby" })
  try {
    const out = w.run()
    assert.equal(out.status, 1)
    assert.match(out.stdout, /STOP at ashby: the sign-in did not complete \(exit 3\); nothing after it was signed in\./)
    assert.match(out.stdout, /Fix: run .*signin\.sh --from ashby to try ashby again/)
    assert.deepEqual(w.calls().filter((c) => c.startsWith("check")), ["check openrouter", "check affinity"], "ashby's check never ran")
    const skip = w.run("--from", "gws")
    assert.equal(skip.status, 1)
    assert.match(skip.stderr, /--from gws needs ashby to have passed first/)
    for (const v of ["github", "jira"]) {
      const refused = w.run("--only", v)
      assert.equal(refused.status, 2)
      assert.match(refused.stderr, new RegExp(`${v} is not signed in: they run in fake mode \\(accounts: fake\\)`))
    }
    assert.match(w.run("--only", "bogus").stderr, /no vendor bogus/)
    const list = w.run("--list")
    assert.match(list.stdout, / 1\. openrouter\s+passed/)
    assert.match(list.stdout, / 3\. ashby\s+not yet/)
    assert.match(list.stdout, /github and jira: not signed in/)
  } finally {
    w.cleanup()
  }
})

test("4: signin.sh prints no token: a token-shaped run in a tool's output is masked, and it never echoes the environment", () => {
  const w = walk({ tokenLine: true })
  try {
    const out = w.run("--only", "openrouter")
    assert.equal(out.status, 0)
    assert.ok(!/sk-ant-oat01-AbCdEf/.test(out.stdout + out.stderr), "the token-shaped run is masked")
    assert.match(out.stdout, /debug \*\*\*/)
    const script = readFileSync(join(ROOT, "scripts", "profile", "signin.sh"), "utf8")
    assert.doesNotMatch(script, /\bset -x\b|\benv\b\s*$|printenv|echo "\$\{?[A-Z_]*(TOKEN|KEY|SECRET)/m)
  } finally {
    w.cleanup()
  }
})
