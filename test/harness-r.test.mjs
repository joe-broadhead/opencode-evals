// R1 to R14 (EVALS-232), the parts that need no container: companions, the vendor credential allow-list, secrets and their encoded
// forms, prompt placeholders and seeds, per-batch egress, the round's list-price ceiling, and the sealed config a locked run gets.
// Synthetic credentials and a stand-in host only.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Buffer } from "node:buffer"
import { allowListed, vendorCredentials, secretsOf, REFRESH_PLACEHOLDER, profileEnv } from "../src/run/vendor-auth.mjs"
import { redactor, expand, registerSecrets, scrub } from "../src/run/secrets.mjs"
import { fillPrompt, gateCases, seedFiles, seedDir, placeholdersIn } from "../src/run/gate.mjs"
import { batchEgress, fillHost, modelHosts } from "../src/run/egress.mjs"
import { readCompanions, materialiseArm, materialiseCompanions, runtimePaths, companionsDigest } from "../src/run/arm.mjs"
import { roundLimits, estimateRunUsd, assertLaunchWithinRound, RoundCapError, tierOf, listSpent, MIN_MEASURED_RUNS } from "../src/cost/budget.mjs"
import { outstandingList } from "../src/cost/ledger.mjs"
import { parseAuth } from "../src/run/auth.mjs"
import { runBatch, listUsdOf, modelPrice, guardSummary, hostLogFacts } from "../src/run/runner.mjs"
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

test("only the integrations the batch names are given, expiry is checked against the batch, and a missing one is refused", () => {
  const exported = JSON.stringify([oauth("linear"), oauth("jira"), oauth("slack"), { integrationID: "tavily", active: true, value: { type: "key", key: "tvly-0123456789abcdef" } }])
  const out = vendorCredentials(exported, { needed: ["linear", "tavily"] })
  assert.deepEqual(out.list.map((c) => c.integrationID).sort(), ["linear", "tavily"])
  assert.deepEqual(out.dropped.sort(), ["jira", "slack"], "what the profile holds and the batch does not name is dropped, and named")
  assert.deepEqual(out.secrets.sort(), ["access-token-linear-0123456789", "tvly-0123456789abcdef"], "the access token and the key, never the refresh token")
  assert.throws(() => vendorCredentials(exported, { needed: ["notion"] }), /holds no usable credential for notion \(it holds linear, jira, slack, tavily\)/)
  assert.throws(() => vendorCredentials(exported, { needed: ["linear"], horizonMs: 9 * 3_600_000 }), /the linear token expires at .* within the \d+ minutes/)
  const none = JSON.stringify([oauth("linear", { expires: undefined })])
  assert.throws(() => vendorCredentials(none, { needed: ["linear"] }), /has no expiry/)
  assert.equal(vendorCredentials(none, { needed: ["linear"], acceptUnknownExpiry: true }).list.length, 1)
  assert.throws(() => vendorCredentials("not json", { needed: ["linear"] }), /not JSON/)
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

const mkCase = (id, header = "", prompt = "list my issues") => compileCase(`cases/linear/${id}.md`, `# ${id}
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: test
- Decision tested: x
${header}
## Prompt
${prompt}

## Items
- [LIN-OC01] major · It answers the question asked.
  evidence: text:any matches /./
`)

test("placeholders are filled from the store at run time, and a prompt that cannot be filled is deferred, never sent", () => {
  const targets = flatten({ slack: { sandbox_channel: "C0SANDBOX" }, linear: { team_key: ["EVL"] } })
  const canaries = flatten({ linear_cycle: "Cycle 7q3" })
  assert.deepEqual(fillPrompt("post to {{target:slack.sandbox_channel}} about {{canary:linear_cycle}}", { targets, canaries }), { text: "post to C0SANDBOX about Cycle 7q3", unknown: [] })
  assert.deepEqual(fillPrompt("{{target:slack.nope}} and {{target:linear.team_key}}", { targets, canaries }).unknown, ["{{target:slack.nope}}"])
  assert.deepEqual(fillPrompt("no placeholders", {}), { text: "no placeholders", unknown: [] })
  assert.deepEqual(placeholdersIn("{{target:a.b}} {{canary:c}} {{other:x}}").map((p) => p.text), ["{{target:a.b}}", "{{canary:c}}"])
  const cases = [mkCase("tools-a", "", "send to {{target:slack.sandbox_channel}}"), mkCase("tools-b", "", "send to {{target:slack.missing}}"), mkCase("tools-c", "- Data: real"), mkCase("tools-d", "- Data: candidate"), mkCase("tools-e", "- Data: synthetic")]
  const claude = gateCases(cases, { model: "claude-agent/haiku", targets })
  assert.deepEqual(claude.runnable.map((c) => c.id), ["tools-a", "tools-c", "tools-d", "tools-e"])
  assert.match(claude.deferred.find((d) => d.case === "tools-b").why, /cannot fill \{\{target:slack\.missing\}\}/)
  assert.equal(claude.prompts.get("tools-a"), "send to C0SANDBOX")
  const deepseek = gateCases(cases, { model: "opencode/deepseek-v4.1-flash", targets })
  assert.deepEqual(deepseek.runnable.map((c) => c.id), ["tools-a", "tools-e"])
  assert.match(deepseek.deferred.find((d) => d.case === "tools-c").why, /Data: real never runs on opencode\/deepseek/)
  assert.match(deepseek.deferred.find((d) => d.case === "tools-d").why, /Data: candidate never runs/)
  assert.equal(gateCases([mkCase("tools-x", "- Data: real")], { model: "claude-agent/sonnet" }).runnable.length, 1, "Claude may read real data, with the owner's sign-off")
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
    assert.deepEqual(assertLaunchWithinRound(store, { model: "m/unpriced", tier: "wide", running: 0 }, {}), { enforced: false })
    // the measured mean replaces the table once enough runs are in
    const runs = Array.from({ length: MIN_MEASURED_RUNS }, (_, i) => ({ kind: "run", batch: `b${i}`, model: "m/a", tier: "wide", list_usd: 3 }))
    ledgerWith(store, runs)
    const estimate = estimateRunUsd(store, "m/a", "wide", {})
    assert.equal(estimate.usd, 3)
    assert.match(estimate.basis, /mean list cost of 5 recorded wide run/)
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
  assert.deepEqual(guardSummary(records), { ran: true, asks: 2, rejected: 1, reject_failed: 0, asks_left_to_run: 1, refused_writes: 1, assert_access: 1, assert_committed: 1, committed: 1, write_calls: 1 })
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
  const text = (id, header) => `# ${id}\n- Plugin: demo\n- Skill under test: demo\n- Tier: T3\n- Source: test\n- Decision tested: x\n${header}\n## Prompt\nhello ${id}\n\n## Items\n- [D-OC01] blocker · It says something.\n  evidence: text:any matches /./\n`
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
      await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "d1", model: "opencode/deepseek-v4.1-flash", auth: "none", cases: "demo-a", arm: real.arm, casesDir: real.casesDir, set: "tune", tools: "local" }, { caller: real.caller, ...quiet }), /nothing to run: all 1 selected case\(s\) are deferred \(demo-a: Data: real never runs on opencode\/deepseek-v4\.1-flash/)
    } finally {
      real.cleanup()
    }
  } finally {
    f.cleanup()
  }
})
