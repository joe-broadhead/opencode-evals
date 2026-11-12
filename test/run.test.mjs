// `evals run` with a stand-in OpenCode binary: no model, no network beyond loopback, deterministic outcomes.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, lstatSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawn, spawnSync } from "node:child_process"
import { runBatch, plan } from "../src/run/runner.mjs"
import { readLedger, usage } from "../src/cost/ledger.mjs"
import { compileCase } from "../src/case/compile.mjs"
import { readCredential, assertTokenLasts, CREDENTIAL_LIMIT } from "../src/run/auth.mjs"
import { freshness, parseSeed } from "../src/run/world.mjs"
import { SCRIPTED_PROVIDER } from "../src/run/sandbox.mjs"
import { installFakeOpencode, installFakeBun } from "./helpers/fake-opencode.mjs"

const BIN = join(import.meta.dirname, "..", "bin", "evals")
const TOKEN = "access-token-value-0123456789abcdef"

const caseText = (id, extra = "") => `# ${id}
- Plugin: demo
- Skill under test: demo
- Tier: T3
- Source: test
- Decision tested: the answer names the number
${extra}
## Prompt
how many for ${id}?

## Items
- [D-OC01] blocker · It says eight.
  evidence: text:any matches /\\beight\\b/
`

/** A store, a case set, a built plugin, a stand-in host and a stand-in user home. */
function fixture({ cases = [["demo-a", "- Seed: cwd=api"], ["demo-b", ""], ["ho-demo-c", "- Holdout: true"]] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "evals-run-test-"))
  const casesDir = join(root, "cases")
  mkdirSync(casesDir)
  for (const [id, extra] of cases) {
    const text = caseText(id, extra)
    writeFileSync(join(casesDir, `${id}.md`), text)
    writeFileSync(join(casesDir, `${id}.json`), JSON.stringify(compileCase(`cases/demo/${id}.md`, text)))
  }
  const arm = join(root, "plugin")
  mkdirSync(join(arm, "dist"), { recursive: true })
  mkdirSync(join(arm, "skills", "demo"), { recursive: true })
  writeFileSync(join(arm, "package.json"), JSON.stringify({ name: "@demo/plugin", version: "0.0.1" }))
  writeFileSync(join(arm, "dist", "index.js"), "export default {}\n")
  writeFileSync(join(arm, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: demo\n---\nbody\n")
  const home = join(root, "user")
  mkdirSync(join(home, ".claude"), { recursive: true })
  writeFileSync(join(home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, refreshToken: "refresh-token-value-zz", expiresAt: Date.now() + 10 * 3_600_000 } }), { mode: 0o600 })
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [] } }))
  writeFileSync(join(home, ".claude", "CLAUDE.md"), "global instructions\n")
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true, userID: "u1", oauthAccount: { id: "a" }, projects: { secret: true }, cachedThings: [1, 2] }))
  const bin = join(root, "bin")
  mkdirSync(bin)
  const fake = installFakeOpencode(bin)
  const bun = installFakeBun(bin)
  const store = join(root, "store")
  const tmp = join(root, "tmp")
  mkdirSync(tmp)
  const caller = { PATH: process.env.PATH, HOME: home, EVALS_STORE: store, EVALS_OPENCODE_BIN: fake, EVALS_BUN: bun, EVALS_TMP: tmp, EVALS_SECRET_PROBE: "leak", OPENCODE_SERVER_PASSWORD: "the-real-one", ANTHROPIC_API_KEY: "sk-not-for-the-run" }
  return { root, casesDir, arm, home, store, tmp, caller, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

const quiet = { log: () => {} }
// These tests use a stand-in host (a node script) and run unconfined, so they need neither Docker nor the sandbox
// image; the container backend has its own tests (isolation.test.mjs). A test of the refusal says so itself.
const UNCONFINED = { isolation: "none", unsafeNoIsolation: true }

test("a plan is one job per case and trial, and never overwrites a recorded trial", () => {
  const cases = [{ id: "a" }, { id: "b" }]
  assert.deepEqual(plan({ cases, trials: 2, recorded: new Map(), append: false }).map((j) => `${j.case.id}.t${j.trial}`), ["a.t1", "a.t2", "b.t1", "b.t2"])
  assert.throws(() => plan({ cases, trials: 1, recorded: new Map([["a", 2]]), append: false }), /already have recordings/)
  assert.deepEqual(plan({ cases, trials: 2, recorded: new Map([["a", 2]]), append: true }).map((j) => `${j.case.id}.t${j.trial}`), ["a.t3", "a.t4", "b.t1", "b.t2"])
  assert.deepEqual(parseSeed("cwd=api time=day"), { cwd: "api", time: "day" })
})

test("every trial is its own sandbox and its own file, in parallel, on its own port", async () => {
  const f = fixture()
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "it1", model: "mock/m1", auth: "none", scripted: true, trials: 3, parallel: 3, arm: f.arm, casesDir: f.casesDir }, { caller: f.caller, ...quiet })
  assert.equal(result.planned, 6, "the tune set: demo-a and demo-b, not the holdout")
  assert.equal(result.launched, 6)
  assert.equal(result.bad, 0, JSON.stringify(result.results))
  const raw = join(f.store, "raw", "it1", "demo")
  const files = readdirSync(raw).filter((file) => file.endsWith(".jsonl")).sort()
  assert.deepEqual(files, ["demo-a.t1.jsonl", "demo-a.t2.jsonl", "demo-a.t3.jsonl", "demo-b.t1.jsonl", "demo-b.t2.jsonl", "demo-b.t3.jsonl"])
  const summary = JSON.parse(readFileSync(join(raw, "demo-a.t2.summary.json"), "utf8"))
  assert.equal(summary.trial, 2)
  assert.equal(summary.exit, 0)
  assert.equal(summary.runner, "evals run")
  assert.match(summary.runner_version, /\+/)
  assert.equal(summary.opencode, "opencode v2.2.6")
  assert.equal(summary.host, "2.2.6")
  assert.equal(summary.provenance.plugin_version, "0.0.1")
  assert.match(summary.provenance.plugin, /^[0-9a-f]{64}$/)
  assert.ok(readdirSync(raw).some((file) => /^batch-it1-.*\.json$/.test(file)))
  // The sandboxes are gone, and the ledger holds the reservation and every run.
  assert.deepEqual(readdirSync(f.tmp), [])
  const ledger = readLedger(f.store)
  assert.equal(ledger.filter((e) => e.kind === "reserve")[0].runs, 6)
  assert.equal(ledger.filter((e) => e.kind === "run").length, 6)
  assert.ok(ledger.filter((e) => e.kind === "run").every((e) => e.cost_source === "unpriced"))
  // Trace and grade read the recordings as they are.
  const env = { PATH: process.env.PATH, EVALS_STORE: f.store, EVALS_MODELS_CATALOG: join(f.root, "absent.json") }
  assert.equal(spawnSync(process.execPath, [BIN, "trace", "--iteration", "it1", "--plugin", "demo"], { env, encoding: "utf8" }).status, 0)
  const graded = spawnSync(process.execPath, [BIN, "grade", "--iteration", "it1", "--plugin", "demo", "--cases", f.casesDir], { env, encoding: "utf8" })
  assert.equal(graded.status, 0, graded.stderr)
  const batch = JSON.parse(readFileSync(join(f.store, "results", "it1", "batch.json"), "utf8"))
  assert.deepEqual(batch.trials, { min: 3, max: 3, runs: 6 })
  const head = JSON.parse(readFileSync(join(f.store, "traces", "it1", "demo", "demo-b.t3.trace.jsonl"), "utf8").split("\n")[0])
  assert.equal(head.source.runner, "evals run")
  f.cleanup()
})

test("the sandbox is sealed: its own home, XDG tree and config, and nothing of the caller's environment", async () => {
  const f = fixture()
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "seal", model: "mock/m1", auth: "none", scripted: true, cases: "demo-b", arm: f.arm, casesDir: f.casesDir, keep: true }, { caller: f.caller, ...quiet })
  const kept = result.keptAt
  const home = join(kept, "runs", "demo-b.t1", "home")
  const run = JSON.parse(readFileSync(join(home, "run.json"), "utf8"))
  assert.equal(run.env.HOME, home)
  assert.equal(run.env.OPENCODE_TEST_HOME, home)
  for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "TMPDIR"]) assert.ok(run.env[key].startsWith(join(kept, "runs", "demo-b.t1")), key)
  for (const key of ["EVALS_SECRET_PROBE", "OPENCODE_SERVER_PASSWORD", "ANTHROPIC_API_KEY", "EVALS_STORE"]) assert.equal(run.env[key], undefined, `${key} leaked into the run`)
  const config = JSON.parse(run.env.OPENCODE_CONFIG_CONTENT)
  // The plugin under test first, the harness's scripted provider last (it wins), from the batch's own copy whose
  // endpoint is pinned in a file, not taken from the environment the plugin shares.
  assert.deepEqual(config, { plugins: [{ package: join(kept, "arm") }, { package: join(kept, "harness", "mock", "provider") }], model: "mock/m1" })
  assert.notEqual(join(kept, "harness", "mock", "provider"), SCRIPTED_PROVIDER)
  assert.deepEqual(JSON.parse(readFileSync(join(kept, "harness", "mock", "provider", "endpoint.json"), "utf8")), { url: run.env.SPIKE_MOCK_URL })
  assert.deepEqual(JSON.parse(readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8")), config)
  assert.equal(run.argv[0], "run")
  assert.ok(run.argv.includes("--server") && run.argv.includes("json"))
  assert.equal(run.env.OPENCODE_DISABLE_AUTOUPDATE, "1")
  assert.ok(existsSync(join(kept, "arm", "dist", "index.js")), "the build was copied, not used in place")
  // Even the version probe runs in a sandbox of its own.
  const probe = JSON.parse(readFileSync(join(kept, "probe", "home", "version.json"), "utf8"))
  assert.equal(probe.env.HOME, join(kept, "probe", "home"))
  assert.equal(probe.env.EVALS_SECRET_PROBE, undefined)
  assert.equal(probe.env.OPENCODE_SERVER_PASSWORD, undefined)
  f.cleanup()
})

test("the caps refuse a batch before anything launches, and nothing is reserved", async () => {
  const f = fixture()
  const caller = { ...f.caller, EVALS_MAX_RUNS_PER_PLUGIN: "3" }
  await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "capped", model: "mock/m1", auth: "none", scripted: true, trials: 2, arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet }), /demo would reach 4 of 3 runs/)
  assert.equal(existsSync(join(f.store, "raw", "capped")), false, "no recording")
  assert.deepEqual(readLedger(f.store), [])
  // Three fit; then the month is full, across invocations.
  await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "fits", model: "mock/m1", auth: "none", scripted: true, cases: "demo-a", trials: 3, arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet })
  await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "next", model: "mock/m1", auth: "none", scripted: true, cases: "demo-b", arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet }), /run cap/)
  assert.equal(usage(readLedger(f.store), { month: new Date().toISOString().slice(0, 7), plugin: "demo", iteration: "fits" }).per_plugin_month, 3)
  f.cleanup()
})

test("a second run into the same iteration refuses to overwrite; --append adds trials after the last", async () => {
  const f = fixture()
  const options = { ...UNCONFINED, plugin: "demo", iteration: "again", model: "mock/m1", auth: "none", scripted: true, cases: "demo-b", arm: f.arm, casesDir: f.casesDir }
  await runBatch(options, { caller: f.caller, ...quiet })
  await assert.rejects(runBatch(options, { caller: f.caller, ...quiet }), /already have recordings/)
  await runBatch({ ...UNCONFINED, ...options, append: true, trials: 2 }, { caller: f.caller, ...quiet })
  assert.deepEqual(readdirSync(join(f.store, "raw", "again", "demo")).filter((x) => x.endsWith(".jsonl")).sort(), ["demo-b.t1.jsonl", "demo-b.t2.jsonl", "demo-b.t3.jsonl"])
  f.cleanup()
})

test("a stale world is rebuilt with the build under test, or refused", async () => {
  const f = fixture()
  const world = join(f.root, "world")
  mkdirSync(join(world, "home", ".local", "share", "seeded"), { recursive: true })
  writeFileSync(join(world, "home", ".local", "share", "seeded", "db"), "seeded")
  mkdirSync(join(world, "repos", "api-repo", ".git"), { recursive: true })
  const yesterday = Date.now() - 36 * 3_600_000
  writeFileSync(join(world, "truth.json"), JSON.stringify({ now: yesterday }))
  const spec = { home: "home", repos: "repos", cwd: { api: "api-repo" }, now: "truth.json#now", fresh: "utc-day" }
  writeFileSync(join(world, "world.json"), JSON.stringify(spec))
  const options = { ...UNCONFINED, plugin: "demo", iteration: "w1", model: "mock/m1", auth: "none", scripted: true, cases: "demo-a", arm: f.arm, casesDir: f.casesDir, world }
  await assert.rejects(runBatch(options, { caller: f.caller, ...quiet }), /stale and was not rebuilt: the world was built for/)
  assert.deepEqual(readLedger(f.store), [], "a refused world reserves nothing")
  // With a build command, the runner rebuilds it, hands it the copied build, and stamps the build's digest.
  writeFileSync(join(world, "world.json"), JSON.stringify({ ...spec, build: `node -e 'require("fs").writeFileSync("truth.json", JSON.stringify({ now: Date.now() })); require("fs").writeFileSync("arm.txt", process.env.EVALS_WORLD_ARM)'` }))
  const result = await runBatch({ ...UNCONFINED, ...options, iteration: "w2", keep: true }, { caller: f.caller, ...quiet })
  assert.equal(result.launched, 1)
  assert.equal(readFileSync(join(world, "arm.txt"), "utf8"), join(result.keptAt, "arm"))
  const stamp = JSON.parse(readFileSync(join(world, ".evals-world.json"), "utf8"))
  assert.match(stamp.arm_sha256, /^[0-9a-f]{64}$/)
  // The case ran in its own copy of the seeded repository, over the world's seeded home.
  const run = JSON.parse(readFileSync(join(result.keptAt, "runs", "demo-a.t1", "home", "run.json"), "utf8"))
  assert.equal(run.cwd, join(result.keptAt, "runs", "demo-a.t1", "work", "api-repo"))
  assert.ok(existsSync(join(result.keptAt, "runs", "demo-a.t1", "home", ".local", "share", "seeded", "db")))
  const summary = JSON.parse(readFileSync(join(f.store, "raw", "w2", "demo", "demo-a.t1.summary.json"), "utf8"))
  assert.equal(typeof summary.world.now, "number")
  // Another build makes the world stale again: it was indexed by a different plugin. --stale refuse says so.
  writeFileSync(join(f.arm, "dist", "index.js"), "export default { changed: true }\n")
  await assert.rejects(runBatch({ ...UNCONFINED, ...options, iteration: "w3", stale: "refuse" }, { caller: f.caller, ...quiet }), /built by another build/)
  f.cleanup()
})

test("freshness rules: a UTC day, a number of hours, or always", () => {
  const at = Date.parse("2026-11-11T12:00:00Z")
  assert.equal(freshness("utc-day", Date.parse("2026-11-11T00:30:00Z"), at).fresh, true)
  assert.equal(freshness("utc-day", Date.parse("2026-11-10T23:59:00Z"), at).fresh, false)
  assert.equal(freshness("24h", at - 23 * 3_600_000, at).fresh, true)
  assert.equal(freshness("24h", at - 25 * 3_600_000, at).fresh, false)
  assert.equal(freshness("always", null, at).fresh, true)
})

test("claude-agent: the credential is piped in, and the run's ~/.claude is its own, holding only the sign-in", async () => {
  const f = fixture()
  await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "ca0", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-b", arm: f.arm, casesDir: f.casesDir }, { caller: f.caller, ...quiet }), /CLAUDE_AGENT_SDK_VERSION/)
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  const before = readdirSync(join(f.home, ".claude")).sort()
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "ca1", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-b", arm: f.arm, casesDir: f.casesDir, keep: true, keepCredentials: true }, { caller, ...quiet })
  assert.equal(result.bad, 0, JSON.stringify(result.results))
  const home = join(result.keptAt, "runs", "demo-b.t1", "home")
  const imported = JSON.parse(readFileSync(join(home, "imported.json"), "utf8"))
  assert.deepEqual(JSON.parse(imported.input), { integration: "Claude Agent", kind: "external" })
  assert.deepEqual(imported.argv, ["auth", "import", "--standalone"])
  assert.equal(imported.env.HOME, home, "imported into the sandbox, not the caller's install")
  // Its own, empty ~/.claude: no sign-in file of any kind, and nothing else of the caller's.
  const dir = join(home, ".claude")
  assert.equal(lstatSync(dir).isSymbolicLink(), false)
  assert.equal(existsSync(join(dir, ".credentials.json")), false, "the sign-in is not copied")
  assert.equal(existsSync(join(dir, "settings.json")) || existsSync(join(dir, "CLAUDE.md")), false)
  assert.equal(existsSync(join(home, ".claude.json")), false, "no ~/.claude.json in the sandbox")
  const run = JSON.parse(readFileSync(join(home, "run.json"), "utf8"))
  assert.equal(run.env.CLAUDE_AGENT_SDK_VERSION, "0.0.1-test")
  assert.equal(run.env.CLAUDE_CONFIG_DIR, dir)
  assert.equal(run.env.DISABLE_AUTOUPDATER, "1")
  assert.equal(run.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY, "1")
  assert.equal(run.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1")
  // The access token reached the run as CLAUDE_CODE_OAUTH_TOKEN, and the kept sandbox holds it only masked.
  assert.equal(run.env.CLAUDE_CODE_OAUTH_TOKEN, "*".repeat(TOKEN.length))
  assert.doesNotMatch(JSON.stringify(run.env), /refresh-token-value/, "never the refresh token")
  assert.equal(run.env.ANTHROPIC_API_KEY, undefined)
  // What `claude` writes stays in the sandbox: the caller's ~/.claude is as it was.
  assert.ok(readdirSync(join(dir, "projects")).length > 0)
  assert.deepEqual(readdirSync(join(f.home, ".claude")).sort(), before)
  f.cleanup()
})

test("--keep with claude-agent is refused unless --keep-credentials says so", async () => {
  const f = fixture()
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "kc", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-b", arm: f.arm, casesDir: f.casesDir, keep: true }, { caller, ...quiet }), /--keep-credentials/)
  assert.deepEqual(readLedger(f.store), [], "refused before anything was reserved")
  assert.deepEqual(readdirSync(f.tmp), [], "and nothing was kept")
  const lines = []
  await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "kc2", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-b", arm: f.arm, casesDir: f.casesDir, keep: true, keepCredentials: true }, { caller, log: (line) => lines.push(line) })
  assert.ok(lines.some((line) => /hold the imported credential/.test(line)))
  f.cleanup()
})

test("a world's home that links to the caller's ~/.claude is cut off from it", async () => {
  const f = fixture()
  const world = join(f.root, "world")
  mkdirSync(join(world, "home", ".local"), { recursive: true })
  symlinkSync(join(f.home, ".claude"), join(world, "home", ".claude"))
  symlinkSync(join(f.home, "bin-elsewhere"), join(world, "home", ".local", "bin"))
  writeFileSync(join(world, "home", ".claude.json"), JSON.stringify({ oauthAccount: { id: "a" } }))
  writeFileSync(join(world, "world.json"), JSON.stringify({ home: "home" }))
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "wl", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-b", arm: f.arm, casesDir: f.casesDir, world, keep: true, keepCredentials: true }, { caller, ...quiet })
  const home = join(result.keptAt, "runs", "demo-b.t1", "home")
  assert.equal(lstatSync(join(home, ".claude")).isSymbolicLink(), false)
  assert.equal(existsSync(join(home, ".local", "bin")), false)
  assert.equal(existsSync(join(home, ".claude.json")), false)
  assert.equal(existsSync(join(f.home, ".claude", "projects")), false, "nothing reached the caller's ~/.claude through the world's link")
  f.cleanup()
})

test("an unknown or missing --auth is refused before anything runs", async () => {
  const f = fixture()
  await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "a1", model: "mock/m1", arm: f.arm, casesDir: f.casesDir }, { caller: f.caller, ...quiet }), /--auth is required/)
  await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "a2", model: "mock/m1", auth: "env:NOT_SET_ANYWHERE", arm: f.arm, casesDir: f.casesDir }, { caller: f.caller, ...quiet }), /NOT_SET_ANYWHERE not set/)
  assert.deepEqual(readLedger(f.store), [])
  f.cleanup()
})

test("the CLI's dry run lists the plan and the caps, and launches nothing", () => {
  const f = fixture()
  const out = spawnSync(process.execPath, [BIN, "run", "--plugin", "demo", "--iteration", "dry", "--model", "mock/m1", "--auth", "none", "--scripted", "--isolation", "none", "--unsafe-no-isolation", "--arm", f.arm, "--cases-dir", f.casesDir, "--set", "all", "--trials", "2", "--dry-run"], { env: f.caller, encoding: "utf8" })
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /3 case\(s\) x 2 trial\(s\) = 6 run\(s\)/)
  assert.match(out.stdout, /ho-demo-c\.t2/)
  assert.match(out.stdout, /nothing launched, nothing reserved/)
  assert.deepEqual(readLedger(f.store), [])
  f.cleanup()
})

test("an arm file sets the plugin's options; they reach the run, and their digest is a provenance axis", async () => {
  const f = fixture()
  const armFile = join(f.root, "ask-changes.json")
  writeFileSync(armFile, JSON.stringify({ package: "plugin", options: { access: "ask-changes" } }))
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "opt", model: "mock/m1", auth: "none", scripted: true, cases: "demo-b", arm: armFile, casesDir: f.casesDir, keep: true }, { caller: f.caller, ...quiet })
  const run = JSON.parse(readFileSync(join(result.keptAt, "runs", "demo-b.t1", "home", "run.json"), "utf8"))
  assert.deepEqual(JSON.parse(run.env.OPENCODE_CONFIG_CONTENT).plugins.find((p) => p.package === join(result.keptAt, "arm")).options, { access: "ask-changes" })
  const summary = JSON.parse(readFileSync(join(f.store, "raw", "opt", "demo", "demo-b.t1.summary.json"), "utf8"))
  assert.equal(summary.provenance.access, "ask-changes")
  assert.match(summary.provenance.options, /^[0-9a-f]{64}$/)
  assert.doesNotMatch(JSON.stringify(summary), /"options":\{/, "the option values are not written, only their digest")
  await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "opt2", model: "mock/m1", auth: "none", scripted: true, cases: "demo-b", arm: armFile, options: "{}", casesDir: f.casesDir }, { caller: f.caller, ...quiet }), /pass one/)
  f.cleanup()
})

const addCase = (dir, id, extra) => {
  const text = caseText(id, extra)
  writeFileSync(join(dir, `${id}.md`), text)
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(compileCase(`cases/demo/${id}.md`, text)))
}

test("private holdouts come from the store, are holdouts whatever they say, and may not also be published", async () => {
  const f = fixture()
  const holdouts = join(f.store, "holdouts", "demo")
  mkdirSync(holdouts, { recursive: true })
  addCase(holdouts, "priv-one", "")
  // With the repository's own cases (no --cases-dir), the private holdout joins the holdout set.
  const { pluginCases } = await import("../src/case/load.mjs")
  const cases = pluginCases("demo", { env: f.caller })
  const priv = cases.find((c) => c.id === "priv-one")
  assert.equal(priv.holdout, true)
  assert.equal(priv.private, true)
  // A run selects it with --set holdout, from the store, with no --cases-dir.
  const repoCases = join(import.meta.dirname, "..", "cases", "demo")
  assert.equal(existsSync(repoCases), false)
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "priv", model: "mock/m1", auth: "none", scripted: true, set: "holdout", arm: f.arm }, { caller: f.caller, ...quiet })
  assert.deepEqual(result.cases, ["priv-one"])
  f.cleanup()
})

test("utc-hours keeps a time-of-day case inside its window, and the summary records the hour", async () => {
  const { hourWindow } = await import("../src/run/runner.mjs")
  const at = new Date("2026-11-11T14:30:00Z")
  assert.equal(hourWindow("utc-hours=9-15", at).ok, true)
  assert.equal(hourWindow("utc-hours=15-23", at).ok, false)
  assert.equal(hourWindow("utc-hours=22-10", new Date("2026-11-11T03:00:00Z")).ok, true, "a window across midnight")
  assert.equal(hourWindow("cwd=api", at).ok, true)
  const f = fixture()
  const hour = new Date().getUTCHours()
  addCase(f.casesDir, "timed-out", `- Seed: utc-hours=${(hour + 2) % 24}-${(hour + 3) % 24}`)
  addCase(f.casesDir, "timed-in", `- Seed: utc-hours=0-24`)
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "hours", model: "mock/m1", auth: "none", scripted: true, cases: "timed-*", arm: f.arm, casesDir: f.casesDir }, { caller: f.caller, ...quiet })
  assert.equal(result.launched, 1)
  assert.match(result.results.find((r) => r.case === "timed-out").skipped, /runs between/)
  assert.equal(JSON.parse(readFileSync(join(f.store, "raw", "hours", "demo", "timed-in.t1.summary.json"), "utf8")).utc_hour, hour)
  assert.equal(readLedger(f.store).find((e) => e.kind === "release").runs, 1, "the skipped run's reservation is released")
  f.cleanup()
})

test("a world can continue its own session, rewrite paths per sandbox, and be built with a private overlay", async () => {
  const f = fixture()
  addCase(f.casesDir, "continues", "- Seed: cwd=api continue=earlier")
  const world = join(f.root, "world")
  mkdirSync(join(world, "repos", "api-repo"), { recursive: true })
  const overlay = join(f.store, "holdouts", "demo", "world")
  mkdirSync(overlay, { recursive: true })
  writeFileSync(join(overlay, "needles.json"), "[]")
  writeFileSync(
    join(world, "world.json"),
    JSON.stringify({
      repos: "repos",
      cwd: { api: "api-repo" },
      now: Date.now(),
      fresh: "utc-day",
      overlay: "$EVALS_STORE/holdouts/demo/world",
      build: `node -e 'require("fs").writeFileSync("overlay.txt", process.env.EVALS_WORLD_OVERLAY)'`,
      prepare: `node -e 'require("fs").writeFileSync(require("path").join(process.env.EVALS_SANDBOX_HOME, "prepared.txt"), process.env.EVALS_RUN_CWD + "|" + process.env.EVALS_REPO_SOURCE)'`,
      sessions: { earlier: "ses_world_earlier" },
    }),
  )
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "cont", model: "mock/m1", auth: "none", scripted: true, cases: "continues", arm: f.arm, casesDir: f.casesDir, world, keep: true }, { caller: f.caller, ...quiet })
  assert.equal(result.bad, 0, JSON.stringify(result.results))
  assert.equal(readFileSync(join(world, "overlay.txt"), "utf8"), overlay)
  assert.match(JSON.parse(readFileSync(join(world, ".evals-world.json"), "utf8")).overlay_sha256, /^[0-9a-f]{64}$/)
  const home = join(result.keptAt, "runs", "continues.t1", "home")
  assert.equal(readFileSync(join(home, "prepared.txt"), "utf8"), `${join(result.keptAt, "runs", "continues.t1", "work", "api-repo")}|${join(world, "repos", "api-repo")}`)
  const run = JSON.parse(readFileSync(join(home, "run.json"), "utf8"))
  assert.deepEqual(run.argv.slice(run.argv.indexOf("--session"), run.argv.indexOf("--session") + 2), ["--session", "ses_world_earlier"])
  assert.equal(JSON.parse(readFileSync(join(f.store, "raw", "cont", "demo", "continues.t1.summary.json"), "utf8")).continued, true)
  f.cleanup()
})

test("a run can start in a folder of its repository, and continue a session the build derived", async () => {
  const f = fixture()
  addCase(f.casesDir, "in-sub", "- Seed: cwd=api subdir=services/worker continue=stripe")
  addCase(f.casesDir, "bad-sub", "- Seed: cwd=api subdir=services/nowhere")
  addCase(f.casesDir, "up-sub", "- Seed: cwd=api subdir=../escape")
  const world = join(f.root, "world")
  mkdirSync(join(world, "repos", "api-repo", "services", "worker"), { recursive: true })
  writeFileSync(join(world, "truth.json"), JSON.stringify({ ids: { stripe: "ses_from_truth" } }))
  writeFileSync(join(world, "world.json"), JSON.stringify({ repos: "repos", cwd: { api: "api-repo" }, sessions: "truth.json#ids" }))
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "sub", model: "mock/m1", auth: "none", scripted: true, cases: "*-sub", arm: f.arm, casesDir: f.casesDir, world, keep: true }, { caller: f.caller, ...quiet })
  const by = Object.fromEntries(result.results.map((r) => [r.case, r]))
  assert.equal(by["in-sub"].exit, 0, JSON.stringify(by["in-sub"]))
  const run = JSON.parse(readFileSync(join(result.keptAt, "runs", "in-sub.t1", "home", "run.json"), "utf8"))
  assert.equal(run.cwd, join(result.keptAt, "runs", "in-sub.t1", "work", "api-repo", "services", "worker"))
  assert.deepEqual(run.argv.slice(run.argv.indexOf("--session"), run.argv.indexOf("--session") + 2), ["--session", "ses_from_truth"])
  assert.match(by["bad-sub"].error, /nowhere is not a folder/)
  assert.match(by["up-sub"].error, /not a safe name/)
  f.cleanup()
})

test("a private holdout with a published case's id is refused", async () => {
  const { pluginCases } = await import("../src/case/load.mjs")
  const store = mkdtempSync(join(tmpdir(), "evals-clash-"))
  mkdirSync(join(store, "holdouts", "x"), { recursive: true })
  const published = JSON.parse(readFileSync(join(import.meta.dirname, "..", "cases", "x", "small-bounded-search.json"), "utf8"))
  writeFileSync(join(store, "holdouts", "x", "small-bounded-search.json"), JSON.stringify(published))
  assert.throws(() => pluginCases("x", { env: { EVALS_STORE: store } }), /a published holdout is not a holdout/)
  rmSync(store, { recursive: true, force: true })
})

test("the files a run wrote are recorded beside it and graded with file: clauses", async () => {
  const f = fixture()
  const text = caseText("writes-note", "").replace(/how many for writes-note\?/, "how many? write a note").replace("  evidence: text:any matches /\\beight\\b/", "  evidence: file:notes/*.md matches /eight/\n  evidence: file:**/*.sh absent")
  writeFileSync(join(f.casesDir, "writes-note.md"), text)
  writeFileSync(join(f.casesDir, "writes-note.json"), JSON.stringify(compileCase("cases/demo/writes-note.md", text)))
  await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "files", model: "mock/m1", auth: "none", scripted: true, cases: "writes-note", arm: f.arm, casesDir: f.casesDir }, { caller: f.caller, ...quiet })
  const files = JSON.parse(readFileSync(join(f.store, "raw", "files", "demo", "writes-note.t1.files.json"), "utf8"))
  assert.deepEqual(files.map((file) => [file.path, file.change, file.text]), [["notes/answer.md", "added", "the answer is eight\n"]])
  const env = { PATH: process.env.PATH, EVALS_STORE: f.store, EVALS_MODELS_CATALOG: join(f.root, "absent.json") }
  spawnSync(process.execPath, [BIN, "trace", "--iteration", "files", "--plugin", "demo"], { env })
  const trace = readFileSync(join(f.store, "traces", "files", "demo", "writes-note.t1.trace.jsonl"), "utf8")
  assert.doesNotMatch(trace, /the answer is eight/, "the file's content is not traced")
  spawnSync(process.execPath, [BIN, "grade", "--iteration", "files", "--plugin", "demo", "--cases", f.casesDir], { env })
  const verdicts = JSON.parse(readFileSync(join(f.store, "results", "files", "verdicts.json"), "utf8"))
  assert.equal(verdicts.find((v) => v.case === "writes-note").verdict, "PASS", JSON.stringify(verdicts.find((v) => v.case === "writes-note").items))
  f.cleanup()
})

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const until = async (what, probe, ms = 15000) => {
  const deadline = Date.now() + ms
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 50))
  }
}

test("a finished run leaves nothing running: the server's own children go with its group", async () => {
  const f = fixture()
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "reap", model: "mock/m1", auth: "none", scripted: true, cases: "demo-b", arm: f.arm, casesDir: f.casesDir, keep: true }, { caller: f.caller, ...quiet })
  const home = join(result.keptAt, "runs", "demo-b.t1", "home")
  const child = Number(readFileSync(join(home, "serve-child.pid"), "utf8"))
  const serve = JSON.parse(readFileSync(join(home, readdirSync(home).find((n) => /^serve-\d+\.json$/.test(n))), "utf8")).pid
  await until("the server group to end", () => !alive(child) && !alive(serve), 5000)
  f.cleanup()
})

async function interrupted(signal, code, { claude = false } = {}) {
  const f = fixture()
  addCase(f.casesDir, "sleepy", "")
  addCase(f.casesDir, "zz-after", "")
  const sleepy = JSON.parse(readFileSync(join(f.casesDir, "sleepy.json"), "utf8"))
  writeFileSync(join(f.casesDir, "sleepy.json"), JSON.stringify({ ...sleepy, prompt: "please sleep" }))
  const { spawn } = await import("node:child_process")
  const auth = claude ? ["--auth", "claude-agent", "--model", "claude-agent/haiku", "--isolation", "none", "--unsafe-no-isolation"] : ["--auth", "none", "--model", "mock/m1", "--scripted", "--isolation", "none", "--unsafe-no-isolation"]
  const env = claude ? { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" } : f.caller
  const cli = spawn(process.execPath, [BIN, "run", "--plugin", "demo", "--iteration", "int", ...auth, "--arm", f.arm, "--cases-dir", f.casesDir, "--cases", "sleepy,demo-b,zz-after", "--parallel", "1"], { env, stdio: ["ignore", "pipe", "pipe"] })
  let out = ""
  cli.stdout.on("data", (d) => (out += d))
  cli.stderr.on("data", (d) => (out += d))
  const exited = new Promise((done) => cli.on("exit", (status) => done(status)))
  // demo-b runs first (id order), then sleepy hangs; wait until sleepy's run and its child are up.
  const home = await until("the sleeping run", () => {
    const batch = readdirSync(f.tmp).find((n) => n.startsWith("evals-run-int-"))
    const dir = batch && join(f.tmp, batch, "runs", "sleepy.t1", "home")
    return dir && existsSync(join(dir, "run-child.pid")) && existsSync(join(dir, "run.json")) ? dir : null
  })
  if (claude) assert.equal(existsSync(join(home, ".claude", ".credentials.json")), false, "no sign-in file, even while the run runs")
  const pids = [
    JSON.parse(readFileSync(join(home, "run.json"), "utf8")).pid,
    Number(readFileSync(join(home, "run-child.pid"), "utf8")),
    Number(readFileSync(join(home, "serve-child.pid"), "utf8")),
    JSON.parse(readFileSync(join(home, readdirSync(home).find((n) => /^serve-\d+\.json$/.test(n))), "utf8")).pid,
  ]
  assert.ok(pids.every(alive), "everything is running before the interrupt")
  cli.kill(signal)
  assert.equal(await exited, code, out)
  await until("every process to end", () => pids.every((pid) => !alive(pid)), 5000)
  assert.deepEqual(readdirSync(f.tmp), [], "no sandbox, no copy of a credential, left in tmp")
  const raw = readdirSync(join(f.store, "raw", "int", "demo"))
  assert.ok(raw.includes("demo-b.t1.jsonl"))
  assert.equal(raw.includes("sleepy.t1.jsonl"), false, "an interrupted run is not a recording")
  const record = JSON.parse(readFileSync(join(f.store, "raw", "int", "demo", raw.find((n) => n.startsWith("batch-"))), "utf8"))
  assert.equal(record.stopped, `interrupted by ${signal}`)
  assert.equal(record.launched, 2)
  assert.equal(readLedger(f.store).find((e) => e.kind === "release").runs, 1, "zz-after never launched: released")
  assert.match(out, new RegExp(`interrupted by ${signal}`))
  f.cleanup()
}

test("Ctrl-C stops every process the batch started, removes its sandboxes, releases what never ran, and exits 130", () => interrupted("SIGINT", 130))

test("SIGTERM does the same, exits 143, and leaves no copy of the sign-in behind", () => interrupted("SIGTERM", 143, { claude: true }))

test("a seed's cwd is a repository of the world, never a path out of it", async () => {
  const f = fixture()
  const world = join(f.root, "world")
  mkdirSync(join(world, "repos", "api-repo"), { recursive: true })
  mkdirSync(join(f.root, "secret"), { recursive: true })
  writeFileSync(join(f.root, "secret", "token"), "x")
  writeFileSync(join(world, "world.json"), JSON.stringify({ repos: "repos", cwd: { api: "api-repo", sneaky: "../../secret" } }))
  for (const [id, seed, why] of [["climbs", "cwd=../../secret", /Seed cwd "..\/..\/secret" is not a safe name/], ["absolute", "cwd=/etc", /Seed cwd "\/etc" is not a safe name/], ["aliased", "cwd=sneaky", /repository for cwd=sneaky/]]) {
    addCase(f.casesDir, id, `- Seed: ${seed}`)
    const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: `cwd-${id}`, model: "mock/m1", auth: "none", scripted: true, cases: id, arm: f.arm, casesDir: f.casesDir, world }, { caller: f.caller, ...quiet })
    assert.match(result.results[0].error ?? "", why, id)
    assert.equal(existsSync(join(f.store, "raw", `cwd-${id}`, "demo", `${id}.t1.jsonl`)), false)
  }
  assert.ok(existsSync(join(f.root, "secret", "token")), "nothing outside the world was copied or touched")
  f.cleanup()
})

test("a batch stops before the next run would cross the dollar cap, counting the runs still in flight", async () => {
  const f = fixture()
  const { recordRun: record } = await import("../src/cost/ledger.mjs")
  const month = new Date().toISOString().slice(0, 7)
  // Two priced runs this month at $1: the projection is $1 a run.
  for (const trial of [1, 2]) record(f.store, { batch: "seed", month, iteration: "old", plugin: "demo", model: "mock/m1", case: "c", trial, billed_usd: 1, cost_source: "billed" })
  addCase(f.casesDir, "pricey", "")
  const pricey = JSON.parse(readFileSync(join(f.casesDir, "pricey.json"), "utf8"))
  writeFileSync(join(f.casesDir, "pricey.json"), JSON.stringify({ ...pricey, prompt: "answer at cost=3" }))
  const caller = { ...f.caller, EVALS_BUDGET_MODEL_USD: "6.5" }
  // Reserved: $2 spent + 3 runs x $1 = $5, within $6.50. After the first run bills $3: $5 spent, and the next run is
  // expected to bill $1.67, which would make $6.67: the batch stops there, before crossing.
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "spend", model: "mock/m1", auth: "none", scripted: true, cases: "pricey", trials: 3, parallel: 1, arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet })
  assert.equal(result.launched, 1)
  assert.match(result.stopped, /would take the month's model spend to \$6\.67, over \$6\.5/)
  assert.equal(readLedger(f.store).find((e) => e.kind === "release").runs, 2)
  // A batch whose projection is already over the cap is refused at the reservation.
  await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "spend2", model: "mock/m1", auth: "none", scripted: true, cases: "pricey", trials: 3, arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet }), /D4 budget/)
  f.cleanup()
})

test("every run is refused without filesystem isolation, the scripted model's included, before anything is created or reserved", async () => {
  const f = fixture()
  const live = { plugin: "demo", iteration: "live", model: "claude-agent/haiku", auth: "none", cases: "demo-b", arm: f.arm, casesDir: f.casesDir, isolation: "none" }
  await assert.rejects(runBatch(live, { caller: f.caller, ...quiet }), /refusing a live run with --isolation none: the sandbox isolates the environment, not the filesystem/)
  await assert.rejects(runBatch(live, { caller: { ...f.caller, EVALS_ISOLATION: "container" }, ...quiet }), /refusing a live run with --isolation none/, "the flag wins over EVALS_ISOLATION")
  // "Not live" is not "confined": the scripted model with no credential can still call a shell tool.
  const scripted = { ...live, iteration: "mocked", model: "mock/m1", scripted: true }
  await assert.rejects(runBatch(scripted, { caller: f.caller, ...quiet }), /refusing a run with --isolation none: .*even the scripted model, which can call a shell tool/)
  // With no backend named, a run is confined in a container, the scripted model's too: here Docker is missing, so the
  // batch stops before any run.
  const { isolation: _, ...unnamed } = live
  const { isolation: __, ...unnamedScripted } = scripted
  for (const options of [unnamed, unnamedScripted]) await assert.rejects(runBatch(options, { caller: { ...f.caller, EVALS_DOCKER: join(f.root, "no-docker") }, ...quiet }), /--isolation container: no docker client/)
  await assert.rejects(runBatch({ ...live, isolation: "container", unsafeNoIsolation: true }, { caller: f.caller, ...quiet }), /--unsafe-no-isolation means --isolation none/)
  await assert.rejects(runBatch({ ...live, isolation: "container", parallel: 9 }, { caller: f.caller, ...quiet }), /--parallel 9 is more than the container backend allows \(8/)
  await assert.rejects(runBatch({ ...live, isolation: "chroot" }, { caller: f.caller, ...quiet }), /unknown --isolation "chroot"/)
  assert.deepEqual(readLedger(f.store), [])
  assert.deepEqual(readdirSync(f.tmp), [])
  assert.equal(existsSync(join(f.store, "raw", "live")), false)
  // The caller can take the risk in so many words; the recording says it was taken, for a scripted run as for a live one.
  const lines = []
  await runBatch({ ...live, unsafeNoIsolation: true }, { caller: f.caller, log: (line) => lines.push(line) })
  assert.ok(lines.some((line) => /WARNING: --unsafe-no-isolation/.test(line)))
  const summary = JSON.parse(readFileSync(join(f.store, "raw", "live", "demo", "demo-b.t1.summary.json"), "utf8"))
  assert.equal(summary.isolation, "none")
  assert.equal(summary.unsafe_no_isolation, true)
  const mock = await runBatch({ ...scripted, unsafeNoIsolation: true }, { caller: f.caller, ...quiet })
  assert.equal(mock.unsafe_no_isolation, true)
  await assert.rejects(runBatch({ ...live, iteration: "scripted-other", model: "claude-agent/haiku", scripted: true, unsafeNoIsolation: true }, { caller: f.caller, ...quiet }), /--scripted runs the harness's scripted model/)
  const dry = spawnSync(process.execPath, [BIN, "run", "--plugin", "demo", "--iteration", "dry2", "--model", "claude-agent/haiku", "--auth", "none", "--arm", f.arm, "--cases-dir", f.casesDir, "--isolation", "none", "--dry-run"], { env: f.caller, encoding: "utf8" })
  assert.match(dry.stdout, /the batch would be refused: refusing a live run/)
  const dryDefault = spawnSync(process.execPath, [BIN, "run", "--plugin", "demo", "--iteration", "dry3", "--model", "claude-agent/haiku", "--auth", "none", "--arm", f.arm, "--cases-dir", f.casesDir, "--dry-run"], { env: f.caller, encoding: "utf8" })
  assert.match(dryDefault.stdout, /isolation: container\n  egress allowed to api\.anthropic\.com, claude\.ai, console\.anthropic\.com, platform\.claude\.com on 443/)
  f.cleanup()
})

test("a run that writes a sign-in file of its own leaves the caller's file byte for byte, mtime included", async () => {
  const f = fixture()
  const real = join(f.home, ".claude", ".credentials.json")
  const before = { bytes: readFileSync(real), mtime: lstatSync(real).mtimeMs }
  addCase(f.casesDir, "refreshes", "")
  const refreshes = JSON.parse(readFileSync(join(f.casesDir, "refreshes.json"), "utf8"))
  writeFileSync(join(f.casesDir, "refreshes.json"), JSON.stringify({ ...refreshes, prompt: "refresh the token" }))
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "rf", model: "claude-agent/haiku", auth: "claude-agent", cases: "refreshes", arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet })
  assert.equal(result.bad, 0, JSON.stringify(result.results))
  assert.deepEqual(readFileSync(real), before.bytes)
  assert.equal(lstatSync(real).mtimeMs, before.mtime)
  assert.deepEqual(readdirSync(f.tmp), [], "the sandbox, and the file the run wrote, are gone")
  f.cleanup()
})

test("a sign-in that is a FIFO, a link, too large, not JSON or not a sign-in is refused, without hanging", async () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-cred-"))
  const file = join(dir, "c.json")
  const fifo = join(dir, "fifo")
  spawnSync("mkfifo", [fifo])
  const started = Date.now()
  assert.throws(() => readCredential(fifo), /is not a regular file/)
  assert.ok(Date.now() - started < 1000, "a FIFO does not block the read")
  writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: "a", expiresAt: 1 } }))
  symlinkSync(file, join(dir, "link"))
  assert.throws(() => readCredential(join(dir, "link")), /is a symbolic link/)
  writeFileSync(join(dir, "big"), "x".repeat(CREDENTIAL_LIMIT + 1))
  assert.throws(() => readCredential(join(dir, "big")), /more than a sign-in/)
  writeFileSync(join(dir, "bad"), "{not json")
  assert.throws(() => readCredential(join(dir, "bad")), /is not JSON/)
  writeFileSync(join(dir, "other"), JSON.stringify({ apiKey: "k" }))
  assert.throws(() => readCredential(join(dir, "other")), /does not hold a Claude sign-in/)
  assert.equal(readCredential(file).expiresAt, 1)
  // The errors never carry the content.
  try {
    readCredential(join(dir, "other"))
  } catch (error) {
    assert.doesNotMatch(error.message, /apiKey|"k"/)
  }
  // And a batch on any of them is refused before anything is reserved.
  const f = fixture()
  const real = join(f.home, ".claude", ".credentials.json")
  rmSync(real)
  spawnSync("mkfifo", [real])
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "ff", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-b", arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet }), /is not a regular file/)
  assert.deepEqual(readLedger(f.store), [])
  assert.deepEqual(readdirSync(f.tmp), [])
  f.cleanup()
  rmSync(dir, { recursive: true, force: true })
})

test("a sign-in with no expiry is refused unless --accept-unknown-token-expiry, which the record and the dry run show", async () => {
  const f = fixture()
  const real = join(f.home, ".claude", ".credentials.json")
  const dir = mkdtempSync(join(tmpdir(), "evals-expiry-"))
  // null or absent: unknown; anything else that is not a number: not a sign-in. The refresh token is never returned.
  for (const [label, oauth, expected] of [
    ["null", { accessToken: TOKEN, refreshToken: "r1", expiresAt: null }, { accessToken: TOKEN, expiresAt: null }],
    ["absent", { accessToken: TOKEN, refreshToken: "r1" }, { accessToken: TOKEN, expiresAt: null }],
    ["a number", { accessToken: TOKEN, refreshToken: "r1", expiresAt: 5 }, { accessToken: TOKEN, expiresAt: 5 }],
  ]) {
    writeFileSync(join(dir, label), JSON.stringify({ claudeAiOauth: oauth }))
    assert.deepEqual(readCredential(join(dir, label)), expected, label)
  }
  for (const [label, oauth] of [["a string expiry", { accessToken: TOKEN, expiresAt: "soon" }], ["an empty token", { accessToken: "", expiresAt: null }], ["no token", { expiresAt: null }]]) {
    writeFileSync(join(dir, "bad"), JSON.stringify({ claudeAiOauth: oauth }))
    assert.throws(() => readCredential(join(dir, "bad")), /does not hold a Claude sign-in/, label)
  }
  rmSync(dir, { recursive: true, force: true })
  writeFileSync(real, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, refreshToken: "r1", expiresAt: null } }))
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  const options = { ...UNCONFINED, plugin: "demo", iteration: "unk", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-b", arm: f.arm, casesDir: f.casesDir }
  await assert.rejects(runBatch(options, { caller, ...quiet }), /has no expiry .*pass --accept-unknown-token-expiry/)
  assert.deepEqual(readLedger(f.store), [], "nothing reserved")
  const lines = []
  const ok = await runBatch({ ...options, acceptUnknownTokenExpiry: true }, { caller, log: (line) => lines.push(line) })
  assert.equal(ok.launched, 1)
  assert.ok(lines.some((line) => /WARNING: --accept-unknown-token-expiry/.test(line)))
  const dirRaw = join(f.store, "raw", "unk", "demo")
  const record = JSON.parse(readFileSync(join(dirRaw, readdirSync(dirRaw).find((n) => n.startsWith("batch-"))), "utf8"))
  assert.equal(record.horizon.expires, "unknown")
  assert.equal(record.horizon.accepted_by_flag, true)
  const cli = (extra) => spawnSync(process.execPath, [BIN, "run", "--plugin", "demo", "--iteration", "unk-dry", "--model", "claude-agent/haiku", "--auth", "claude-agent", "--isolation", "none", "--unsafe-no-isolation", "--arm", f.arm, "--cases-dir", f.casesDir, "--cases", "demo-b", "--dry-run", ...extra], { env: caller, encoding: "utf8" }).stdout
  assert.match(cli([]), /dry run: the batch would be refused: --auth claude-agent: the Claude sign-in has no expiry/)
  assert.match(cli(["--accept-unknown-token-expiry"]), /credential: expires unknown, accepted_by_flag true/)
  // A known expiry is what decides, flag or not: the record says nothing of an unknown one.
  writeFileSync(real, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, refreshToken: "r1", expiresAt: Date.now() + 10 * 3_600_000 } }))
  const known = await runBatch({ ...options, iteration: "known", acceptUnknownTokenExpiry: true }, { caller, ...quiet })
  assert.deepEqual(known.horizon, { timeout_s: 420, run_overhead_s: 120, rounds: 1 })
  assert.match(cli(["--accept-unknown-token-expiry"]), /credential: the sign-in expires at \d{4}-/)
  writeFileSync(real, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, refreshToken: "r1", expiresAt: Date.now() + 5 * 60_000 } }))
  await assert.rejects(runBatch({ ...options, iteration: "known2", acceptUnknownTokenExpiry: true }, { caller, ...quiet }), /expires at .*refresh it first/, "the flag does not lift a known, too-near expiry")
  f.cleanup()
})

test("a trial refused authentication is infra: auth, released, not graded, and stops the batch launching", async () => {
  const f = fixture({ cases: [["a-auth", ""], ["b-after", ""]] })
  const c = JSON.parse(readFileSync(join(f.casesDir, "a-auth.json"), "utf8"))
  writeFileSync(join(f.casesDir, "a-auth.json"), JSON.stringify({ ...c, prompt: "auth-fail now" }))
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "authf", model: "claude-agent/haiku", auth: "claude-agent", set: "all", parallel: 1, arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet })
  assert.equal(result.launched, 1, "nothing launched after the first refusal")
  assert.equal(result.results[0].infra, "auth")
  assert.match(result.stopped, /a-auth\.t1 was refused authentication \(infra: auth\)/)
  const summary = JSON.parse(readFileSync(join(f.store, "raw", "authf", "demo", "a-auth.t1.summary.json"), "utf8"))
  assert.equal(summary.infra, "auth")
  // Both runs go back to the reserve: the refused one and the one never launched; no run is recorded as spent.
  const ledger = readLedger(f.store)
  assert.equal(ledger.filter((e) => e.kind === "release").reduce((n, e) => n + e.runs, 0), 2)
  assert.equal(ledger.filter((e) => e.kind === "run").length, 0)
  assert.equal(usage(ledger, { month: new Date().toISOString().slice(0, 7), plugin: "demo", iteration: "authf" }).per_plugin_month, 0)
  const env = { PATH: process.env.PATH, EVALS_STORE: f.store, EVALS_MODELS_CATALOG: join(f.root, "absent.json") }
  spawnSync(process.execPath, [BIN, "trace", "--iteration", "authf", "--plugin", "demo"], { env })
  spawnSync(process.execPath, [BIN, "grade", "--iteration", "authf", "--plugin", "demo", "--cases", f.casesDir], { env })
  const verdicts = JSON.parse(readFileSync(join(f.store, "results", "authf", "verdicts.json"), "utf8"))
  const graded = verdicts.find((v) => v.case === "a-auth")
  assert.equal(graded.verdict, "NOT_RUN", JSON.stringify(graded))
  assert.equal(graded.infra, "auth")
  // What counts as refused authentication: the provider's word, with no model work; not a tool's output, not a proxy.
  const { authFailed } = await import("../src/run/runner.mjs")
  assert.equal(authFailed({ stderr: "Error: 401 Unauthorized" }), true)
  assert.equal(authFailed({ stderr: "Invalid bearer token" }), true)
  assert.equal(authFailed({ stdout: JSON.stringify({ type: "error", error: { name: "ProviderAuthError", data: { message: "403 permission_error" } } }) }), true)
  assert.equal(authFailed({ stderr: "curl: (56) CONNECT tunnel failed, response 403" }), false, "an egress refusal is not a sign-in failure")
  const worked = [JSON.stringify({ type: "tool_use", part: { state: { output: "HTTP 401 from the API under test" } } }), JSON.stringify({ type: "step_finish", part: { tokens: { input: 10, output: 5 } } })].join("\n")
  assert.equal(authFailed({ stdout: worked, stderr: "status 401" }), false, "a run the model worked in is the model's")
  assert.equal(authFailed({ stderr: "the server exited" }), false)
  f.cleanup()
})

test("a model that does not route inside a trial is refused before anything is reserved; a no-route run is infra: provider", async () => {
  const f = fixture({ cases: [["a-route", ""], ["b-after", ""]] })
  const base = { ...UNCONFINED, plugin: "demo", auth: "none", set: "all", parallel: 1, arm: f.arm, casesDir: f.casesDir }
  // The stand-in host routes mock/m1 and the Claude Agent models, not this one: the preflight trial says so.
  await assert.rejects(runBatch({ ...base, iteration: "noroute", model: "claude-agent/not-a-model" }, { caller: { ...f.caller, EVALS_ROUTE_TIMEOUT_S: "1" }, ...quiet }), /preflight: the model claude-agent\/not-a-model does not route inside a trial within 1 s, so no run was reserved\. The trial's server lists opencode\/free-1, mock\/m1, claude-agent\/haiku/)
  assert.deepEqual(readLedger(f.store), [], "nothing reserved")
  // A run whose host reports no route all the same (the provider's list changed mid-batch) is the provider's failure.
  const c = JSON.parse(readFileSync(join(f.casesDir, "a-route.json"), "utf8"))
  writeFileSync(join(f.casesDir, "a-route.json"), JSON.stringify({ ...c, prompt: "no-route please" }))
  const result = await runBatch({ ...base, iteration: "prov", model: "mock/m1", scripted: true }, { caller: f.caller, ...quiet })
  assert.equal(result.preflight.model, "mock/m1")
  assert.equal(result.results[0].infra, "provider")
  assert.equal(result.launched, 1, "nothing launched after it")
  assert.match(result.stopped, /never reached its model \(infra: provider\)/)
  assert.equal(readLedger(f.store).filter((e) => e.kind === "run").length, 0, "no run spent")
  const env = { PATH: process.env.PATH, EVALS_STORE: f.store, EVALS_MODELS_CATALOG: join(f.root, "absent.json") }
  spawnSync(process.execPath, [BIN, "trace", "--iteration", "prov", "--plugin", "demo"], { env })
  spawnSync(process.execPath, [BIN, "grade", "--iteration", "prov", "--plugin", "demo", "--cases", f.casesDir], { env })
  const verdict = JSON.parse(readFileSync(join(f.store, "results", "prov", "verdicts.json"), "utf8")).find((v) => v.case === "a-route")
  assert.equal(verdict.verdict, "NOT_RUN")
  assert.equal(verdict.infra, "provider")
  const { providerFailed, preModelFailure } = await import("../src/run/runner.mjs")
  assert.equal(providerFailed({ stdout: JSON.stringify({ type: "error", error: { type: "provider.no-route", message: "Model unavailable: claude-agent/haiku" } }) }), true)
  assert.equal(providerFailed({ noRoute: true }), true)
  assert.equal(providerFailed({ stdout: [JSON.stringify({ type: "text", part: { text: "provider.no-route is a string in my answer" } }), JSON.stringify({ type: "step_finish", part: { tokens: { input: 5, output: 1 } } })].join("\n") }), false, "a run the model worked in is the model's")
  assert.equal(preModelFailure({ stderr: "Error: 401 Unauthorized" }), "auth")
  f.cleanup()
})

test("a batch that could outlive its sign-in is refused, with the step that fixes it", async () => {
  const now = Date.parse("2026-11-11T12:00:00Z")
  assert.doesNotThrow(() => assertTokenLasts(now + 60 * 60_000, 20 * 60_000, now))
  assert.throws(() => assertTokenLasts(now + 25 * 60_000, 20 * 60_000, now), /expires at 2026-11-11T12:25:00.000Z, within the 30 minutes .*start `claude` once interactively/)
  const f = fixture()
  const real = join(f.home, ".claude", ".credentials.json")
  writeFileSync(real, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, refreshToken: "r1", expiresAt: Date.now() + 20 * 60_000 } }))
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  // 3 runs, 1 at a time, 420 s each in the worst case: 21 minutes, plus 10 of margin, is more than the 20 left.
  await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "exp", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-b", trials: 3, parallel: 1, arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet }), /expires at .*refresh it first/)
  assert.deepEqual(readLedger(f.store), [])
  // One quick run fits: 1 x (60 s + 120 s of overhead) + 10 minutes.
  const ok = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "exp2", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-b", timeout: 60, arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet })
  assert.equal(ok.launched, 1)
  assert.deepEqual(ok.horizon, { timeout_s: 60, run_overhead_s: 120, rounds: 1 })
  // Each run's overhead counts, round by round: two 60 s runs one at a time need 2 x 3 minutes + 10, more than the 14
  // left, though their timeouts alone (2 + 10) would fit.
  writeFileSync(real, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, refreshToken: "r1", expiresAt: Date.now() + 14 * 60_000 } }))
  const two = { ...UNCONFINED, plugin: "demo", iteration: "exp3", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-b", trials: 2, parallel: 1, timeout: 60, arm: f.arm, casesDir: f.casesDir }
  await assert.rejects(runBatch(two, { caller, ...quiet }), /expires at .*within the 16 minutes/)
  const measured = await runBatch(two, { caller: { ...caller, EVALS_RUN_OVERHEAD_S: "0" }, ...quiet })
  assert.equal(measured.launched, 2, "with the overhead configured to nothing, the timeouts alone decide")
  await assert.rejects(runBatch({ ...two, iteration: "exp4" }, { caller: { ...caller, EVALS_RUN_OVERHEAD_S: "soon" }, ...quiet }), /per-run overhead must be a number of seconds/)
  f.cleanup()
})

test("a world's env cannot replace the sealed config, the sandbox's directories or the credential", async () => {
  const f = fixture()
  const module = join(f.root, "env-world.mjs")
  writeFileSync(module, `export default { name: "env", status: () => ({ fresh: true }), prepare: async ({ sandbox }) => { const { mkdirSync } = await import("node:fs"); mkdirSync(sandbox.project, { recursive: true }); return { cwd: sandbox.project, env: { OPENCODE_CONFIG_CONTENT: '{"plugins":[{"package":"/elsewhere"}]}', OPENCODE_CONFIG_DIR: "/elsewhere", HOME: "/elsewhere", XDG_DATA_HOME: "/elsewhere", TMPDIR: "/elsewhere", PATH: "/elsewhere", CLAUDE_CONFIG_DIR: "/elsewhere", CLAUDE_CODE_OAUTH_TOKEN: "world-token-000000", SPIKE_MOCK_URL: "http://elsewhere/v1", NODE_OPTIONS: "--require /elsewhere", WORLD_NOTE: "kept" } } } }\n`)
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "wenv", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-b", arm: f.arm, casesDir: f.casesDir, world: module, keep: true, keepCredentials: true }, { caller, ...quiet })
  assert.equal(result.bad, 0, JSON.stringify(result.results))
  const home = join(result.keptAt, "runs", "demo-b.t1", "home")
  const run = JSON.parse(readFileSync(join(home, "run.json"), "utf8"))
  assert.equal(run.env.WORLD_NOTE, "kept", "a world's own variable reaches the run")
  assert.deepEqual(JSON.parse(run.env.OPENCODE_CONFIG_CONTENT).plugins, [{ package: join(result.keptAt, "arm") }])
  for (const key of ["OPENCODE_CONFIG_DIR", "HOME", "XDG_DATA_HOME", "TMPDIR", "CLAUDE_CONFIG_DIR"]) assert.ok(run.env[key].startsWith(join(result.keptAt, "runs", "demo-b.t1")), key)
  assert.equal(run.env.PATH, f.caller.PATH)
  // The harness's token (masked in a kept sandbox, as every copy of it is), not the world's.
  assert.equal(run.env.CLAUDE_CODE_OAUTH_TOKEN, "*".repeat(TOKEN.length), "the harness's credential, not the world's")
  for (const key of ["SPIKE_MOCK_URL", "NODE_OPTIONS"]) assert.equal(run.env[key], undefined, key)
  const summary = JSON.parse(readFileSync(join(f.store, "raw", "wenv", "demo", "demo-b.t1.summary.json"), "utf8"))
  assert.deepEqual(summary.world_env_ignored, ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "HOME", "NODE_OPTIONS", "OPENCODE_CONFIG_CONTENT", "OPENCODE_CONFIG_DIR", "PATH", "SPIKE_MOCK_URL", "TMPDIR", "XDG_DATA_HOME"])
  f.cleanup()
})

test("the isolation refusal comes before a world module is imported", async () => {
  const f = fixture()
  const marker = join(f.root, "imported")
  const module = join(f.root, "world.mjs")
  writeFileSync(module, `import { writeFileSync } from "node:fs"\nwriteFileSync(${JSON.stringify(marker)}, "ran")\nexport default { name: "w", status: () => ({ fresh: true }), prepare: async ({ sandbox }) => ({ cwd: sandbox.root }) }\n`)
  await assert.rejects(runBatch({ plugin: "demo", iteration: "wm", model: "claude-agent/haiku", auth: "none", cases: "demo-b", arm: f.arm, casesDir: f.casesDir, world: module, isolation: "none" }, { caller: f.caller, ...quiet }), /refusing a live run/)
  assert.equal(existsSync(marker), false, "the world module's code never ran")
  f.cleanup()
})

test("isLive: only no credential and the harness's own scripted model, in the sealed config, is not live", async () => {
  const { isLive } = await import("../src/run/isolation.mjs")
  const { sealedConfig } = await import("../src/run/sandbox.mjs")
  const scripted = sealedConfig({ armDir: "/tmp/arm", model: "mock/m1", scripted: true })
  const plain = sealedConfig({ armDir: "/tmp/arm", model: "mock/m1" })
  assert.equal(isLive({ auth: "none", model: "mock/m1", config: scripted }), false)
  assert.equal(isLive({ auth: "claude-agent", model: "mock/m1", config: scripted }), true)
  assert.equal(isLive({ auth: "env", model: "mock/m1", config: scripted }), true)
  assert.equal(isLive({ auth: "none", model: "mock/m1", config: plain }), true, "a mock the harness did not register")
  assert.equal(isLive({ auth: "none", model: "mock/m2", config: scripted }), true)
  assert.equal(isLive({ auth: "none", model: "mock/m1", config: { plugins: [{ package: "/elsewhere/mock-provider" }] } }), true)
})

test("the dollar check runs inside the ledger's lock: racing processes reserve exactly what the cap affords", async () => {
  const f = fixture()
  const ledger = join(import.meta.dirname, "..", "src", "cost", "ledger.mjs")
  const budget = join(import.meta.dirname, "..", "src", "cost", "budget.mjs")
  const child = join(f.root, "reserve.mjs")
  // Each child checks the budget, holds still for a moment (a slow read, a busy disk), then reserves one $0.25 run
  // against a $1 cap. Inside the lock the checks queue and exactly four fit; outside it they all see an empty ledger.
  writeFileSync(
    child,
    `import { reserve } from ${JSON.stringify(ledger)}
import { assertBatchWithinBudget } from ${JSON.stringify(budget)}
const [store, at] = process.argv.slice(2)
const env = { EVALS_BUDGET_MODEL_USD: "1", EVALS_STORE: store }
while (Date.now() < Number(at)) {}
try {
  reserve(store, { plugin: "demo", iteration: "race", runs: 1, env, perRunUsd: 0.25, priceBasis: "test", check: () => {
    const result = assertBatchWithinBudget(store, { runs: 1, perRunUsd: 0.25 }, env)
    const until = Date.now() + 150
    while (Date.now() < until) {}
    return result
  } })
  console.log("reserved")
} catch (error) {
  console.log(/D4 budget/.test(error.message) ? "refused" : "error " + error.message)
}
`,
  )
  const at = Date.now() + 1500
  const outcomes = await Promise.all(
    Array.from({ length: 8 }, () =>
      new Promise((done) => {
        const proc = spawn(process.execPath, [child, f.store, String(at)], { stdio: ["ignore", "pipe", "pipe"] })
        let out = ""
        proc.stdout.on("data", (d) => (out += d))
        proc.stderr.on("data", (d) => (out += d))
        proc.on("exit", () => done(out.trim()))
      }),
    ),
  )
  assert.deepEqual(outcomes.slice().sort(), [...Array(4).fill("refused"), ...Array(4).fill("reserved")], outcomes.join(" | "))
  assert.equal(readLedger(f.store).filter((e) => e.kind === "reserve").length, 4)
  f.cleanup()
})

test("links out of the sandbox are cut wherever a world put them, not only in its home", async () => {
  const f = fixture()
  const world = join(f.root, "world")
  mkdirSync(join(world, "home"), { recursive: true })
  mkdirSync(join(world, "repos", "api-repo"), { recursive: true })
  // The world's per-sandbox step (the operator's own script) leaves links outside home: in the working copy and at
  // the sandbox's root.
  writeFileSync(join(world, "world.json"), JSON.stringify({ home: "home", repos: "repos", cwd: { api: "api-repo" }, prepare: `ln -s "${f.home}" "$EVALS_RUN_CWD/out-link" && ln -s "${f.home}/.claude" "$EVALS_SANDBOX_ROOT/root-link" && ln -s ../api-repo "$EVALS_RUN_CWD/stays-inside"` }))
  addCase(f.casesDir, "outside-home", "- Seed: cwd=api")
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "rl", model: "mock/m1", auth: "none", scripted: true, cases: "outside-home", arm: f.arm, casesDir: f.casesDir, world, keep: true }, { caller: f.caller, ...quiet })
  assert.equal(result.bad, 0, JSON.stringify(result.results))
  const sandbox = join(result.keptAt, "runs", "outside-home.t1")
  assert.equal(existsSync(join(sandbox, "work", "api-repo", "out-link")) || lstatSafe(join(sandbox, "work", "api-repo", "out-link")), false, "the link in the working copy is cut")
  assert.equal(lstatSafe(join(sandbox, "root-link")), false, "the link at the sandbox's root is cut")
  assert.ok(lstatSafe(join(sandbox, "work", "api-repo", "stays-inside")), "a link that stays inside is kept")
  f.cleanup()
})

const lstatSafe = (path) => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

test("the batch record is scrubbed as a whole: a secret in a field nobody scrubbed on its own does not reach it", async () => {
  const f = fixture()
  // A module world whose provenance carries the token: it lands in the batch record's facts, which no step scrubs
  // field by field.
  const module = join(f.root, "leaky-world.mjs")
  writeFileSync(module, `export default { name: "leaky", status: () => ({ fresh: true }), prepare: async ({ sandbox }) => { const { mkdirSync } = await import("node:fs"); mkdirSync(sandbox.project, { recursive: true }); return { cwd: sandbox.project } }, provenance: () => ({ name: "leaky", note: ${JSON.stringify(`built with ${TOKEN}`)} }) }\n`)
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "rec", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-b", arm: f.arm, casesDir: f.casesDir, world: module }, { caller, ...quiet })
  const dir = join(f.store, "raw", "rec", "demo")
  const record = readFileSync(join(dir, readdirSync(dir).find((n) => n.startsWith("batch-"))), "utf8")
  assert.equal(record.includes(TOKEN), false)
  assert.match(record, /built with \*{8,}/, "the field is there, masked")
  f.cleanup()
})

test("the access token is scrubbed from every recording, summary, files record and log line, and from a kept sandbox", async () => {
  const f = fixture()
  addCase(f.casesDir, "leaky", "")
  const leaky = JSON.parse(readFileSync(join(f.casesDir, "leaky.json"), "utf8"))
  writeFileSync(join(f.casesDir, "leaky.json"), JSON.stringify({ ...leaky, prompt: "leak the token" }))
  const real = join(f.home, ".claude")
  const before = Object.fromEntries(readdirSync(real).map((n) => [n, { bytes: readFileSync(join(real, n)), mtime: lstatSync(join(real, n)).mtimeMs }]))
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  const lines = []
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "lk", model: "claude-agent/haiku", auth: "claude-agent", cases: "leaky", arm: f.arm, casesDir: f.casesDir, keep: true, keepCredentials: true }, { caller, log: (line) => lines.push(line) })
  assert.equal(result.bad, 0, JSON.stringify(result.results))
  const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []))
  const holding = (dir) => files(dir).filter((file) => readFileSync(file).includes(TOKEN))
  assert.deepEqual(holding(join(f.store, "raw", "lk")), [], "no recording, summary, files record or batch record holds it")
  assert.deepEqual(holding(result.keptAt), [], "no file under the kept sandbox holds it")
  assert.ok(lines.every((line) => !line.includes(TOKEN)))
  // It was there to be scrubbed: masked where the agent printed it.
  const recording = readFileSync(join(f.store, "raw", "lk", "demo", "leaky.t1.jsonl"), "utf8")
  assert.ok(recording.includes("*".repeat(TOKEN.length)))
  assert.match(readFileSync(join(f.store, "raw", "lk", "demo", "leaky.t1.summary.json"), "utf8"), /debug token \*+/)
  // The caller's ~/.claude is byte for byte, and mtime for mtime, what it was.
  assert.deepEqual(readdirSync(real).sort(), Object.keys(before).sort())
  for (const [name, was] of Object.entries(before)) {
    assert.deepEqual(readFileSync(join(real, name)), was.bytes, name)
    assert.equal(lstatSync(join(real, name)).mtimeMs, was.mtime, name)
  }
  f.cleanup()
})

test("stderr is scrubbed before it is cut: a token straddling the cut leaves no tail in the summary", async () => {
  const f = fixture({ cases: [["straddles", ""]] })
  const c = JSON.parse(readFileSync(join(f.casesDir, "straddles.json"), "utf8"))
  writeFileSync(join(f.casesDir, "straddles.json"), JSON.stringify({ ...c, prompt: "straddle the cut" }))
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "cut", model: "claude-agent/haiku", auth: "claude-agent", cases: "straddles", arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet })
  const summary = JSON.parse(readFileSync(join(f.store, "raw", "cut", "demo", "straddles.t1.summary.json"), "utf8"))
  assert.equal(summary.stderr.length, 4000)
  assert.ok(summary.stderr.startsWith("*"), "the cut runs through the masked token")
  for (let n = 8; n < TOKEN.length; n++) assert.equal(summary.stderr.includes(TOKEN.slice(-n)), false, `no ${n}-character tail of the token`)
  // The helper every other cut uses (a server's stderr, a world step's, a docker error) scrubs first too.
  const { tail, registerSecrets } = await import("../src/run/secrets.mjs")
  const secret = "straddling-secret-0123456789"
  registerSecrets([secret])
  assert.equal(tail(`${secret}${"z".repeat(10)}`, 20), `${"*".repeat(10)}${"z".repeat(10)}`)
  f.cleanup()
})

test("the scrubber masks a secret by its exact value, in text and in files, keeping their size", async () => {
  const { redactor, scrubTree } = await import("../src/run/secrets.mjs")
  const redact = redactor([TOKEN, "short"])
  assert.equal(redact(`a ${TOKEN} b ${TOKEN}`), `a ${"*".repeat(TOKEN.length)} b ${"*".repeat(TOKEN.length)}`)
  assert.equal(redact("short stays"), "short stays", "a value under 8 characters is not a secret worth masking everywhere")
  const dir = mkdtempSync(join(tmpdir(), "evals-scrub-"))
  writeFileSync(join(dir, "db"), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(TOKEN), Buffer.from([3])]))
  mkdirSync(join(dir, "deep", "er"), { recursive: true })
  writeFileSync(join(dir, "deep", "er", "log"), `x ${TOKEN}\n`)
  writeFileSync(join(dir, "clean"), "nothing")
  assert.equal(scrubTree(dir, redact).length, 2)
  assert.equal(readFileSync(join(dir, "db")).length, 3 + TOKEN.length + 1)
  assert.equal(readFileSync(join(dir, "db")).includes(TOKEN), false)
  assert.equal(readFileSync(join(dir, "deep", "er", "log"), "utf8"), `x ${"*".repeat(TOKEN.length)}\n`)
  rmSync(dir, { recursive: true, force: true })
})

test("a batch with no price for its runs says the dollar cap is not enforceable for it, in the log and the summary", async () => {
  const f = fixture()
  const lines = []
  await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "np", model: "mock/m1", auth: "none", scripted: true, cases: "demo-b", arm: f.arm, casesDir: f.casesDir }, { caller: f.caller, log: (line) => lines.push(line) })
  assert.ok(lines.some((line) => /dollar cap: NOT ENFORCEABLE for this batch .*the run caps alone apply/.test(line)))
  const summary = JSON.parse(readFileSync(join(f.store, "raw", "np", "demo", "demo-b.t1.summary.json"), "utf8"))
  assert.equal(summary.dollar_cap.enforceable, false)
  // With an assumed price the cap is enforced, and recorded with its basis.
  await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "ap", model: "mock/m1", auth: "none", scripted: true, cases: "demo-b", arm: f.arm, casesDir: f.casesDir }, { caller: { ...f.caller, EVALS_ASSUMED_RUN_USD: "0.5" }, ...quiet })
  const priced = JSON.parse(readFileSync(join(f.store, "raw", "ap", "demo", "demo-b.t1.summary.json"), "utf8"))
  assert.deepEqual(priced.dollar_cap, { enforceable: true, per_run_usd: 0.5, basis: "assumed (EVALS_ASSUMED_RUN_USD)" })
  f.cleanup()
})

test("links out of the sandbox are cut anywhere in it, and a world repository that is or holds one is refused", async () => {
  const f = fixture()
  const world = join(f.root, "world")
  mkdirSync(join(world, "home", ".local", "share", "a", "b", "c"), { recursive: true })
  symlinkSync(f.home, join(world, "home", ".local", "share", "a", "b", "c", "deep-link"))
  symlinkSync(".local", join(world, "home", "inner-link"))
  symlinkSync(join(world, "home", ".local"), join(world, "home", "absolute-to-world"))
  mkdirSync(join(world, "repos", "api-repo", "src"), { recursive: true })
  writeFileSync(join(world, "world.json"), JSON.stringify({ home: "home", repos: "repos", cwd: { api: "api-repo" } }))
  addCase(f.casesDir, "deep", "- Seed: cwd=api")
  const ok = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "dl", model: "mock/m1", auth: "none", scripted: true, cases: "deep", arm: f.arm, casesDir: f.casesDir, world, keep: true }, { caller: f.caller, ...quiet })
  assert.equal(ok.bad, 0, JSON.stringify(ok.results))
  const home = join(ok.keptAt, "runs", "deep.t1", "home")
  assert.equal(existsSync(join(home, ".local", "share", "a", "b", "c", "deep-link")), false, "five levels down, still cut")
  assert.ok(lstatSync(join(home, "inner-link")).isSymbolicLink(), "a relative link that stays inside the sandbox is kept")
  assert.equal(existsSync(join(home, "absolute-to-world")), false, "a link back to the world itself leaves the sandbox: cut")
  // A repository holding a link out of the world, or being one, is refused.
  symlinkSync(f.home, join(world, "repos", "api-repo", "src", "escape"))
  const held = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "dl2", model: "mock/m1", auth: "none", scripted: true, cases: "deep", arm: f.arm, casesDir: f.casesDir, world }, { caller: f.caller, ...quiet })
  assert.match(held.results[0].error, /holds a link out of the world \(src\/escape\)/)
  rmSync(join(world, "repos", "api-repo"), { recursive: true, force: true })
  mkdirSync(join(f.root, "elsewhere-repo"))
  symlinkSync(join(f.root, "elsewhere-repo"), join(world, "repos", "api-repo"))
  const linked = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "dl3", model: "mock/m1", auth: "none", scripted: true, cases: "deep", arm: f.arm, casesDir: f.casesDir, world }, { caller: f.caller, ...quiet })
  assert.match(linked.results[0].error, /outside|is a symbolic link/)
  f.cleanup()
})

test("a batch whose world contradicts a case's Truth: is refused before anything is reserved", async () => {
  const f = fixture()
  addCase(f.casesDir, "claims", "- Truth: counts.top == 40")
  const world = join(f.root, "truthworld")
  mkdirSync(world, { recursive: true })
  writeFileSync(join(world, "truth.json"), JSON.stringify({ counts: { top: 42 } }))
  writeFileSync(join(world, "world.json"), JSON.stringify({ truth: "truth.json" }))
  await assert.rejects(runBatch({ ...UNCONFINED, plugin: "demo", iteration: "truthy", model: "mock/m1", auth: "none", scripted: true, cases: "claims", arm: f.arm, casesDir: f.casesDir, world }, { caller: f.caller, ...quiet }), /counts\.top is 42, the case was written for 40/)
  assert.equal(readLedger(f.store).filter((e) => e.kind === "reserve").length, 0, "nothing reserved")
  writeFileSync(join(world, "truth.json"), JSON.stringify({ counts: { top: 40 } }))
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "truthy", model: "mock/m1", auth: "none", scripted: true, cases: "claims", arm: f.arm, casesDir: f.casesDir, world }, { caller: f.caller, ...quiet })
  assert.equal(result.launched, 1)
  assert.deepEqual(result.truth, { claims: 1, cases: 1 })
  f.cleanup()
})

test("a world never built (its clock file absent) is stale and rebuilt, not an error", async () => {
  const f = fixture()
  addCase(f.casesDir, "fresh-world", "")
  const world = join(f.root, "unbuilt")
  mkdirSync(world, { recursive: true })
  writeFileSync(join(world, "world.json"), JSON.stringify({ now: "out/truth.json#now", fresh: "utc-day", build: `mkdir -p out && node -e 'require("fs").writeFileSync("out/truth.json", JSON.stringify({ now: Date.now() }))'` }))
  const { dirWorld } = await import("../src/run/world.mjs")
  const before = dirWorld(world).status({})
  assert.equal(before.fresh, false)
  assert.equal(before.rebuildable, true)
  const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "unbuilt", model: "mock/m1", auth: "none", scripted: true, cases: "fresh-world", arm: f.arm, casesDir: f.casesDir, world }, { caller: f.caller, ...quiet })
  assert.equal(result.launched, 1)
  assert.equal(existsSync(join(world, "out", "truth.json")), true)
  f.cleanup()
})
