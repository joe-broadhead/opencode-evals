// R1 to R14 (EVALS-232), the parts that need no container: companions, the vendor credential allow-list, secrets and their encoded
// forms, prompt placeholders and seeds, per-batch egress, the round's list-price ceiling, and the sealed config a locked run gets.
// Synthetic credentials and a stand-in host only.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, statSync, chmodSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Buffer } from "node:buffer"
import { allowListed, vendorCredentials, exportTargets, exportTargetsFor, secretsOf, REFRESH_PLACEHOLDER, profileEnv } from "../src/run/vendor-auth.mjs"
import { redactor, expand, registerSecrets, scrub } from "../src/run/secrets.mjs"
import { fillPrompt, gateCases, seedFiles, seedDir, placeholdersIn, loadDataMatrix, seedRefusal } from "../src/run/gate.mjs"
import { dataOf } from "../src/case/schema.mjs"
import { batchEgress, fillHost, modelHosts } from "../src/run/egress.mjs"
import { readCompanions, materialiseArm, materialiseCompanions, runtimePaths, companionsDigest } from "../src/run/arm.mjs"
import { roundLimits, estimateRunUsd, assertLaunchWithinRound, RoundCapError, tierOf, listSpent, MIN_MEASURED_RUNS } from "../src/cost/budget.mjs"
import { outstandingList } from "../src/cost/ledger.mjs"
import { parseAuth } from "../src/run/auth.mjs"
import { runBatch, listUsdOf, modelPrice, guardSummary, hostLogFacts, rateLimitOutcome } from "../src/run/runner.mjs"
import { compileCase } from "../src/case/compile.mjs"
import { flatten } from "../src/grade/targets.mjs"
import { installFakeOpencode, installFakeBun } from "./helpers/fake-opencode.mjs"

const scratch = () => mkdtempSync(join(tmpdir(), "evals-r-test-"))
const oauth = (integration, extra = {}) => ({ id: "cred_orig", integrationID: integration, label: "me@example.org", active: true, value: { type: "oauth", methodID: "mcp-oauth", access: `access-token-${integration}-0123456789`, refresh: `REFRESH-SECRET-${integration}-0123456789`, expires: Date.now() + 8 * 3_600_000, metadata: { serverUrl: "https://mcp.example.org/mcp", tokenType: "Bearer", scope: "read write", issuer: "https://auth.example.org", login: "someone", client: { client_id: "https://opencode.ai/oauth/opencode/client.json", client_secret: "CLIENT-SECRET-0123456789" } }, ...extra } })

// ------------------------------------------------------------------------------------------------ R2: the credential allow-list

test("a vendor credential is cut to the allow-list: no refresh token, no client secret, no login, a constant label, a new id", () => {
  const cut = allowListed(oauth("linear"))
  assert.equal(cut.label, "evals")
  assert.notEqual(cut.id, "cred_orig")
  assert.match(cut.id, /^cred_[0-9a-f]{24}$/)
  assert.deepEqual(cut.value, { type: "oauth", methodID: "mcp-oauth", access: "access-token-linear-0123456789", refresh: REFRESH_PLACEHOLDER, expires: cut.value.expires, metadata: { serverUrl: "https://mcp.example.org/mcp", tokenType: "Bearer", scope: "read write", issuer: "https://auth.example.org", client: { client_id: "https://opencode.ai/oauth/opencode/client.json" } } })
  const text = JSON.stringify(cut)
  for (const dropped of ["REFRESH-SECRET", "CLIENT-SECRET", "someone", "me@example.org"]) assert.ok(!text.includes(dropped), dropped)
  assert.deepEqual(allowListed({ integrationID: "tavily", active: true, value: { type: "key", key: "tvly-0123456789abcdef", extra: "x" } }).value, { type: "key", key: "tvly-0123456789abcdef" })
  assert.deepEqual(allowListed({ integrationID: "claude-agent", value: { type: "external", methodID: "claude-login", secret: "x" } }).value, { type: "external", methodID: "claude-login" })
  assert.equal(allowListed({ integrationID: "x", value: { type: "weird", token: "t" } }), null)
  assert.equal(allowListed({ integrationID: "x", value: { type: "oauth" } }), null, "an oauth credential with no access token is nothing")
})

test("each needed plugin gets its own vendor's credential by its auth export target, with its real integration id", () => {
  const hash = "0123456789abcdef"
  const mcp = (id, access, label = id) => JSON.stringify([{ id: "cred_orig", integrationID: id, label, active: true, value: { type: "oauth", methodID: "mcp-oauth", access, refresh: "REFRESH-SECRET", expires: Date.now() + 8 * 3_600_000 } }])
  const key = (id, value, label = id) => JSON.stringify([{ id: "cred_orig", integrationID: id, label, active: true, value: { type: "key", key: value } }])
  const exports = {
    affinity: mcp(`mcp_${hash}`, "access-token-affinity-0123456789", "Affinity"),
    "gws-default": mcp("gws-default", "access-token-gws-0123456789", "default"),
    slack: key("slack-app", "synthetic-slack-key-0000", "Slack app"),
    x: key("x-app", "synthetic-app-key-0000", "X app"),
    linear: mcp("linear", "access-token-linear-0123456789"),
  }
  const out = vendorCredentials(exports, { needed: ["affinity", "gws", "slack", "x"] })
  assert.deepEqual(out.list.map((c) => c.integrationID).sort(), [`mcp_${hash}`, "gws-default", "slack-app", "x-app"].sort(), "real ids, one per plugin, never the plugin id")
  assert.deepEqual(out.dropped, [])
  assert.equal(JSON.stringify(out.list).includes("access-token-linear"), false, "an integration the batch does not need is never in the payload, even when its export is in the map")
  const text = JSON.stringify(out.list)
  assert.equal(text.includes("REFRESH-SECRET"), false, "no refresh token")
  assert.ok(text.includes(REFRESH_PLACEHOLDER))
  assert.deepEqual(out.secrets.sort(), ["access-token-affinity-0123456789", "access-token-gws-0123456789", "synthetic-app-key-0000", "synthetic-slack-key-0000"].sort())
})

test("a vendor whose export is empty throws the no-usable-credential error, naming the plugin", () => {
  assert.throws(() => vendorCredentials({ affinity: "[]" }, { needed: ["affinity"] }), /holds no usable credential for affinity \(its `auth export affinity` held no active credential\)/)
  assert.throws(() => vendorCredentials({}, { needed: ["gws"] }), /holds no usable credential for gws \(its `auth export gws-default` held no active credential\)/)
  const unusable = { affinity: JSON.stringify([{ integrationID: "mcp_0123456789abcdef", label: "Affinity", active: true, value: { type: "oauth" } }]) }
  assert.throws(() => vendorCredentials(unusable, { needed: ["affinity"] }), /holds no usable credential for affinity/)
  assert.deepEqual(vendorCredentials(unusable, { needed: [] }).list, [])
})

test("the profile is exported per needed vendor, through auth export <target> only", async () => {
  const calls = []
  // The target is the plugin's server name; the host answers with the credential's real id (slack-app, x-app).
  const answers = {
    slack: [{ id: "cred_s", integrationID: "slack-app", label: "Slack app", active: true, value: { type: "key", key: "synthetic-slack-key-0000" } }],
    x: [{ id: "cred_x", integrationID: "x-app", label: "X app", active: true, value: { type: "key", key: "synthetic-app-key-0000" } }],
  }
  const exec = async (command, args, options) => {
    calls.push({ command, args, env: options.env })
    assert.equal(args[0], "auth")
    assert.equal(args[1], "export")
    return { code: 0, stdout: JSON.stringify(answers[args[2]] ?? []), stderr: "" }
  }
  const penv = profileEnv("/profile", { PATH: "/bin", HOME: "/real" })
  const out = await exportTargets({ binary: "/stub/opencode", penv, caller: { EVALS_AUTH_STANDALONE: "1" }, targets: exportTargetsFor(["slack", "gws", "slack"]), exec })
  assert.deepEqual(calls.map((c) => c.args), [["auth", "export", "slack", "--standalone"], ["auth", "export", "gws-default", "--standalone"]], "one export per vendor, deduped")
  assert.equal(calls[0].command, "/stub/opencode")
  assert.equal(calls[0].env.HOME, "/profile", "the evals profile's own environment")
  assert.deepEqual(Object.keys(out), ["slack", "gws-default"])
  // A batch for slack exports only slack: x-app's credential never leaves the profile.
  calls.length = 0
  const slackOnly = await exportTargets({ binary: "/stub/opencode", penv, targets: exportTargetsFor(["slack"]), exec })
  assert.deepEqual(calls.map((c) => c.args), [["auth", "export", "slack"]])
  assert.deepEqual(Object.keys(slackOnly), ["slack"])
  assert.deepEqual(vendorCredentials(slackOnly, { needed: ["slack"] }).list.map((c) => c.integrationID), ["slack-app"])
})

test("a batch's credentials are checked for expiry and refused when missing or stale", () => {
  const linear = { linear: JSON.stringify([oauth("linear")]) }
  assert.throws(() => vendorCredentials(linear, { needed: ["linear"], horizonMs: 9 * 3_600_000 }), /the linear token expires at .* within the \d+ minutes/)
  const none = { linear: JSON.stringify([oauth("linear", { expires: undefined })]) }
  assert.throws(() => vendorCredentials(none, { needed: ["linear"] }), /has no expiry/)
  assert.equal(vendorCredentials(none, { needed: ["linear"], acceptUnknownExpiry: true }).list.length, 1)
  assert.throws(() => vendorCredentials({ linear: "not json" }, { needed: ["linear"] }), /`auth export linear` is not JSON/)
  assert.deepEqual(secretsOf({ value: { access: "short" } }), [], "a value under 8 characters is not a secret to scrub")
})

test("the evals profile's environment is its own, and --auth takes +profile on any source", () => {
  const env = profileEnv("/profile", { PATH: "/usr/bin", HOME: "/real", OPENCODE_PASSWORD: "p", CLAUDE_CODE_OAUTH_TOKEN: "t", XDG_DATA_HOME: "/real/x" })
  assert.deepEqual(Object.keys(env).sort(), ["CLAUDE_CONFIG_DIR", "HOME", "OPENCODE_DISABLE_AUTOUPDATE", "OPENCODE_DISABLE_CLAUDE_CODE", "OPENCODE_TEST_HOME", "PATH", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"])
  assert.equal(env.HOME, "/profile")
  assert.deepEqual(parseAuth("claude-agent+profile"), { kind: "claude-agent", vendor: true })
  assert.deepEqual(parseAuth("env:OPENCODE_API_KEY+profile"), { kind: "env", names: ["OPENCODE_API_KEY"], vendor: true })
  assert.deepEqual(parseAuth("none+profile"), { kind: "none", vendor: true })
  assert.equal(parseAuth("none").vendor, undefined)
  assert.throws(() => parseAuth("+profile"), /--auth is required/)
})

// ------------------------------------------------------------------------------------------------ secrets in their other shapes

test("a secret is scrubbed in base64, base64url, URL-encoded, JSON-escaped and line-folded forms; URLs, scopes and addresses are left alone", () => {
  const token = "ya29.a0AfH6SMB-token_0123456789/abcdefghijklmnopqrstuvwxyz+ABCDEFGHIJ=="
  const forms = [token, Buffer.from(token).toString("base64"), Buffer.from(token).toString("base64url"), encodeURIComponent(token), JSON.stringify(token).slice(1, -1)]
  const redact = redactor([token])
  for (const form of forms) assert.ok(!redact(`before ${form} after`).includes(form), form.slice(0, 20))
  // The long forms folded at 64 and at 76 columns, as a tool prints them.
  const b64 = Buffer.from(token).toString("base64")
  for (const width of [64, 76]) {
    const folded = b64.match(new RegExp(`.{1,${width}}`, "g")).join("\n")
    assert.equal(redact(`x\n${folded}\ny`).includes(b64.slice(0, 20)), false, `folded at ${width}`)
  }
  const keep = "https://mcp.linear.app/mcp scope=read write user me@example.org"
  assert.equal(redact(keep), keep)
  assert.deepEqual(expand("short"), [], "under 8 characters is not a secret")
  assert.ok(expand(token).length >= 5)
  // The registered secrets scrub text too (every line logged and every file written).
  registerSecrets([token])
  assert.ok(!scrub(`log ${Buffer.from(token).toString("base64url")}`).includes(Buffer.from(token).toString("base64url").slice(0, 24)))
})

// ------------------------------------------------------------------------------------------------ R5: placeholders, data, seeds

const mkCaseText = (id, header = "", prompt = "list my issues") => `# ${id}
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: test
- Decision tested: x
${/Data:/.test(header) ? "" : "- Data: synthetic\n"}${/Set:/.test(header) ? "" : "- Set: local\n"}${header}
## Prompt
${prompt}

## Items
- [LIN-OC01] major · It answers the question asked.
  evidence: text:any matches /./
`
const mkCase = (id, header, prompt) => compileCase(`cases/linear/${id}.md`, mkCaseText(id, header, prompt))

test("placeholders are filled from the store at run time, and a prompt that cannot be filled is deferred, never sent", () => {
  const targets = flatten({ slack: { sandbox_channel: "C0SANDBOX" }, linear: { team_key: ["EVL"] } })
  const canaries = flatten({ linear_cycle: "Cycle 7q3" })
  assert.deepEqual(fillPrompt("post to {{target:slack.sandbox_channel}} about {{canary:linear_cycle}}", { targets, canaries }), { text: "post to C0SANDBOX about Cycle 7q3", unknown: [] })
  assert.deepEqual(fillPrompt("{{target:slack.nope}} and {{target:linear.team_key}}", { targets, canaries }).unknown, ["{{target:slack.nope}}"])
  assert.deepEqual(fillPrompt("no placeholders", {}), { text: "no placeholders", unknown: [] })
  assert.deepEqual(placeholdersIn("{{target:a.b}} {{canary:c}} {{other:x}}").map((p) => p.text), ["{{target:a.b}}", "{{canary:c}}"])
  const cases = [mkCase("tools-a", "", "send to {{target:slack.sandbox_channel}}"), mkCase("tools-b", "", "send to {{target:slack.missing}}"), mkCase("tools-c", "- Data: real"), mkCase("tools-d", "- Data: candidate"), mkCase("tools-e", "- Data: synthetic")]
  // Nothing a third party wrote goes to any model by default: Claude and DeepSeek alike need the owner's data-matrix sign-off.
  const claude = gateCases(cases, { model: "claude-agent/haiku", targets })
  assert.deepEqual(claude.runnable.map((c) => c.id), ["tools-a", "tools-e"])
  assert.match(claude.deferred.find((d) => d.case === "tools-b").why, /cannot fill \{\{target:slack\.missing\}\}/)
  assert.match(claude.deferred.find((d) => d.case === "tools-c").why, /Data: real may not run on claude-agent\/haiku: the owner's data-matrix sign-off .* does not list it for real data/)
  assert.match(claude.deferred.find((d) => d.case === "tools-d").why, /Data: candidate may not run on claude-agent\/haiku/)
  assert.equal(claude.prompts.get("tools-a"), "send to C0SANDBOX")
  const deepseek = gateCases(cases, { model: "opencode/deepseek-v4.1-flash", targets })
  assert.deepEqual(deepseek.runnable.map((c) => c.id), ["tools-a", "tools-e"])
  assert.match(deepseek.deferred.find((d) => d.case === "tools-c").why, /a third party's words stay off DeepSeek unless it says so/)
  // The sign-off lists models per kind of data; a trailing * matches a prefix.
  const matrix = { real: ["claude-agent/*"], candidate: ["claude-agent/sonnet"] }
  assert.deepEqual(gateCases(cases, { model: "claude-agent/haiku", targets, matrix }).runnable.map((c) => c.id), ["tools-a", "tools-c", "tools-e"], "real is signed off for any claude-agent model, candidate for sonnet only")
  assert.deepEqual(gateCases(cases, { model: "claude-agent/sonnet", targets, matrix }).runnable.map((c) => c.id), ["tools-a", "tools-c", "tools-d", "tools-e"])
  assert.deepEqual(gateCases(cases, { model: "opencode/deepseek-v4.1-flash", targets, matrix }).runnable.map((c) => c.id), ["tools-a", "tools-e"], "the matrix does not list DeepSeek")
  assert.deepEqual(gateCases(cases, { model: "opencode/deepseek-v4.1-flash", targets, matrix: { real: ["opencode/*"] } }).runnable.map((c) => c.id), ["tools-a", "tools-c", "tools-e"], "an explicit entry is the owner's switch")
  // The sign-off file is the owner's, in the store; none means none.
  const root = scratch()
  try {
    assert.deepEqual(loadDataMatrix({ EVALS_STORE: join(root, "none") }), {})
    mkdirSync(join(root, "store"))
    writeFileSync(join(root, "store", "data-matrix.json"), JSON.stringify({ real: ["claude-agent/*"], synthetic: ["x"], candidate: "not a list" }))
    assert.deepEqual(loadDataMatrix({ EVALS_STORE: join(root, "store") }), { real: ["claude-agent/*"] }, "only third-party kinds, only lists")
    writeFileSync(join(root, "store", "data-matrix.json"), "{ not json")
    assert.deepEqual(loadDataMatrix({ EVALS_STORE: join(root, "store") }), {}, "an unreadable sign-off allows nothing")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  // A legacy corpus's case that omits Data: takes what the corpus always held: x reads other people's posts, so it is real.
  const legacy = compileCase("cases/x/bookmark-asks-first.md", mkCaseText("bookmark-asks-first", "").replace(/- Plugin: linear/, "- Plugin: x").replace("- Set: local\n", "").replace("- Data: synthetic\n", ""))
  assert.equal(dataOf(legacy), "real")
  assert.deepEqual(gateCases([legacy], { model: "claude-agent/haiku" }).runnable, [])
})

test("Seed: files= copies a seed's plain files into the project, and refuses a link, an unknown name and a path", () => {
  const root = scratch()
  try {
    const seeds = join(root, "fixtures", "seeds", "jobs-nightly")
    mkdirSync(join(seeds, ".opencode", "jobs"), { recursive: true })
    writeFileSync(join(seeds, ".opencode", "jobs", "nightly.md"), "---\nname: nightly\n---\nhello\n")
    writeFileSync(join(seeds, "README.md"), "seed\n")
    const project = join(root, "project")
    mkdirSync(project)
    assert.deepEqual(seedFiles("files=jobs-nightly cwd=api", project, { root }).sort(), [".opencode/jobs/nightly.md", "README.md"])
    assert.equal(readFileSync(join(project, ".opencode", "jobs", "nightly.md"), "utf8"), "---\nname: nightly\n---\nhello\n")
    assert.deepEqual(seedFiles("cwd=api", project, { root }), [], "no files= is no seed")
    assert.throws(() => seedFiles("files=nope", project, { root }), /no directory fixtures\/seeds\/nope/)
    assert.throws(() => seedFiles("files=../etc", project, { root }), /seed name/)
    symlinkSync("/etc/hostname", join(seeds, "link"))
    assert.throws(() => seedFiles("files=jobs-nightly", join(root, "p2"), { root }), /symbolic link/)
    // A private seed lives in the store.
    const store = join(root, "store")
    mkdirSync(join(store, "seeds", "private-one"), { recursive: true })
    writeFileSync(join(store, "seeds", "private-one", "a.txt"), "x")
    assert.equal(seedDir("private-one", { root, env: { EVALS_STORE: store } }), join(store, "seeds", "private-one"))
    assert.equal(seedDir("absent", { root, env: { EVALS_STORE: store } }), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------------------------------------ R3: per-batch egress

test("a batch reaches the model's hosts, plus the hosts of the credentialed plugins its cases name, and nothing a case can widen", () => {
  const packs = [{ id: "linear", egress: ["mcp.linear.app"] }, { id: "jira", egress: ["mcp.atlassian.com", "{target:jira.site}.atlassian.net"] }, { id: "slack", egress: ["mcp.slack.com", "slack.com"] }]
  const targets = flatten({ jira: { site: "example-site" } })
  const base = ["api.anthropic.com", "claude.ai"]
  const cases = [{ seed: "plugins=linear,jira" }, { seed: "plugins=jira" }, { seed: null }]
  const credentialed = batchEgress({ model: "claude-agent/haiku", vendor: true, cases, packs, targets, base })
  assert.deepEqual(credentialed.allow, ["api.anthropic.com", "api.atlassian.com", "auth.atlassian.com", "claude.ai", "console.anthropic.com", "example-site.atlassian.net", "mcp.atlassian.com", "mcp.linear.app", "platform.claude.com"].filter((h) => ["api.anthropic.com", "claude.ai", "console.anthropic.com", "platform.claude.com", "mcp.atlassian.com", "mcp.linear.app", "example-site.atlassian.net"].includes(h)))
  assert.ok(!credentialed.allow.includes("mcp.slack.com"), "slack is not named by any case")
  assert.deepEqual(credentialed.plugins, ["jira", "linear"])
  // No credential: no vendor host at all, whatever the cases name.
  assert.deepEqual(batchEgress({ model: "claude-agent/haiku", vendor: false, cases, packs, targets, base }).allow, ["api.anthropic.com", "claude.ai"])
  // DeepSeek goes through Zen: its host, not Claude's.
  assert.deepEqual(batchEgress({ model: "opencode/deepseek-v4.1-flash", vendor: false, cases: [], packs, base }).allow, ["opencode.ai"])
  assert.deepEqual(batchEgress({ model: "opencode/deepseek-v4.1-flash", vendor: true, cases, packs, targets, base: [...base, "opencode.ai", "mcp.linear.app"], explicit: true }).allow.sort(), ["mcp.linear.app", "opencode.ai"], "the owner's list is a ceiling")
  assert.match(batchEgress({ model: "claude-agent/haiku", vendor: true, cases, packs, targets: null, base }).skipped.join(";"), /jira: \{target:jira\.site\}\.atlassian\.net/)
  assert.equal(fillHost("{target:jira.site}.atlassian.net", targets), "example-site.atlassian.net")
  assert.equal(fillHost("{target:nope}.atlassian.net", targets), null)
  assert.equal(modelHosts("mock/m1"), null)
})

// ------------------------------------------------------------------------------------------------ R9: the round's ceiling

function ledgerWith(store, entries) {
  mkdirSync(join(store, "ledger"), { recursive: true })
  writeFileSync(join(store, "ledger", "runs.jsonl"), entries.map((e) => JSON.stringify(e)).join("\n") + "\n")
}

test("the round's ceiling counts every run at list price, the cheaper of the ceiling and the cap binding, and refuses a run it cannot price", () => {
  const store = scratch()
  try {
    writeFileSync(join(store, "caps.json"), JSON.stringify({ round_cap_usd: 720, estimate_run_usd: { "claude-agent/haiku": { wide: 0.006, deep: 0.03 } } }))
    assert.deepEqual(roundLimits(store, {}), { ceiling: null, cap: 720, limit: 720, binds: "round cap" })
    const limits = roundLimits(store, { EVALS_ROUND_CEILING_USD: "14" })
    assert.deepEqual([limits.limit, limits.binds], [14, "phase ceiling"])
    assert.equal(roundLimits(store, { EVALS_ROUND_CEILING_USD: "900" }).binds, "round cap", "the cap binds when it is lower")
    assert.throws(() => roundLimits(store, { EVALS_ROUND_CEILING_USD: "lots" }), /EVALS_ROUND_CEILING_USD must be a number/)
    assert.equal(tierOf({ sets: ["deep"] }), "deep")
    assert.equal(tierOf({ sets: ["commit"] }), "deep")
    assert.equal(tierOf({ sets: ["wide"] }), "wide")
    assert.equal(tierOf({}), "wide")
    // spent at list (a subscription's $0 billed does not count it out), and the table's estimate until enough runs are measured
    ledgerWith(store, [{ kind: "run", batch: "b1", model: "claude-agent/haiku", tier: "wide", billed_usd: 0, list_usd: 6, tokens: {} }])
    assert.equal(listSpent(store).usd, 6)
    assert.equal(estimateRunUsd(store, "claude-agent/haiku", "wide", {}).usd, 0.006, "one measured run is below the five a mean needs: the table's estimate stands")
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})

test("the per-launch check: spent + other batches' reserved runs + this batch's in flight + this run, against the ceiling", () => {
  const store = scratch()
  try {
    writeFileSync(join(store, "caps.json"), JSON.stringify({ estimate_run_usd: { "m/a": { wide: 1, deep: 2 } } }))
    const env = { EVALS_ROUND_CEILING_USD: "10" }
    // nothing spent: runs at $1 fit until the ceiling
    assert.equal(assertLaunchWithinRound(store, { model: "m/a", tier: "wide", running: 0 }, env).projected, 1)
    assert.equal(assertLaunchWithinRound(store, { model: "m/a", tier: "wide", running: 9 }, env).projected, 10)
    assert.throws(() => assertLaunchWithinRound(store, { model: "m/a", tier: "wide", running: 10 }, env), /phase ceiling: the next m\/a run would take the round to \$11\.00 of \$10/)
    assert.equal(assertLaunchWithinRound(store, { model: "m/a", tier: "deep", running: 4 }, env).projected, 10, "a deep run is priced as deep")
    // spent: recorded list cost counts
    ledgerWith(store, [{ kind: "run", batch: "b1", model: "m/a", tier: "wide", list_usd: 9.5 }])
    assert.throws(() => assertLaunchWithinRound(store, { model: "m/a", tier: "wide", running: 0 }, env), RoundCapError)
    // other batches' reserved runs count; this batch's own reservation does not (its runs are checked one by one)
    ledgerWith(store, [{ kind: "reserve", batch: "other", runs: 8, per_run_list_usd: 1, month: "2026-11" }, { kind: "reserve", batch: "mine", runs: 8, per_run_list_usd: 1, month: "2026-11" }])
    assert.equal(assertLaunchWithinRound(store, { model: "m/a", tier: "wide", running: 0, batch: "mine" }, env).others, 8)
    assert.throws(() => assertLaunchWithinRound(store, { model: "m/a", tier: "wide", running: 2, batch: "mine" }, env), /ceiling/)
    assert.deepEqual(outstandingList([{ kind: "reserve", batch: "x", runs: 5, per_run_list_usd: 2 }, { kind: "run", batch: "x" }, { kind: "release", batch: "x", runs: 1 }]), { usd: 6, runs: 3, unpriced: 0 })
    // a run with no estimate cannot be held to the ceiling while one is set, and is not checked when none is
    assert.throws(() => assertLaunchWithinRound(store, { model: "m/unpriced", tier: "wide", running: 0 }, env), /cannot hold m\/unpriced to \$10: no estimate for m\/unpriced at tier wide/)
    // fail closed (G0 review 1.3): with no ceiling and no cap a model that bills is refused, and only the scripted model is exempt
    assert.throws(() => assertLaunchWithinRound(store, { model: "m/unpriced", tier: "wide", running: 0 }, {}), /no round ceiling or cap is set: cannot hold m\/unpriced to anything/)
    assert.throws(() => assertLaunchWithinRound(store, { model: "claude-agent/haiku", tier: "wide", running: 0 }, {}), /no round ceiling or cap is set/)
    assert.deepEqual(assertLaunchWithinRound(store, { model: "mock/m1", tier: "wide", running: 0 }, {}), { enforced: false, metered: false })
    // the measured mean replaces the table once enough runs are in
    const runs = Array.from({ length: MIN_MEASURED_RUNS }, (_, i) => ({ kind: "run", batch: `b${i}`, model: "m/a", tier: "wide", list_usd: 3 }))
    ledgerWith(store, runs)
    const estimate = estimateRunUsd(store, "m/a", "wide", {})
    assert.equal(estimate.usd, 3)
    assert.match(estimate.basis, /75th-percentile list cost of 5 recorded wide run/)
    assert.equal(estimateRunUsd(store, "m/a", "deep", {}).usd, 2, "deep still has only the table")
    assert.equal(estimateRunUsd(store, "m/other", "wide", { EVALS_ASSUMED_RUN_USD: "0.5" }).usd, 0.5)
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})

test("a run is priced at list from its tokens through the model map, whatever was billed", () => {
  const dir = scratch()
  try {
    const catalog = join(dir, "models.json")
    writeFileSync(catalog, JSON.stringify({ anthropic: { models: { "claude-sonnet-5-5": { cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 } } } } }))
    const map = join(dir, "map.json")
    writeFileSync(map, JSON.stringify({ "claude-agent/sonnet": { to: "anthropic/claude-sonnet-5-5", asOf: "2026-11-18" } }))
    const info = modelPrice("claude-agent/sonnet", { EVALS_MODELS_CATALOG: catalog, EVALS_MODEL_MAP: map })
    assert.equal(info.via, "mapping")
    assert.equal(listUsdOf({ input: 1_000_000, output: 100_000, cacheRead: 1_000_000, cacheWrite: 0 }, info.price), 3 + 1.5 + 0.3)
    assert.equal(listUsdOf({ input: 1 }, null), null)
    assert.match(modelPrice("nobody/none", { EVALS_MODELS_CATALOG: catalog, EVALS_MODEL_MAP: map }).why, /no catalogue entry/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------------------------------------ R1: companions

test("companions are a map from a plugin id to a built directory, from the arm file or a file it names, and the arm is never its own companion", () => {
  const dir = scratch()
  try {
    writeFileSync(join(dir, "companions.json"), JSON.stringify({ _note: "x", slack: "./slack", linear: { package: "./linear", options: { x: 1 } }, jira: "./jira" }))
    const list = readCompanions("companions.json", { base: dir, exclude: ["jira"] })
    assert.deepEqual(list.map((c) => c.id), ["linear", "slack"])
    assert.equal(list[0].source, join(dir, "linear"))
    assert.deepEqual(list[0].extra, { x: 1 })
    assert.deepEqual(readCompanions({ a: "/x/a" }, { base: dir }).map((c) => c.id), ["a"])
    assert.deepEqual(readCompanions(undefined), [])
    assert.throws(() => readCompanions("missing.json", { base: dir }), /does not exist/)
    assert.throws(() => readCompanions(["a"], { base: dir }), /map from a plugin id/)
    assert.throws(() => readCompanions({ "Bad Id": "/x" }, { base: dir }), /must be a plugin id/)
    assert.throws(() => readCompanions({ a: { options: {} } }, { base: dir }), /names no built directory/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a materialised plugin carries what its package.json lists (guest/, manifest/, licenses/), which dist alone lost for boxd and gws", () => {
  const dir = scratch()
  try {
    const src = join(dir, "src-plugin")
    for (const d of ["dist", "skills/x", "guest", "manifest", "licenses/gws", "node_modules/dep", "src", "test", "assets"]) mkdirSync(join(src, d), { recursive: true })
    writeFileSync(join(src, "package.json"), JSON.stringify({ name: "@x/p", version: "1.2.3", files: ["dist", "guest", "skills", "manifest/generated.json", "licenses/gws", "assets/icon.svg", "README.md", "!dist/**/*.map"] }))
    for (const f of ["dist/index.js", "skills/x/SKILL.md", "guest/guest.py", "manifest/generated.json", "manifest/other.json", "licenses/gws/LICENSE", "node_modules/dep/index.js", "src/a.ts", "test/a.test.ts", "assets/icon.svg", "assets/other.png"]) writeFileSync(join(src, f), "x")
    assert.deepEqual(runtimePaths(src).sort(), ["README.md", "assets", "assets/icon.svg", "dist", "guest", "licenses/gws", "manifest/generated.json", "skills"])
    const into = join(dir, "arm")
    materialiseArm(src, into)
    for (const f of ["dist/index.js", "guest/guest.py", "manifest/generated.json", "licenses/gws/LICENSE", "skills/x/SKILL.md", "package.json"]) assert.ok(existsSync(join(into, f)), f)
    for (const f of ["node_modules", "src", "test", "manifest/other.json"]) assert.equal(existsSync(join(into, f)), false, `${f} is not copied`)
    const [one] = materialiseCompanions([{ id: "p", source: src, extra: {} }], join(dir, "companions"), { options: (id, extra) => ({ ...extra, access: "ask-changes" }) })
    assert.equal(one.version, "1.2.3")
    assert.deepEqual(one.options, { access: "ask-changes" })
    assert.notEqual(companionsDigest([one]), companionsDigest([]))
    assert.match(companionsDigest([]), /^[0-9a-f]{64}$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------------------------------------ the guard's log and the host's

test("what the guard saw and what the host logged about plugins are summarised, and a plugin that failed to load is named", () => {
  const records = [{ kind: "guard_start" }, { kind: "ask", own: true }, { kind: "ask", own: false }, { kind: "reject" }, { kind: "assert", what: "write" }, { kind: "assert", what: "access" }, { kind: "assert", what: "committed" }, { kind: "committed" }, { kind: "execute_before", write: true }]
  assert.deepEqual(guardSummary(records), { ran: true, asks: 2, rejected: 1, reject_failed: 0, asks_left_to_run: 1, refused_writes: 1, refused_tools: 0, assert_access: 1, assert_committed: 1, committed: 1, write_calls: 1 })
  assert.equal(guardSummary([]).ran, false)
  const home = scratch()
  try {
    mkdirSync(join(home, ".local", "share", "opencode", "log"), { recursive: true })
    writeFileSync(join(home, ".local", "share", "opencode", "log", "opencode.log"), [
      'timestamp=t level=INFO message="loading plugin" id=/x',
      'timestamp=t level=WARN run=r message="failed to load plugin" plugin.id=boxd.machines cause="Cause([Die(Error: guest.py is missing)])" http.span=1',
      'timestamp=t level=WARN run=r message="mcp connect failed" server=affinity',
    ].join("\n"))
    assert.deepEqual(hostLogFacts(home), { log: true, warnings: 2, plugin_load_failures: [{ plugin: "boxd.machines", why: "Cause([Die(Error: guest.py is missing)])" }] })
    assert.deepEqual(hostLogFacts(join(home, "none")), { log: false })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------------------------------------ a locked run's sealed config

const UNCONFINED = { isolation: "none", unsafeNoIsolation: true }
const quiet = { log: () => {} }

function fixture({ extra = "", ids = ["demo-a", "demo-b"] } = {}) {
  const root = scratch()
  const casesDir = join(root, "cases")
  mkdirSync(casesDir)
  const text = (id, header) => `# ${id}\n- Plugin: demo\n- Skill under test: demo\n- Tier: T3\n- Source: test\n- Decision tested: x\n${/Data:/.test(header) ? "" : "- Data: synthetic\n"}${header}\n## Prompt\nhello ${id}\n\n## Items\n- [D-OC01] blocker · It says something.\n  evidence: text:any matches /./\n`
  for (const [id, header] of [[ids[0], extra], [ids[1], ""]]) {
    writeFileSync(join(casesDir, `${id}.md`), text(id, header))
    writeFileSync(join(casesDir, `${id}.json`), JSON.stringify(compileCase(`cases/demo/${id}.md`, text(id, header))))
  }
  const arm = join(root, "plugin")
  mkdirSync(join(arm, "dist"), { recursive: true })
  writeFileSync(join(arm, "package.json"), JSON.stringify({ name: "@demo/plugin", version: "0.0.1" }))
  writeFileSync(join(arm, "dist", "index.js"), "export default {}\n")
  const companion = join(root, "other")
  mkdirSync(join(companion, "dist"), { recursive: true })
  writeFileSync(join(companion, "package.json"), JSON.stringify({ name: "@demo/other", version: "0.2.0" }))
  writeFileSync(join(companion, "dist", "index.js"), "export default {}\n")
  const home = join(root, "user")
  mkdirSync(home)
  const bin = join(root, "bin")
  mkdirSync(bin)
  const tmp = join(root, "tmp")
  mkdirSync(tmp)
  const caller = { PATH: process.env.PATH, HOME: home, EVALS_STORE: join(root, "store"), EVALS_OPENCODE_BIN: installFakeOpencode(bin), EVALS_BUN: installFakeBun(bin), EVALS_TMP: tmp }
  const armFile = join(root, "arm.json")
  writeFileSync(armFile, JSON.stringify({ package: arm, options: { access: "ask-changes" }, companions: { other: companion } }))
  return { root, casesDir, arm, armFile, caller, companion, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test("a locked run's sealed config removes the shell, file and web tools, asks every write, installs the companions at ask-changes and the guard", async () => {
  const f = fixture()
  try {
    const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "locked", model: "mock/m1", auth: "none", scripted: true, cases: "demo-b", arm: f.armFile, casesDir: f.casesDir, keep: true }, { caller: f.caller, ...quiet })
    const home = join(result.keptAt, "runs", "demo-b.t1", "home")
    const run = JSON.parse(readFileSync(join(home, "run.json"), "utf8"))
    const config = JSON.parse(run.env.OPENCODE_CONFIG_CONTENT)
    const { lockdownProblems } = await import("../src/run/lockdown.mjs")
    assert.deepEqual(lockdownProblems(config), [])
    // plugin order: the arm, its companions, the guard, the scripted provider last
    assert.deepEqual(config.plugins.map((p) => p.package.replace(result.keptAt, "")), ["/arm", "/companions/other", "/harness/guard", "/harness/mock/provider"])
    assert.deepEqual(config.plugins[0].options, { access: "ask-changes" })
    assert.deepEqual(config.plugins[1].options, { access: "ask-changes" })
    assert.equal(result.tools, "locked")
    assert.equal(result.guard.mode, "refuse")
    const policy = JSON.parse(readFileSync(join(result.keptAt, "harness", "guard", "guard.json"), "utf8"))
    assert.equal(policy.mode, "refuse")
    assert.ok(policy.writes.length > 400)
    assert.equal(statSyncMode(join(result.keptAt, "harness", "guard", "guard.json")) & 0o222, 0, "the policy is read-only")
    const recorded = JSON.parse(readFileSync(join(f.root, "store", "raw", "locked", "demo", "demo-b.t1.summary.json"), "utf8"))
    assert.equal(recorded.provenance.companion_list[0], "other@0.2.0")
    assert.equal(recorded.provenance.access, "ask-changes")
    assert.equal(recorded.guard.ran, false, "the stand-in host loads no plugin, so no guard record: said, not assumed")
  } finally {
    f.cleanup()
  }
})

const statSyncMode = (file) => statSync(file).mode & 0o777

test("--tools local keeps the shell and writes no lockdown, only for local cases and never with a credential", async () => {
  const f = fixture({ extra: "- Set: local" })
  try {
    const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "localrun", model: "mock/m1", auth: "none", scripted: true, cases: "demo-a", arm: f.arm, casesDir: f.casesDir, keep: true, tools: "local", set: "local" }, { caller: f.caller, ...quiet })
    const run = JSON.parse(readFileSync(join(result.keptAt, "runs", "demo-a.t1", "home", "run.json"), "utf8"))
    const config = JSON.parse(run.env.OPENCODE_CONFIG_CONTENT)
    assert.equal(config.policies, undefined)
    assert.equal(config.permissions, undefined)
    assert.deepEqual(config.plugins.map((p) => p.package.replace(result.keptAt, "")), ["/arm", "/harness/mock/provider"])
    // the arms and the sets must agree
    await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "l2", model: "mock/m1", auth: "none", scripted: true, cases: "demo-b", arm: f.arm, casesDir: f.casesDir, tools: "local" }, { caller: f.caller, ...quiet }), /--tools local runs only cases in set local/)
    await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "l3", model: "mock/m1", auth: "none", scripted: true, cases: "demo-a", arm: f.arm, casesDir: f.casesDir, set: "local" }, { caller: f.caller, ...quiet }), /are in set local .* run them with --tools local and no \+profile/)
    await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "l4", model: "mock/m1", auth: "none+profile", scripted: true, cases: "demo-a", arm: f.arm, casesDir: f.casesDir, tools: "local", set: "local" }, { caller: f.caller, ...quiet }), /--tools local .* refused with a vendor credential/)
    await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "l5", model: "mock/m1", auth: "none", scripted: true, arm: f.arm, casesDir: f.casesDir, tools: "weird" }, { caller: f.caller, ...quiet }), /--tools must be locked or local/)
  } finally {
    f.cleanup()
  }
})

test("a locked run that holds any credential runs every plugin at ask-changes, a commit case needs its plan, and a deferred case is said", async () => {
  const f = fixture({ extra: "- Set: commit", ids: ["commit-a", "demo-b"] })
  try {
    const base = { ...UNCONFINED, plugin: "demo", model: "mock/m1", scripted: true, casesDir: f.casesDir }
    const allAccess = join(f.root, "all.json")
    writeFileSync(allAccess, JSON.stringify({ package: f.arm, options: { access: "all" } }))
    await assert.rejects(runBatch({ ...base, iteration: "a1", auth: "env:DEMO_KEY", cases: "demo-b", arm: allAccess }, { caller: { ...f.caller, DEMO_KEY: "demo-key-0123456789" }, ...quiet }), /runs every plugin at ask-changes/)
    await assert.rejects(runBatch({ ...base, iteration: "a2", auth: "none+profile", cases: "demo-b", arm: allAccess }, { caller: f.caller, ...quiet }), /runs every plugin at ask-changes/, "+profile counts as a credential even with no model key")
    await assert.rejects(runBatch({ ...base, iteration: "a3", auth: "none", set: "commit", cases: "commit-a", arm: f.arm }, { caller: f.caller, ...quiet }), /are in set commit .* run only with --commit-plan/)
    await assert.rejects(runBatch({ ...base, iteration: "a4", auth: "none", cases: "commit-a,demo-b", set: "commit,tune", arm: f.arm, commitPlan: join(f.root, "plan.json") }, { caller: f.caller, ...quiet }), /--commit-plan runs only cases in set commit/)
    // with no credential an `access: all` probe is allowed: nothing to lose, and the guard gold suite needs it
    const ok = await runBatch({ ...base, iteration: "a5", auth: "none", cases: "demo-b", arm: allAccess, keep: true }, { caller: f.caller, ...quiet })
    const config = JSON.parse(JSON.parse(readFileSync(join(ok.keptAt, "runs", "demo-b.t1", "home", "run.json"), "utf8")).env.OPENCODE_CONFIG_CONTENT)
    assert.equal(config.plugins[0].options.access, "all")
    // a case a model may not see is deferred, with its reason (and a batch with nothing left to run is refused, naming them)
    const real = fixture({ extra: "- Data: real" })
    try {
      await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "d1", model: "opencode/deepseek-v4.1-flash", auth: "none", cases: "demo-a", arm: real.arm, casesDir: real.casesDir, set: "tune", tools: "local" }, { caller: real.caller, ...quiet }), /nothing to run: all 1 selected case\(s\) are deferred \(demo-a: Data: real may not run on opencode\/deepseek-v4\.1-flash/)
    } finally {
      real.cleanup()
    }
  } finally {
    f.cleanup()
  }
})

// ------------------------------------------------------------------------------------------------ R10, R13, R14

import { checkBalances, vendorUseOf, TAVILY_CREDITS } from "../src/run/balance.mjs"
import { dataPreflight } from "../src/run/gate.mjs"
import { rateLimited, BACKOFF_S } from "../src/run/runner.mjs"
import { rmSync as rmFile } from "node:fs"
import { createHash } from "node:crypto"

test("a spending plugin runs only under a written cap, by the ledger's count and the vendor's own balance, whichever is larger", async () => {
  const ledger = [{ kind: "run", vendor_use: { tavily_credits: 400, affinity_calls: 990 } }, { kind: "run", vendor_use: { tavily_credits: 20 } }]
  const limits = { tavily_credits: 500, affinity_calls: 1000, x_usd: 15, openrouter_usd: 5 }
  const ok = await checkBalances({ plugins: ["tavily"], runsByPlugin: { tavily: 1 }, ledger: [], limits })
  assert.equal(ok.ok, true)
  assert.match(ok.lines[0], /tavily: tavily_credits 0\.00 used \(ledger\), \+50\.00 worst case, of 500/)
  const over = await checkBalances({ plugins: ["tavily"], runsByPlugin: { tavily: 2 }, ledger, limits })
  assert.equal(over.ok, false)
  assert.match(over.refusals[0], /tavily: tavily_credits would reach 520\.00 of 500/)
  assert.equal((await checkBalances({ plugins: ["affinity"], runsByPlugin: { affinity: 3 }, ledger, limits })).ok, false, "990 used + 3 runs of 5 calls is over the firm quota of 1000")
  // the vendor's own number wins when it is larger
  const reported = await checkBalances({ plugins: ["tavily"], runsByPlugin: { tavily: 1 }, ledger: [], limits, live: { tavily: async () => 480 } })
  assert.equal(reported.ok, false)
  assert.match(reported.lines[0], /vendor reports 480, ledger 0/)
  // a balance that cannot be read is a refusal, not a guess; a plugin with no written cap is refused; a non-spending plugin is not checked
  assert.match((await checkBalances({ plugins: ["x"], runsByPlugin: { x: 1 }, limits, live: { x: async () => { throw new Error("401") } } })).refusals[0], /balance could not be read \(401\)/)
  assert.match((await checkBalances({ plugins: ["tavily"], runsByPlugin: { tavily: 1 }, limits: {} })).refusals[0], /no limit for tavily_credits in caps\.json "vendors"/)
  assert.deepEqual(await checkBalances({ plugins: ["slack", "linear"], limits: {} }), { ok: true, lines: [], refusals: [] })
  assert.equal(TAVILY_CREDITS.research, 250)
  assert.deepEqual(vendorUseOf(["tools.tavily.tavily_search", "tavily_research", "tools.affinity.get_company", "affinity_search", "slack_send"]), { tavily_credits: 252, affinity_calls: 2, x_usd: 0, openrouter_usd: 0 })
})

test("--preflight data defers a case whose clauses name a target, a canary or a seed the store lacks, and says which", () => {
  const targets = flatten({ slack: { sandbox_channel: "C0SANDBOX" } })
  const canaries = flatten({ linear_cycle: "Cycle 7q3" })
  const ok = compileCase("cases/slack/tools-ok.md", `# tools-ok\n- Plugin: slack\n- Skill under test: slack\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: synthetic\n- Set: wide\n\n## Prompt\np\n\n## Items\n- [SLK-PR01] major · Addressed to the sandbox channel.\n  evidence: target:slack.slack_send_message#1 args.channel_id in @slack.sandbox_channel\n- [SLK-OC01] major · States the cycle.\n  evidence: text:any contains @canary.linear_cycle\n`)
  const bad = compileCase("cases/slack/tools-bad.md", `# tools-bad\n- Plugin: slack\n- Skill under test: slack\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: synthetic\n- Set: wide\n- Seed: files=no-such-seed\n\n## Prompt\np\n\n## Items\n- [SLK-PR01] major · Addressed to the self DM.\n  evidence: target:slack.slack_send_message#1 args.channel_id in @slack.self_dm\n- [SLK-OC01] major · States a cycle.\n  evidence: text:any contains @canary.nope\n`)
  const root = scratch()
  try {
    const out = dataPreflight([ok, bad], { targets, canaries, env: { EVALS_STORE: join(root, "store") }, root })
    assert.deepEqual(out.map((d) => d.case), ["tools-bad", "tools-bad"])
    assert.match(out[0].why, /@slack\.self_dm, @canary\.nope, which the store lacks/)
    assert.match(out[1].why, /Seed files=no-such-seed has no directory/)
    assert.deepEqual(dataPreflight([ok], { targets, canaries, env: { EVALS_STORE: join(root, "store") }, root }), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a 429 with no model work is a rate limit, not an auth failure, a provider failure or work", () => {
  const e429 = JSON.stringify({ type: "error", error: { type: "provider.rate-limit", message: "429 rate_limit_error: too many requests" } })
  assert.equal(rateLimited({ stdout: e429, stderr: "" }), true)
  assert.equal(rateLimited({ stdout: "", stderr: "Error: 429 Too Many Requests" }), true)
  assert.equal(rateLimited({ stdout: "", stderr: "Error: service overloaded" }), true)
  const worked = `${JSON.stringify({ type: "step_finish", part: { cost: 0, tokens: { input: 10, output: 5, cache: { read: 0, write: 0 } } } })}\n${e429}`
  assert.equal(rateLimited({ stdout: worked, stderr: "" }), false, "a run that did model work is not retried: it spent")
  assert.equal(rateLimited({ stdout: "", stderr: 'Error: 401 {"error":{"type":"authentication_error","message":"OAuth token has expired"}}' }), false)
  assert.equal(rateLimited({ stdout: "", stderr: "" }), false)
  assert.deepEqual(BACKOFF_S, [60, 120, 240])
  // A retry only with attempts left and the previous container confirmed gone.
  assert.deepEqual(rateLimitOutcome(0, true), { retry: true })
  assert.equal(rateLimitOutcome(0, false).retry, false)
  assert.equal(rateLimitOutcome(0, false).infra, "container")
  assert.deepEqual(rateLimitOutcome(3, true), { retry: false, infra: "rate-limit" })
  assert.deepEqual(rateLimitOutcome(3, false), { retry: false, infra: "rate-limit" })
})

const marker = (prompt) => `/tmp/evals-fake-429-${createHash("sha256").update(prompt).digest("hex").slice(0, 16)}`

test("a rate-limited run is tried again after a backoff and recorded once; after the last retry it is infra, released, and the model is paused after three in a row", async () => {
  const once = fixture({ ids: ["demo-a", "demo-b"] })
  const prompts = ["hello demo-a rate-limit-once", "hello demo-b rate-limit-always"]
  const recorded = (f, id, text) => {
    const file = join(f.casesDir, `${id}.md`)
    const body = readFileSync(file, "utf8").replace(`hello ${id}`, text)
    writeFileSync(file, body)
    writeFileSync(join(f.casesDir, `${id}.json`), JSON.stringify(compileCase(`cases/demo/${id}.md`, body)))
  }
  try {
    recorded(once, "demo-a", prompts[0])
    recorded(once, "demo-b", prompts[1])
    for (const p of prompts) rmFile(marker(p), { force: true })
    const caller = { ...once.caller, EVALS_BACKOFF_SCALE: "0.001" }
    const logs = []
    const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "rl", model: "mock/m1", auth: "none", scripted: true, cases: "demo-a,demo-b", arm: once.arm, casesDir: once.casesDir, tools: "locked", parallel: 1, keep: true }, { caller, log: (l) => logs.push(l) })
    const a = result.results.find((r) => r.case === "demo-a")
    const b = result.results.find((r) => r.case === "demo-b")
    assert.equal(a.rateLimited, undefined, "demo-a succeeded on its second attempt")
    assert.equal(a.exit, 0, JSON.stringify(result.results))
    assert.equal(b.infra, "rate-limit", "demo-b never stopped being refused")
    assert.ok(existsSync(join(result.keptAt, "runs", "demo-a.t1", "home")), "the first attempt's root is kept")
    assert.ok(existsSync(join(result.keptAt, "runs", "demo-a.t1.a1", "home")), "the retry got a fresh root, not the first attempt's")
    assert.ok(result.rate_limited >= 4, `${result.rate_limited} rate-limited attempts counted`)
    assert.ok(logs.some((l) => /was rate-limited \(attempt 1\): trying again after 60 s/.test(l)))
    assert.ok(logs.some((l) => /three rate-limited runs in a row: paused 30 min/.test(l)))
    const ledger = readFileSync(join(once.root, "store", "ledger", "runs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    assert.equal(ledger.filter((e) => e.kind === "run").length, 1, "only the run that worked is recorded")
    assert.equal(ledger.filter((e) => e.kind === "release").reduce((n, e) => n + e.runs, 0), 1, "the exhausted one is released, never billed")
    const summary = JSON.parse(readFileSync(join(once.root, "store", "raw", "rl", "demo", "demo-b.t1.summary.json"), "utf8"))
    assert.equal(summary.infra, "rate-limit")
    assert.equal(summary.attempts, 4)
  } finally {
    for (const p of prompts) rmFile(marker(p), { force: true })
    once.cleanup()
  }
})

// ------------------------------------------------------------------------------------------------ home files, integrations, t0

import { snapshotHome, changedHome } from "../src/run/files.mjs"
import { integrationsFor } from "../src/run/vendor-auth.mjs"
import { runView, gradeCase } from "../src/grade/grade.mjs"
import { parseSeed, parseSeedList } from "../src/run/world.mjs"
import { loadPacks } from "../src/run/lockdown.mjs"
import { spawnSync } from "node:child_process"

test("files a run wrote under named places of its HOME are recorded, and nothing else of the home is", () => {
  const home = scratch()
  try {
    mkdirSync(join(home, "Plaud"), { recursive: true })
    mkdirSync(join(home, "Secrets"), { recursive: true })
    writeFileSync(join(home, "Plaud", "old.txt"), "old")
    writeFileSync(join(home, "Secrets", "key"), "do not record")
    const before = snapshotHome(home, ["Plaud"])
    writeFileSync(join(home, "Plaud", "note.txt"), "the note\n")
    writeFileSync(join(home, "Plaud", "old.txt"), "changed")
    writeFileSync(join(home, "Secrets", "key"), "changed too")
    const changes = changedHome(before, home, ["Plaud"])
    assert.deepEqual(changes.map((c) => [c.path, c.change]), [["~/Plaud/note.txt", "added"], ["~/Plaud/old.txt", "modified"]])
    assert.equal(changes[0].text, "the note\n")
    assert.ok(!JSON.stringify(changes).includes("do not record"), "an unnamed place of the home is not in the record")
    assert.deepEqual(changedHome(snapshotHome(home, []), home, []), [])
    const c = compileCase("cases/plaud/tools-export.md", `# tools-export\n- Plugin: plaud\n- Skill under test: plaud\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: real\n- Set: wide\n- Home files: Plaud, Downloads/evals\n\n## Prompt\nexport it\n\n## Items\n- [PLD-OC01] major · It wrote the note.\n  evidence: file:~/Plaud/** exists\n`)
    assert.deepEqual(c.home_files, ["Plaud", "Downloads/evals"])
    assert.throws(() => compileCase("cases/plaud/tools-x.md", `# tools-x\n- Plugin: plaud\n- Skill under test: plaud\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: real\n- Home files: ../etc\n\n## Prompt\np\n\n## Items\n- [PLD-OC01] major · It wrote the note.\n  evidence: file:a exists\n`), /Home files/)
    // and a file: clause grades it
    const view = runView([{ schema: "oc-trace/1", run_id: "t/0", case: "t", exit: 0, summary: { text: { sha256: "0".repeat(64) }, tokens: {} } }], { files: changes })
    assert.equal(gradeCase(c, view).verdict, "PASS")
    assert.equal(gradeCase(c, runView([{ schema: "oc-trace/1", run_id: "t/0", case: "t", exit: 0, summary: { text: { sha256: "0".repeat(64) }, tokens: {} } }], { files: [] })).failed.includes("PLD-OC01"), true)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("one OpenRouter key serves two entries: both packs name both, and the per-trial export covers them", () => {
  const packs = loadPacks()
  for (const id of ["openrouter", "inference"]) assert.deepEqual([].concat(packs.find((p) => p.id === id).integration), ["openrouter", "inference-openrouter"], id)
  const parse = (seed) => parseSeedList(parseSeed(seed).plugins)
  assert.deepEqual(integrationsFor("inference", [], packs, parse), ["inference-openrouter", "openrouter"])
  assert.deepEqual(integrationsFor("slack", [{ seed: "plugins=linear,openrouter" }, { seed: null }], packs, parse), ["inference-openrouter", "linear", "openrouter", "slack"])
  assert.deepEqual(integrationsFor("unknown", [], [], parse), ["unknown"], "a plugin with no pack is its own integration")
})

test("evals t0 --plugin checks the named plugin's pack, and refuses one that has none", () => {
  const run = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, "..", "bin", "evals"), "t0", ...args], { encoding: "utf8", env: { ...process.env, EVALS_PLUGIN_ROOT: "", EVALS_STORE: "/nonexistent-store" } })
  const ok = run("--plugin", "slack")
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  assert.match(ok.stdout, /slack/)
  assert.match(ok.stdout, /P-05 the counts are the tools' own/)
  const bad = run("--plugin", "nosuchplugin")
  assert.notEqual(bad.status, 0)
  assert.match(bad.stderr, /no pack for nosuchplugin/)
})

// ------------------------------------------------------------------------------------------------ G8: assets, and local writes in a commit plan

import { parseAssets, checkAssets, containerConfig, ASSETS_DIR, containerBackend } from "../src/run/container.mjs"
import { decideBefore } from "../src/run/guard/logic.mjs"
import { buildPolicy } from "../src/run/guard/policy.mjs"

test("assets the owner mounts into every trial are validated, found on the host, and given their own variables", () => {
  const dir = scratch()
  try {
    mkdirSync(join(dir, "speech"), { recursive: true })
    writeFileSync(join(dir, "speech", "model.bin"), "x".repeat(100))
    mkdirSync(join(dir, "empty"))
    writeFileSync(join(dir, "browse-bin"), "#!/bin/sh\n")
    const assets = parseAssets([{ name: "speech", host: join(dir, "speech"), env: { UTILITIES_SPEECH_DIR: "", MODEL: "model.bin" } }, { name: "browse-bin", host: join(dir, "browse-bin") }, { name: "empty", host: join(dir, "empty") }, { name: "gone", host: join(dir, "gone") }])
    assert.deepEqual(checkAssets(assets).map((r) => [r.name, r.ok]), [["speech", true], ["browse-bin", true], ["empty", false], ["gone", false]])
    assert.match(checkAssets(assets)[2].why, /is empty/)
    assert.match(checkAssets(assets)[3].why, /does not exist/)
    assert.deepEqual(parseAssets(undefined), [])
    assert.throws(() => parseAssets("x"), /must be a list/)
    assert.throws(() => parseAssets([{ name: "Bad Name", host: "/x" }]), /lower-case words/)
    assert.throws(() => parseAssets([{ name: "a", host: "relative" }]), /absolute path/)
    assert.throws(() => parseAssets([{ name: "a", host: "/x,y" }]), /comma/)
    assert.throws(() => parseAssets([{ name: "a", host: "/x", env: { V: "../up" } }]), /relative path inside the asset/)
    assert.throws(() => parseAssets([{ name: "a", host: "/x", env: { "bad name": "" } }]), /relative path inside the asset/)
    // copyTo: a path relative to the sandbox home only: letters, digits, dot, dash and underscore segments (safe in a
    // shell), no "..", no absolute path, no backslash, and nothing the harness owns (the sealed config, the OpenCode
    // trees, claude's directory).
    assert.equal(parseAssets([{ name: "cache", host: join(dir, "speech"), copyTo: ".cache" }])[0].copyTo, ".cache")
    assert.equal(parseAssets([{ name: "cache", host: join(dir, "speech"), copyTo: "a/b-c_d" }])[0].copyTo, "a/b-c_d")
    const refused = ["..", "../x", "a/../b", "/abs", "a\\b", "", ".", "a//b", "a b", "a$b", "a`b", ".config/opencode", ".config/opencode/x", ".config", ".local/share/opencode", ".claude", ".claude/settings.json"]
    for (const copyTo of refused) assert.throws(() => parseAssets([{ name: "a", host: "/x", copyTo }]), /copyTo/, JSON.stringify(copyTo))
    // Two assets may not share a destination, or nest one inside the other; siblings are fine.
    assert.throws(() => parseAssets([{ name: "a", host: "/x", copyTo: ".cache" }, { name: "b", host: "/y", copyTo: ".cache" }]), /overlaps another asset/)
    assert.throws(() => parseAssets([{ name: "a", host: "/x", copyTo: ".cache" }, { name: "b", host: "/y", copyTo: ".cache/x" }]), /overlaps another asset/)
    assert.throws(() => parseAssets([{ name: "a", host: "/x", copyTo: ".cache/x" }, { name: "b", host: "/y", copyTo: ".cache" }]), /overlaps another asset/)
    assert.deepEqual(parseAssets([{ name: "a", host: "/x", copyTo: ".cache" }, { name: "b", host: "/y", copyTo: ".cache2" }, { name: "c", host: "/z", copyTo: "a/b" }]).map((a) => a.copyTo), [".cache", ".cache2", "a/b"])
    assert.equal("copyTo" in parseAssets([{ name: "a", host: "/x" }])[0], false)
    // The copyTo source must be readable (the trial copies it, where a mounted asset is checked in the trial by g8).
    const unreadable = join(dir, "speech", "model.bin")
    chmodSync(unreadable, 0o000)
    try {
      const checked = checkAssets(parseAssets([{ name: "speech", host: join(dir, "speech"), copyTo: ".speech" }]))[0]
      assert.equal(checked.ok, false, "a file the owner cannot read is not a copyable asset")
      assert.equal(checked.copyTo, ".speech")
      assert.match(checked.why, /cannot be read/)
    } finally {
      chmodSync(unreadable, 0o644)
    }
    assert.equal(checkAssets(parseAssets([{ name: "speech", host: join(dir, "speech"), copyTo: ".speech" }]))[0].ok, true)
    // The check applies the copy's own rules: a link (inside or at the top), a FIFO and an unreadable directory each fail
    // clearly, rather than passing here and failing every trial.
    const linked = join(dir, "linked")
    mkdirSync(linked)
    symlinkSync(join(dir, "speech", "model.bin"), join(linked, "link"))
    const linkedCheck = checkAssets(parseAssets([{ name: "linked", host: linked, copyTo: ".linked" }]))[0]
    assert.equal(linkedCheck.ok, false, "an inner symlink cannot be copied")
    assert.match(linkedCheck.why, /symbolic link/)
    const alias = join(dir, "alias")
    symlinkSync(join(dir, "speech"), alias)
    const aliasCheck = checkAssets(parseAssets([{ name: "alias", host: alias, copyTo: ".alias" }]))[0]
    assert.equal(aliasCheck.ok, false, "a top-level symlink is not followed")
    assert.match(aliasCheck.why, /symbolic link/)
    const fifoDir = join(dir, "fifo")
    mkdirSync(fifoDir)
    assert.equal(spawnSync("mkfifo", [join(fifoDir, "pipe")]).status, 0)
    const fifoCheck = checkAssets(parseAssets([{ name: "fifo", host: fifoDir, copyTo: ".fifo" }]))[0]
    assert.equal(fifoCheck.ok, false, "a FIFO cannot be copied")
    assert.match(fifoCheck.why, /not a regular file/)
    const locked = join(dir, "locked")
    mkdirSync(join(locked, "sub"), { recursive: true })
    writeFileSync(join(locked, "sub", "x"), "x")
    chmodSync(join(locked, "sub"), 0o000)
    try {
      const lockedCheck = checkAssets(parseAssets([{ name: "locked", host: locked, copyTo: ".locked" }]))[0]
      assert.equal(lockedCheck.ok, false, "an unreadable directory is a clear failure, not a throw")
      assert.match(lockedCheck.why, /cannot be read/)
    } finally {
      chmodSync(join(locked, "sub"), 0o755)
    }
    // the configuration reads them from the owner's caps.json, never from a case or an arm
    const store = join(dir, "store")
    mkdirSync(store)
    writeFileSync(join(store, "caps.json"), JSON.stringify({ container: { assets: [{ name: "speech", host: join(dir, "speech"), env: { UTILITIES_SPEECH_DIR: "" } }] } }))
    const config = containerConfig({ store, env: {} })
    assert.equal(config.assets[0].name, "speech")
    assert.equal(ASSETS_DIR, "/opt/evals/assets")
    assert.equal(containerBackend(config).name, "container")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a commit plan opens a write that touches only the trial's sandbox with `local: true`; any other write needs an extractor", () => {
  const plan = { actions: ["charts_render", "slack_slack_send_message"], writes: { charts_render: { local: true }, slack_slack_send_message: { extract: "args.channel_id", allow: ["C0SANDBOX"] } } }
  const policy = buildPolicy({ mode: "commit", commit: plan.writes })
  const render = policy.writes.find((w) => w.action === "charts_render")
  assert.equal(render.local, true)
  assert.equal(decideBefore(policy, "charts_render", { spec: {} }).why, "a write that touches only the trial's own sandbox")
  assert.equal(decideBefore(policy, "charts_quick", {}).pass, false, "charts_quick was not opened by the plan: deny by default")
  assert.equal(decideBefore(policy, "slack_send_message", { channel_id: "C0ELSE" }).pass, false)
  assert.equal(decideBefore(policy, "slack_send_message", { channel_id: "C0SANDBOX" }).pass, true)
  assert.equal(decideBefore({ ...policy, mode: "refuse" }, "charts_render", {}).why, "left to the ask", "outside the commit set the ask stops it")
})
