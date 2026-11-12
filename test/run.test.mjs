// `evals run` with a stand-in OpenCode binary: no model, no network beyond loopback, deterministic outcomes.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, lstatSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { runBatch, plan } from "../src/run/runner.mjs"
import { readLedger, usage } from "../src/cost/ledger.mjs"
import { compileCase } from "../src/case/compile.mjs"
import { readCredential, assertTokenLasts, CREDENTIAL_LIMIT } from "../src/run/auth.mjs"
import { freshness, parseSeed } from "../src/run/world.mjs"
import { installFakeOpencode } from "./helpers/fake-opencode.mjs"

const BIN = join(import.meta.dirname, "..", "bin", "evals")

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
  writeFileSync(join(home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "a1", refreshToken: "r1", expiresAt: Date.now() + 10 * 3_600_000 } }), { mode: 0o600 })
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [] } }))
  writeFileSync(join(home, ".claude", "CLAUDE.md"), "global instructions\n")
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true, userID: "u1", oauthAccount: { id: "a" }, projects: { secret: true }, cachedThings: [1, 2] }))
  const bin = join(root, "bin")
  mkdirSync(bin)
  const fake = installFakeOpencode(bin)
  const store = join(root, "store")
  const tmp = join(root, "tmp")
  mkdirSync(tmp)
  const caller = { PATH: process.env.PATH, HOME: home, EVALS_STORE: store, EVALS_OPENCODE_BIN: fake, EVALS_TMP: tmp, EVALS_SECRET_PROBE: "leak", OPENCODE_SERVER_PASSWORD: "the-real-one", ANTHROPIC_API_KEY: "sk-not-for-the-run" }
  return { root, casesDir, arm, home, store, tmp, caller, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

const quiet = { log: () => {} }

test("a plan is one job per case and trial, and never overwrites a recorded trial", () => {
  const cases = [{ id: "a" }, { id: "b" }]
  assert.deepEqual(plan({ cases, trials: 2, recorded: new Map(), append: false }).map((j) => `${j.case.id}.t${j.trial}`), ["a.t1", "a.t2", "b.t1", "b.t2"])
  assert.throws(() => plan({ cases, trials: 1, recorded: new Map([["a", 2]]), append: false }), /already have recordings/)
  assert.deepEqual(plan({ cases, trials: 2, recorded: new Map([["a", 2]]), append: true }).map((j) => `${j.case.id}.t${j.trial}`), ["a.t3", "a.t4", "b.t1", "b.t2"])
  assert.deepEqual(parseSeed("cwd=api time=day"), { cwd: "api", time: "day" })
})

test("every trial is its own sandbox and its own file, in parallel, on its own port", async () => {
  const f = fixture()
  const result = await runBatch({ plugin: "demo", iteration: "it1", model: "mock/m1", auth: "none", trials: 3, parallel: 3, arm: f.arm, casesDir: f.casesDir }, { caller: f.caller, ...quiet })
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
  const result = await runBatch({ plugin: "demo", iteration: "seal", model: "mock/m1", auth: "none", cases: "demo-b", arm: f.arm, casesDir: f.casesDir, keep: true }, { caller: f.caller, ...quiet })
  const kept = result.keptAt
  const home = join(kept, "runs", "demo-b.t1", "home")
  const run = JSON.parse(readFileSync(join(home, "run.json"), "utf8"))
  assert.equal(run.env.HOME, home)
  assert.equal(run.env.OPENCODE_TEST_HOME, home)
  for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "TMPDIR"]) assert.ok(run.env[key].startsWith(join(kept, "runs", "demo-b.t1")), key)
  for (const key of ["EVALS_SECRET_PROBE", "OPENCODE_SERVER_PASSWORD", "ANTHROPIC_API_KEY", "EVALS_STORE"]) assert.equal(run.env[key], undefined, `${key} leaked into the run`)
  const config = JSON.parse(run.env.OPENCODE_CONFIG_CONTENT)
  assert.deepEqual(config, { plugins: [{ package: join(kept, "arm") }], model: "mock/m1" })
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
  await assert.rejects(runBatch({ plugin: "demo", iteration: "capped", model: "mock/m1", auth: "none", trials: 2, arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet }), /demo would reach 4 of 3 runs/)
  assert.equal(existsSync(join(f.store, "raw", "capped")), false, "no recording")
  assert.deepEqual(readLedger(f.store), [])
  // Three fit; then the month is full, across invocations.
  await runBatch({ plugin: "demo", iteration: "fits", model: "mock/m1", auth: "none", cases: "demo-a", trials: 3, arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet })
  await assert.rejects(runBatch({ plugin: "demo", iteration: "next", model: "mock/m1", auth: "none", cases: "demo-b", arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet }), /run cap/)
  assert.equal(usage(readLedger(f.store), { month: new Date().toISOString().slice(0, 7), plugin: "demo", iteration: "fits" }).per_plugin_month, 3)
  f.cleanup()
})

test("a second run into the same iteration refuses to overwrite; --append adds trials after the last", async () => {
  const f = fixture()
  const options = { plugin: "demo", iteration: "again", model: "mock/m1", auth: "none", cases: "demo-b", arm: f.arm, casesDir: f.casesDir }
  await runBatch(options, { caller: f.caller, ...quiet })
  await assert.rejects(runBatch(options, { caller: f.caller, ...quiet }), /already have recordings/)
  await runBatch({ ...options, append: true, trials: 2 }, { caller: f.caller, ...quiet })
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
  const options = { plugin: "demo", iteration: "w1", model: "mock/m1", auth: "none", cases: "demo-a", arm: f.arm, casesDir: f.casesDir, world }
  await assert.rejects(runBatch(options, { caller: f.caller, ...quiet }), /stale and was not rebuilt: the world was built for/)
  assert.deepEqual(readLedger(f.store), [], "a refused world reserves nothing")
  // With a build command, the runner rebuilds it, hands it the copied build, and stamps the build's digest.
  writeFileSync(join(world, "world.json"), JSON.stringify({ ...spec, build: `node -e 'require("fs").writeFileSync("truth.json", JSON.stringify({ now: Date.now() })); require("fs").writeFileSync("arm.txt", process.env.EVALS_WORLD_ARM)'` }))
  const result = await runBatch({ ...options, iteration: "w2", keep: true }, { caller: f.caller, ...quiet })
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
  await assert.rejects(runBatch({ ...options, iteration: "w3", stale: "refuse" }, { caller: f.caller, ...quiet }), /built by another build/)
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
  await assert.rejects(runBatch({ plugin: "demo", iteration: "ca0", model: "claude-agent/haiku", auth: "claude-agent", unsafeNoIsolation: true, cases: "demo-b", arm: f.arm, casesDir: f.casesDir }, { caller: f.caller, ...quiet }), /CLAUDE_AGENT_SDK_VERSION/)
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  const before = readdirSync(join(f.home, ".claude")).sort()
  const result = await runBatch({ plugin: "demo", iteration: "ca1", model: "claude-agent/haiku", auth: "claude-agent", unsafeNoIsolation: true, cases: "demo-b", arm: f.arm, casesDir: f.casesDir, keep: true, keepCredentials: true }, { caller, ...quiet })
  assert.equal(result.bad, 0, JSON.stringify(result.results))
  const home = join(result.keptAt, "runs", "demo-b.t1", "home")
  const imported = JSON.parse(readFileSync(join(home, "imported.json"), "utf8"))
  assert.deepEqual(JSON.parse(imported.input), { integration: "Claude Agent", kind: "external" })
  assert.deepEqual(imported.argv, ["auth", "import", "--standalone"])
  assert.equal(imported.env.HOME, home, "imported into the sandbox, not the caller's install")
  // Its own directory: the sign-in is a copy, a regular file of its own, and nothing else of the caller's ~/.claude.
  const dir = join(home, ".claude")
  assert.equal(lstatSync(dir).isSymbolicLink(), false)
  const copy = lstatSync(join(dir, ".credentials.json"))
  assert.equal(copy.isSymbolicLink(), false, "no symlink to the caller's file")
  assert.equal(copy.isFile(), true)
  assert.equal(copy.mode & 0o777, 0o600)
  assert.equal(existsSync(join(dir, "settings.json")) || existsSync(join(dir, "CLAUDE.md")), false)
  assert.equal(existsSync(join(home, ".claude.json")), false, "no ~/.claude.json in the sandbox")
  const run = JSON.parse(readFileSync(join(home, "run.json"), "utf8"))
  assert.equal(run.env.CLAUDE_AGENT_SDK_VERSION, "0.0.1-test")
  assert.equal(run.env.CLAUDE_CONFIG_DIR, dir)
  assert.equal(run.env.DISABLE_AUTOUPDATER, "1")
  assert.equal(run.env.ANTHROPIC_API_KEY, undefined)
  // What `claude` writes stays in the sandbox: the caller's ~/.claude is as it was.
  assert.ok(readdirSync(join(dir, "projects")).length > 0)
  assert.deepEqual(readdirSync(join(f.home, ".claude")).sort(), before)
  f.cleanup()
})

test("--keep with claude-agent is refused unless --keep-credentials says so", async () => {
  const f = fixture()
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  await assert.rejects(runBatch({ plugin: "demo", iteration: "kc", model: "claude-agent/haiku", auth: "claude-agent", unsafeNoIsolation: true, cases: "demo-b", arm: f.arm, casesDir: f.casesDir, keep: true }, { caller, ...quiet }), /--keep-credentials/)
  assert.deepEqual(readLedger(f.store), [], "refused before anything was reserved")
  assert.deepEqual(readdirSync(f.tmp), [], "and nothing was kept")
  const lines = []
  await runBatch({ plugin: "demo", iteration: "kc2", model: "claude-agent/haiku", auth: "claude-agent", unsafeNoIsolation: true, cases: "demo-b", arm: f.arm, casesDir: f.casesDir, keep: true, keepCredentials: true }, { caller, log: (line) => lines.push(line) })
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
  const result = await runBatch({ plugin: "demo", iteration: "wl", model: "claude-agent/haiku", auth: "claude-agent", unsafeNoIsolation: true, cases: "demo-b", arm: f.arm, casesDir: f.casesDir, world, keep: true, keepCredentials: true }, { caller, ...quiet })
  const home = join(result.keptAt, "runs", "demo-b.t1", "home")
  assert.equal(lstatSync(join(home, ".claude")).isSymbolicLink(), false)
  assert.equal(existsSync(join(home, ".local", "bin")), false)
  assert.equal(existsSync(join(home, ".claude.json")), false)
  assert.equal(existsSync(join(f.home, ".claude", "projects")), false, "nothing reached the caller's ~/.claude through the world's link")
  f.cleanup()
})

test("an unknown or missing --auth is refused before anything runs", async () => {
  const f = fixture()
  await assert.rejects(runBatch({ plugin: "demo", iteration: "a1", model: "mock/m1", arm: f.arm, casesDir: f.casesDir }, { caller: f.caller, ...quiet }), /--auth is required/)
  await assert.rejects(runBatch({ plugin: "demo", iteration: "a2", model: "mock/m1", auth: "env:NOT_SET_ANYWHERE", arm: f.arm, casesDir: f.casesDir }, { caller: f.caller, ...quiet }), /NOT_SET_ANYWHERE not set/)
  assert.deepEqual(readLedger(f.store), [])
  f.cleanup()
})

test("the CLI's dry run lists the plan and the caps, and launches nothing", () => {
  const f = fixture()
  const out = spawnSync(process.execPath, [BIN, "run", "--plugin", "demo", "--iteration", "dry", "--model", "mock/m1", "--auth", "none", "--arm", f.arm, "--cases-dir", f.casesDir, "--set", "all", "--trials", "2", "--dry-run"], { env: f.caller, encoding: "utf8" })
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
  const result = await runBatch({ plugin: "demo", iteration: "opt", model: "mock/m1", auth: "none", cases: "demo-b", arm: armFile, casesDir: f.casesDir, keep: true }, { caller: f.caller, ...quiet })
  const run = JSON.parse(readFileSync(join(result.keptAt, "runs", "demo-b.t1", "home", "run.json"), "utf8"))
  assert.deepEqual(JSON.parse(run.env.OPENCODE_CONFIG_CONTENT).plugins[0].options, { access: "ask-changes" })
  const summary = JSON.parse(readFileSync(join(f.store, "raw", "opt", "demo", "demo-b.t1.summary.json"), "utf8"))
  assert.equal(summary.provenance.access, "ask-changes")
  assert.match(summary.provenance.options, /^[0-9a-f]{64}$/)
  assert.doesNotMatch(JSON.stringify(summary), /"options":\{/, "the option values are not written, only their digest")
  await assert.rejects(runBatch({ plugin: "demo", iteration: "opt2", model: "mock/m1", auth: "none", cases: "demo-b", arm: armFile, options: "{}", casesDir: f.casesDir }, { caller: f.caller, ...quiet }), /pass one/)
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
  const result = await runBatch({ plugin: "demo", iteration: "priv", model: "mock/m1", auth: "none", set: "holdout", arm: f.arm }, { caller: f.caller, ...quiet })
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
  const result = await runBatch({ plugin: "demo", iteration: "hours", model: "mock/m1", auth: "none", cases: "timed-*", arm: f.arm, casesDir: f.casesDir }, { caller: f.caller, ...quiet })
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
  const result = await runBatch({ plugin: "demo", iteration: "cont", model: "mock/m1", auth: "none", cases: "continues", arm: f.arm, casesDir: f.casesDir, world, keep: true }, { caller: f.caller, ...quiet })
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
  await runBatch({ plugin: "demo", iteration: "files", model: "mock/m1", auth: "none", cases: "writes-note", arm: f.arm, casesDir: f.casesDir }, { caller: f.caller, ...quiet })
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
  const result = await runBatch({ plugin: "demo", iteration: "reap", model: "mock/m1", auth: "none", cases: "demo-b", arm: f.arm, casesDir: f.casesDir, keep: true }, { caller: f.caller, ...quiet })
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
  const auth = claude ? ["--auth", "claude-agent", "--model", "claude-agent/haiku", "--unsafe-no-isolation"] : ["--auth", "none", "--model", "mock/m1"]
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
  if (claude) assert.ok(existsSync(join(home, ".claude", ".credentials.json")), "the copy is there while the run runs")
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
    const result = await runBatch({ plugin: "demo", iteration: `cwd-${id}`, model: "mock/m1", auth: "none", cases: id, arm: f.arm, casesDir: f.casesDir, world }, { caller: f.caller, ...quiet })
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
  for (const trial of [1, 2]) record(f.store, { batch: "seed", month, iteration: "old", plugin: "demo", case: "c", trial, billed_usd: 1, cost_source: "billed" })
  addCase(f.casesDir, "pricey", "")
  const pricey = JSON.parse(readFileSync(join(f.casesDir, "pricey.json"), "utf8"))
  writeFileSync(join(f.casesDir, "pricey.json"), JSON.stringify({ ...pricey, prompt: "answer at cost=3" }))
  const caller = { ...f.caller, EVALS_BUDGET_MODEL_USD: "6.5" }
  // Reserved: $2 spent + 3 runs x $1 = $5, within $6.50. After the first run bills $3: $5 spent, and the next run is
  // expected to bill $1.67, which would make $6.67: the batch stops there, before crossing.
  const result = await runBatch({ plugin: "demo", iteration: "spend", model: "mock/m1", auth: "none", cases: "pricey", trials: 3, parallel: 1, arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet })
  assert.equal(result.launched, 1)
  assert.match(result.stopped, /would take the month's model spend to \$6\.67, over \$6\.5/)
  assert.equal(readLedger(f.store).find((e) => e.kind === "release").runs, 2)
  // A batch whose projection is already over the cap is refused at the reservation.
  await assert.rejects(runBatch({ plugin: "demo", iteration: "spend2", model: "mock/m1", auth: "none", cases: "pricey", trials: 3, arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet }), /D4 budget/)
  f.cleanup()
})

test("a live run is refused without filesystem isolation, before anything is created or reserved", async () => {
  const f = fixture()
  const live = { plugin: "demo", iteration: "live", model: "claude-agent/haiku", auth: "none", cases: "demo-b", arm: f.arm, casesDir: f.casesDir }
  await assert.rejects(runBatch(live, { caller: f.caller, ...quiet }), /refusing a live run with --isolation none: the sandbox isolates the environment, not the filesystem/)
  await assert.rejects(runBatch({ ...live, isolation: "container" }, { caller: f.caller, ...quiet }), /--isolation container is not implemented yet/)
  await assert.rejects(runBatch({ ...live, isolation: "chroot" }, { caller: f.caller, ...quiet }), /unknown --isolation "chroot"/)
  assert.deepEqual(readLedger(f.store), [])
  assert.deepEqual(readdirSync(f.tmp), [])
  assert.equal(existsSync(join(f.store, "raw", "live")), false)
  // The caller can take the risk in so many words; the recording says it was taken.
  const lines = []
  await runBatch({ ...live, unsafeNoIsolation: true }, { caller: f.caller, log: (line) => lines.push(line) })
  assert.ok(lines.some((line) => /WARNING: --unsafe-no-isolation/.test(line)))
  const summary = JSON.parse(readFileSync(join(f.store, "raw", "live", "demo", "demo-b.t1.summary.json"), "utf8"))
  assert.equal(summary.isolation, "none")
  assert.equal(summary.unsafe_no_isolation, true)
  // The scripted mock model drives no real tools: it is not a live run.
  const mock = await runBatch({ ...live, iteration: "mocked", model: "mock/m1" }, { caller: f.caller, ...quiet })
  assert.equal(mock.unsafe_no_isolation, undefined)
  const dry = spawnSync(process.execPath, [BIN, "run", "--plugin", "demo", "--iteration", "dry2", "--model", "claude-agent/haiku", "--auth", "none", "--arm", f.arm, "--cases-dir", f.casesDir, "--dry-run"], { env: f.caller, encoding: "utf8" })
  assert.match(dry.stdout, /the batch would be refused: refusing a live run/)
  f.cleanup()
})

test("a run that rewrites its copy of the sign-in leaves the caller's file byte for byte, mtime included", async () => {
  const f = fixture()
  const real = join(f.home, ".claude", ".credentials.json")
  const before = { bytes: readFileSync(real), mtime: lstatSync(real).mtimeMs }
  addCase(f.casesDir, "refreshes", "")
  const refreshes = JSON.parse(readFileSync(join(f.casesDir, "refreshes.json"), "utf8"))
  writeFileSync(join(f.casesDir, "refreshes.json"), JSON.stringify({ ...refreshes, prompt: "refresh the token" }))
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  const result = await runBatch({ plugin: "demo", iteration: "rf", model: "claude-agent/haiku", auth: "claude-agent", unsafeNoIsolation: true, cases: "refreshes", arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet })
  assert.equal(result.bad, 0, JSON.stringify(result.results))
  assert.deepEqual(readFileSync(real), before.bytes)
  assert.equal(lstatSync(real).mtimeMs, before.mtime)
  assert.deepEqual(readdirSync(f.tmp), [], "the sandbox, and its copy, are gone")
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
  await assert.rejects(runBatch({ plugin: "demo", iteration: "ff", model: "claude-agent/haiku", auth: "claude-agent", unsafeNoIsolation: true, cases: "demo-b", arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet }), /is not a regular file/)
  assert.deepEqual(readLedger(f.store), [])
  assert.deepEqual(readdirSync(f.tmp), [])
  f.cleanup()
  rmSync(dir, { recursive: true, force: true })
})

test("a batch that could outlive its sign-in is refused, with the step that fixes it", async () => {
  const now = Date.parse("2026-11-11T12:00:00Z")
  assert.doesNotThrow(() => assertTokenLasts(now + 60 * 60_000, 20 * 60_000, now))
  assert.throws(() => assertTokenLasts(now + 25 * 60_000, 20 * 60_000, now), /expires at 2026-11-11T12:25:00.000Z, within the 30 minutes .*start `claude` once interactively/)
  const f = fixture()
  const real = join(f.home, ".claude", ".credentials.json")
  writeFileSync(real, JSON.stringify({ claudeAiOauth: { accessToken: "a1", refreshToken: "r1", expiresAt: Date.now() + 20 * 60_000 } }))
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  // 3 runs, 1 at a time, 420 s each in the worst case: 21 minutes, plus 10 of margin, is more than the 20 left.
  await assert.rejects(runBatch({ plugin: "demo", iteration: "exp", model: "claude-agent/haiku", auth: "claude-agent", unsafeNoIsolation: true, cases: "demo-b", trials: 3, parallel: 1, arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet }), /expires at .*refresh it first/)
  assert.deepEqual(readLedger(f.store), [])
  // One quick run fits: 1 x 60 s + 10 minutes.
  const ok = await runBatch({ plugin: "demo", iteration: "exp2", model: "claude-agent/haiku", auth: "claude-agent", unsafeNoIsolation: true, cases: "demo-b", timeout: 60, arm: f.arm, casesDir: f.casesDir }, { caller, ...quiet })
  assert.equal(ok.launched, 1)
  f.cleanup()
})
