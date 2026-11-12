// `evals run` with a stand-in OpenCode binary: no model, no network beyond loopback, deterministic outcomes.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, lstatSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { runBatch, plan } from "../src/run/runner.mjs"
import { readLedger, usage } from "../src/cost/ledger.mjs"
import { compileCase } from "../src/case/compile.mjs"
import { claudeProjectDir } from "../src/run/auth.mjs"
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

test("claude-agent: the credential is piped in, the login is linked, the account file is minimal, transcripts are removed", async () => {
  const f = fixture()
  await assert.rejects(runBatch({ plugin: "demo", iteration: "ca0", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-b", arm: f.arm, casesDir: f.casesDir }, { caller: f.caller, ...quiet }), /CLAUDE_AGENT_SDK_VERSION/)
  const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test" }
  const result = await runBatch({ plugin: "demo", iteration: "ca1", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-b", arm: f.arm, casesDir: f.casesDir, keep: true }, { caller, ...quiet })
  assert.equal(result.bad, 0, JSON.stringify(result.results))
  const home = join(result.keptAt, "runs", "demo-b.t1", "home")
  const imported = JSON.parse(readFileSync(join(home, "imported.json"), "utf8"))
  assert.deepEqual(JSON.parse(imported.input), { integration: "Claude Agent", kind: "external" })
  assert.deepEqual(imported.argv, ["auth", "import", "--standalone"])
  assert.equal(imported.env.HOME, home, "imported into the sandbox, not the caller's install")
  assert.ok(lstatSync(join(home, ".claude")).isSymbolicLink())
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"))).sort(), ["hasCompletedOnboarding", "oauthAccount", "userID"])
  const run = JSON.parse(readFileSync(join(home, "run.json"), "utf8"))
  assert.equal(run.env.CLAUDE_AGENT_SDK_VERSION, "0.0.1-test")
  assert.equal(run.env.ANTHROPIC_API_KEY, undefined)
  assert.equal(existsSync(claudeProjectDir(f.home, run.cwd)), false, "the run's transcript directory was removed")
  assert.ok(existsSync(join(f.home, ".claude")), "and nothing else of the login")
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
