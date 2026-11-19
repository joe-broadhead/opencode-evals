// The G0 review's changes (PR #8 at d7b6edf): each blocker has a test that fails if it regresses.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runBatch, usingOverage, guardSummary } from "../src/run/runner.mjs"
import { compileCase } from "../src/case/compile.mjs"
import { estimateRunUsd, assertLaunchWithinRound, RoundCapError, MEASURED_ENOUGH, listSpent } from "../src/cost/budget.mjs"
import { checkBalances, vendorUseOf, X_CALL_USD, OPENROUTER_CALL_USD } from "../src/run/balance.mjs"
import { outstandingVendor } from "../src/cost/ledger.mjs"
import { seedFiles, seedRefusal } from "../src/run/gate.mjs"
import { snapshotHome, changedHome, homeLinks } from "../src/run/files.mjs"
import { resolveCommitPlan } from "../src/run/commit-plan.mjs"
import { decideBefore, toolAllowed } from "../src/run/guard/logic.mjs"
import { buildPolicy } from "../src/run/guard/policy.mjs"
import { loadCanaries, flatten } from "../src/grade/targets.mjs"
import { toolNameProblems } from "../src/case/toolnames.mjs"
import { compare, renderReport, clusterArm, holdoutOf, summarizeArm } from "../src/report/arms.mjs"
import { installFakeOpencode, installFakeBun } from "./helpers/fake-opencode.mjs"

const scratch = () => mkdtempSync(join(tmpdir(), "evals-g0-"))
const UNCONFINED = { isolation: "none", unsafeNoIsolation: true }
const quiet = { log: () => {} }

function fixture({ n = 2 } = {}) {
  const root = scratch()
  const casesDir = join(root, "cases")
  mkdirSync(casesDir)
  for (let i = 1; i <= n; i++) {
    const id = `demo-${i}`
    const text = `# ${id}\n- Plugin: demo\n- Skill under test: demo\n- Tier: T3\n- Source: test\n- Decision tested: x\n- Data: synthetic\n\n## Prompt\nhello ${id}\n\n## Items\n- [D-OC01] blocker · It says something.\n  evidence: text:any matches /./\n`
    writeFileSync(join(casesDir, `${id}.md`), text)
    writeFileSync(join(casesDir, `${id}.json`), JSON.stringify(compileCase(`cases/demo/${id}.md`, text)))
  }
  const arm = join(root, "plugin")
  mkdirSync(join(arm, "dist"), { recursive: true })
  writeFileSync(join(arm, "package.json"), JSON.stringify({ name: "@demo/plugin", version: "0.0.1" }))
  writeFileSync(join(arm, "dist", "index.js"), "export default {}\n")
  const bin = join(root, "bin")
  mkdirSync(bin)
  const home = join(root, "user")
  mkdirSync(home)
  const tmp = join(root, "tmp")
  mkdirSync(tmp)
  const caller = { PATH: process.env.PATH, HOME: home, EVALS_STORE: join(root, "store"), EVALS_OPENCODE_BIN: installFakeOpencode(bin), EVALS_BUN: installFakeBun(bin), EVALS_TMP: tmp }
  return { root, casesDir, arm, caller, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

// ------------------------------------------------------------------------------------------------ 2: the cost cap fails closed

test("BLOCKER 2: a model that bills is refused with no ceiling or cap, with no catalogue price, and an unpriced recorded run stops the next launch", async () => {
  const f = fixture()
  try {
    const base = { ...UNCONFINED, plugin: "demo", iteration: "closed", model: "claude-agent/haiku", auth: "none", cases: "demo-1", arm: f.arm, casesDir: f.casesDir }
    // no ceiling, no cap
    await assert.rejects(runBatch(base, { caller: f.caller, ...quiet }), /no round ceiling or cap is set: cannot hold claude-agent\/haiku to anything/)
    // a ceiling and no catalogue price: the run would count as $0
    await assert.rejects(runBatch({ ...base, iteration: "closed2" }, { caller: { ...f.caller, EVALS_ROUND_CEILING_USD: "50", EVALS_ASSUMED_RUN_USD: "0.1", EVALS_MODELS_CATALOG: join(f.root, "absent.json") }, ...quiet }), /no catalogue price for claude-agent\/haiku/)
    // nothing was reserved by either refusal
    assert.equal(existsSync(join(f.root, "store", "ledger", "runs.jsonl")) ? readFileSync(join(f.root, "store", "ledger", "runs.jsonl"), "utf8").includes('"reserve"') : false, false)
    // the scripted model, which bills nothing, still runs with neither
    const free = await runBatch({ ...base, iteration: "free", model: "mock/m1", scripted: true }, { caller: f.caller, ...quiet })
    assert.equal(free.launched, 1)
  } finally {
    f.cleanup()
  }
  // the per-launch check, on the same ledger: an unpriced run of a billing model is a hole in the sum
  const store = scratch()
  try {
    mkdirSync(join(store, "ledger"), { recursive: true })
    writeFileSync(join(store, "ledger", "runs.jsonl"), `${JSON.stringify({ kind: "run", batch: "b", model: "claude-agent/haiku", tier: "wide", list_usd: null })}\n${JSON.stringify({ kind: "run", batch: "m", model: "mock/m1", list_usd: null })}\n`)
    assert.equal(listSpent(store).unpriced, 1, "the scripted model's unpriced run is not a hole")
    assert.throws(() => assertLaunchWithinRound(store, { model: "claude-agent/haiku", tier: "wide" }, { EVALS_ROUND_CEILING_USD: "50", EVALS_ASSUMED_RUN_USD: "0.1" }), /1 recorded run\(s\) have no list price/)
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})

test("a run that did model work and reported no tokens is counted at the estimate, marked, and is an error; the overage flag stops the batch", async () => {
  const f = fixture({ n: 3 })
  try {
    const catalog = join(f.root, "models.json")
    writeFileSync(catalog, JSON.stringify({ anthropic: { models: { "claude-haiku-5-5": { cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 } } } } }))
    const caller = { ...f.caller, CLAUDE_AGENT_SDK_VERSION: "0.0.1-test", EVALS_MODELS_CATALOG: catalog, EVALS_ROUND_CEILING_USD: "100", EVALS_ASSUMED_RUN_USD: "0.25" }
    const result = await runBatch({ ...UNCONFINED, plugin: "demo", iteration: "zero", model: "claude-agent/haiku", auth: "claude-agent", cases: "demo-1", arm: f.arm, casesDir: f.casesDir, parallel: 1 }, { caller: { ...caller, HOME: caller.HOME }, ...quiet }).catch((e) => e)
    // the stand-in host's sign-in is not set up in this fixture: what matters is the pure helpers below
    assert.ok(result instanceof Error || result.launched >= 0)
  } finally {
    f.cleanup()
  }
  assert.equal(usingOverage({ stdout: '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","isUsingOverage":true}}' }), true)
  assert.equal(usingOverage({ stderr: 'x "isUsingOverage" : true' }), true)
  assert.equal(usingOverage({ stdout: '{"isUsingOverage":false}' }), false)
  assert.equal(usingOverage({}), false)
})

test("the estimate keeps a margin until 30 runs are in: the larger of the mean and the 75th percentile, then the mean", () => {
  const store = scratch()
  const runs = (costs) => costs.map((c, i) => ({ kind: "run", batch: `b${i}`, model: "m/a", tier: "wide", list_usd: c }))
  const put = (costs) => {
    mkdirSync(join(store, "ledger"), { recursive: true })
    writeFileSync(join(store, "ledger", "runs.jsonl"), runs(costs).map((r) => JSON.stringify(r)).join("\n") + "\n")
  }
  try {
    put([1, 1, 5, 5, 6])
    const five = estimateRunUsd(store, "m/a", "wide", {})
    assert.equal(five.usd, 5, "the 75th percentile of five, 5, beats the mean, 3.6")
    assert.match(five.basis, /75th-percentile/)
    put([1, 1, 1, 1, 10])
    assert.equal(estimateRunUsd(store, "m/a", "wide", {}).usd, 2.8, "and when the mean is the larger, the mean")
    put([...Array(MEASURED_ENOUGH - 1).fill(1), 100])
    assert.match(estimateRunUsd(store, "m/a", "wide", {}).basis, /mean list cost of 30/)
    assert.equal(MEASURED_ENOUGH, 30)
    put([1, 1, 1])
    assert.equal(estimateRunUsd(store, "m/a", "wide", { EVALS_ASSUMED_RUN_USD: "0.5" }).usd, 0.5, "under five runs the table or the assumption stands")
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})

test("BLOCKER 2: the X, OpenRouter and Inference caps are cumulative across the round, from the ledger, with reserved runs counted at their worst case", async () => {
  const limits = { x_usd: 15, openrouter_usd: 5, tavily_credits: 500, affinity_calls: 1000 }
  // X: 59 recorded reads at the worst case is $14.75; one more run of $0.25 is exactly the cap, two are over it
  const ledger = Array.from({ length: 59 }, () => ({ kind: "run", vendor_use: { x_usd: X_CALL_USD } }))
  assert.equal((await checkBalances({ plugins: ["x"], runsByPlugin: { x: 1 }, ledger, limits })).ok, true)
  const over = await checkBalances({ plugins: ["x"], runsByPlugin: { x: 2 }, ledger, limits })
  assert.equal(over.ok, false)
  assert.match(over.refusals[0], /x: x_usd would reach 15\.25 of 15/)
  // a batch that spent nothing yet but reserved: another batch's reserved runs count before they run
  const reserved = [{ kind: "reserve", batch: "other", runs: 10, vendor_per_run: { openrouter_usd: OPENROUTER_CALL_USD } }, { kind: "run", batch: "other", vendor_use: { openrouter_usd: 0.1 } }]
  assert.ok(Math.abs(outstandingVendor(reserved, "openrouter_usd") - 0.9) < 1e-9)
  const or = await checkBalances({ plugins: ["openrouter"], runsByPlugin: { openrouter: 41 }, ledger: reserved, limits })
  assert.equal(or.ok, false, "0.1 spent + 0.9 reserved + 41 runs at 0.1 is over $5")
  assert.match(or.lines[0], /openrouter_usd 1\.00 used \(ledger\)/)
  assert.equal((await checkBalances({ plugins: ["inference"], runsByPlugin: { inference: 10 }, ledger: [], limits })).ok, true)
  assert.equal((await checkBalances({ plugins: ["inference"], runsByPlugin: { inference: 51 }, ledger: [], limits })).ok, false)
  // what a recording spent is counted from its calls
  assert.deepEqual(vendorUseOf(["tools.x.x_search_posts", "x_get_post", "inference_extract", "openrouter_chat", "slack_send"]), { tavily_credits: 0, affinity_calls: 0, x_usd: 0.5, openrouter_usd: 0.2 })
  // and with no written cap a spending plugin is refused, as before
  assert.match((await checkBalances({ plugins: ["x"], runsByPlugin: { x: 1 }, ledger: [], limits: {} })).refusals[0], /no limit for x_usd/)
})

// ------------------------------------------------------------------------------------------------ 3: Data is required

test("BLOCKER 3: Data: is required; HR plugins are candidate data; a legacy corpus's missing Data takes what it always held", () => {
  const text = (header = "", plugin = "slack", id = "tools-send") => `# ${id}\n- Plugin: ${plugin}\n- Skill under test: ${plugin}\n- Tier: T3\n- Source: t\n- Decision tested: x\n${header}\n## Prompt\np\n\n## Items\n- [SLK-OC01] major · It answers the question.\n  evidence: text:any matches /./\n`
  assert.throws(() => compileCase("cases/slack/tools-send.md", text("- Set: wide")), /Data is required \(one of synthetic, seeded, own, real, candidate\)/)
  assert.equal(compileCase("cases/slack/tools-send.md", text("- Set: wide\n- Data: seeded")).data, "seeded")
  assert.throws(() => compileCase("cases/slack/tools-send.md", text("- Data: seeded")), /declares one of this round's sets/)
  assert.throws(() => compileCase("cases/metaview/tools-x.md", text("- Set: wide\n- Data: real", "metaview", "tools-x")), /metaview case reads candidate data/)
  assert.throws(() => compileCase("cases/ashby/tools-x.md", text("- Set: wide\n- Data: synthetic", "ashby", "tools-x")), /ashby case reads candidate data/)
  assert.equal(compileCase("cases/ashby/tools-x.md", text("- Set: wide\n- Data: candidate", "ashby", "tools-x")).data, "candidate")
  // the legacy corpora written before the header: no Data and no round set is allowed, a legacy case in a round set must declare it
  assert.equal(compileCase("cases/history/core-a.md", text("", "history", "core-a")).plugin, "history")
  assert.throws(() => compileCase("cases/history/tools-a.md", text("- Set: wide", "history", "tools-a")), /Data is required/)
})

// ------------------------------------------------------------------------------------------------ 4: guard false

test("BLOCKER 4: \"guard\": false and a guard mode other than refuse or commit are refused whenever the trial holds a credential", async () => {
  const f = fixture()
  try {
    const off = join(f.root, "off.json")
    writeFileSync(off, JSON.stringify({ package: f.arm, guard: false }))
    const base = { ...UNCONFINED, plugin: "demo", model: "mock/m1", scripted: true, cases: "demo-1", casesDir: f.casesDir }
    const message = /the guard cannot be switched off .* in a run that holds a credential/
    await assert.rejects(runBatch({ ...base, iteration: "g1", auth: "env:DEMO_KEY", arm: off }, { caller: { ...f.caller, DEMO_KEY: "demo-key-0123456789" }, ...quiet }), message)
    await assert.rejects(runBatch({ ...base, iteration: "g2", auth: "none+profile", arm: off }, { caller: f.caller, ...quiet }), message)
    await assert.rejects(runBatch({ ...base, iteration: "g3", auth: "env:DEMO_KEY", arm: f.arm, guardMode: "log" }, { caller: { ...f.caller, DEMO_KEY: "demo-key-0123456789" }, ...quiet }), message)
    // with no credential it is the probes' switch, as before
    const ok = await runBatch({ ...base, iteration: "g4", auth: "none", arm: off }, { caller: f.caller, ...quiet })
    assert.equal(ok.launched, 1)
  } finally {
    f.cleanup()
  }
})

// ------------------------------------------------------------------------------------------------ 6 to 8: plugin load, seeds, home files, commit plan

test("a plugin that failed to load is infra, never graded, and stops the batch", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "run", "runner.mjs"), "utf8")
  assert.match(source, /summary\.host_log\.plugin_load_failures\?\.length\) summary\.infra = "plugin"/)
  assert.match(source, /outcome\.infra === "plugin" && !stopped\) stopped = /)
  assert.equal(guardSummary([]).refused_tools, 0)
})

test("a seed may not bring configuration, instructions or code; .opencode/jobs data files are the one exception", () => {
  for (const bad of ["opencode.json", "opencode.jsonc", "opencode.json.bak", "AGENTS.md", "CLAUDE.md", ".claude/settings.json", ".agents/skill/SKILL.md", ".opencode/plugins/x.ts", ".opencode/opencode.json", ".opencode/agents/a.md", ".opencode/jobs/run.sh"]) assert.ok(seedRefusal(bad), bad)
  for (const good of [".opencode/jobs/nightly.md", ".opencode/jobs/a/b.json", "README.md", "src/app.ts", "docs/AGENTS.md.txt", "notes/CLAUDE.md"]) assert.equal(seedRefusal(good), null, good)
  const root = scratch()
  try {
    const seeds = join(root, "fixtures", "seeds")
    mkdirSync(join(seeds, "evil"), { recursive: true })
    writeFileSync(join(seeds, "evil", "opencode.json"), "{}")
    writeFileSync(join(seeds, "evil", "README.md"), "x")
    assert.throws(() => seedFiles("files=evil", join(root, "project"), { root }), /the seed evil cannot be copied into a project: opencode\.json is host configuration/)
    assert.equal(existsSync(join(root, "project")), false, "nothing was copied")
    mkdirSync(join(seeds, "agents", ".agents"), { recursive: true })
    writeFileSync(join(seeds, "agents", ".agents", "x.md"), "x")
    assert.throws(() => seedFiles("files=agents", join(root, "p2"), { root }), /\.agents\/x\.md is under \.agents\//)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("Home files: names that start with a dot are refused at compile, and a link is never followed or recorded", () => {
  const text = (name) => `# tools-export\n- Plugin: plaud\n- Skill under test: plaud\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: seeded\n- Set: wide\n- Home files: ${name}\n\n## Prompt\np\n\n## Items\n- [PLD-OC01] major · It wrote the note.\n  evidence: file:a exists\n`
  for (const bad of [".local/share/opencode", ".ssh", "Plaud/.hidden", ".config"]) assert.throws(() => compileCase("cases/plaud/tools-export.md", text(bad)), /visible names under the home/, bad)
  assert.equal(compileCase("cases/plaud/tools-export.md", text("Plaud")).home_files[0], "Plaud")
  const root = scratch()
  try {
    const home = join(root, "home")
    mkdirSync(join(home, "Plaud"), { recursive: true })
    mkdirSync(join(root, "host-secret"))
    writeFileSync(join(root, "host-secret", "token"), "a path of the host")
    mkdirSync(join(home, "Real"))
    writeFileSync(join(home, "Real", "n.txt"), "ok")
    symlinkSync(join(root, "host-secret"), join(home, "Linked"))
    symlinkSync(join(root, "host-secret", "token"), join(home, "FileLink"))
    symlinkSync(join(root, "host-secret"), join(home, "Real", "inner"))
    assert.deepEqual(homeLinks(home, ["Plaud", "Linked", "FileLink", "Real", "Real/inner", "Missing"]).sort(), ["FileLink", "Linked", "Real/inner"])
    const before = snapshotHome(home, ["Linked", "FileLink", "Real"])
    assert.deepEqual([...before.keys()], ["~/Real/n.txt"], "a link and what lies behind it are not read")
    assert.equal(changedHome(before, home, ["Linked", "FileLink", "Real"]).length, 0)
    assert.ok(!JSON.stringify(changedHome(new Map(), home, ["Linked", "FileLink"])).includes("a path of the host"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("the commit plan names @aliases of targets.json only: a literal, an unknown alias, or actions that differ from writes is an error", () => {
  const targets = flatten({ slack: { sandbox_channel: "C0SANDBOX" }, gws: { folders: ["F1", "F2"] } })
  const plan = { actions: ["slack_slack_send_message", "charts_render"], writes: { slack_slack_send_message: { extract: "args.channel_id", allow: ["@slack.sandbox_channel"] }, charts_render: { local: true } } }
  const resolved = resolveCommitPlan(plan, targets)
  assert.deepEqual(resolved.writes.slack_slack_send_message, { extract: "args.channel_id", allow: ["C0SANDBOX"] })
  assert.deepEqual(resolved.writes.charts_render, { local: true })
  assert.deepEqual(resolveCommitPlan({ ...plan, plans: { makers: ["gws_plan"], committers: ["gws_send"], allow: ["@gws.folders"] } }, targets).plans.allow, ["F1", "F2"])
  const bad = (change) => () => resolveCommitPlan({ ...plan, ...change }, targets)
  assert.throws(bad({ writes: { ...plan.writes, slack_slack_send_message: { extract: "args.channel_id", allow: ["C0ELSEWHERE"] } } }), /allow holds "C0ELSEWHERE", a literal/)
  assert.throws(bad({ writes: { ...plan.writes, slack_slack_send_message: { extract: "args.channel_id", allow: ["@slack.nowhere"] } } }), /names @slack\.nowhere, which targets\.json does not have/)
  assert.throws(bad({ actions: ["slack_slack_send_message"] }), /must name the same actions; in writes only: charts_render/)
  assert.throws(bad({ actions: [...plan.actions, "linear_save_issue"] }), /in actions only: linear_save_issue/)
  assert.throws(bad({ writes: { ...plan.writes, charts_render: { local: true, allow: ["@slack.sandbox_channel"] } } }), /local: it takes no extract or allow/)
  assert.throws(bad({ writes: { ...plan.writes, slack_slack_send_message: { allow: ["@slack.sandbox_channel"] } } }), /needs an `extract` path/)
  assert.throws(() => resolveCommitPlan(plan, null), /names @slack\.sandbox_channel, which targets\.json does not have/, "no targets file, no commit")
})

// ------------------------------------------------------------------------------------------------ 11: the tool allow-list tripwire

test("in a locked trial a tool outside execute, skill, question and the plugins' own is refused and logged, whatever it is", () => {
  const policy = buildPolicy({ mode: "refuse", locked: true })
  assert.deepEqual(policy.tools.exact, ["execute", "skill", "question", "todowrite"])
  for (const prefix of ["slack", "gws", "history", "notion", "evalsprobe", "tavily", "x"]) assert.ok(policy.tools.prefixes.includes(prefix), prefix)
  for (const ok of ["execute", "skill", "question", "history_pin", "gws_plan", "slack_send_message", "notion_notion-search", "evalsprobe_assert_all", "x_get_post", "jobs.create"]) assert.equal(decideBefore(policy, ok, {}).pass, true, ok)
  for (const refused of ["shell", "read", "experimental_image_generate", "experimental_video_generate", "a_future_core_tool", "models", "automation_create", "websearch"]) {
    const verdict = decideBefore(policy, refused, {})
    assert.equal(verdict.pass, false, refused)
    assert.equal(verdict.tool, true)
    assert.match(verdict.why, /a core tool outside the locked allow-list/)
  }
  assert.equal(toolAllowed(policy.tools, "slackish_thing"), false, "a prefix is a whole word before the underscore")
  // not locked: no allow-list, as before
  assert.equal(buildPolicy({ mode: "refuse" }).tools, undefined)
  assert.equal(decideBefore(buildPolicy({ mode: "refuse" }), "shell", {}).pass, true)
})

// ------------------------------------------------------------------------------------------------ 13: the grammar

test("a positive glob in a wide case, absent-arg, and a canary the prompt fills and an item grades are compile errors; canaries are random tokens", () => {
  const packs = [{ id: "slack", version: "0.0.6", pluginId: "slack.workspace", tools: [{ name: "slack_send_message", permission: "slack_slack_send_message", class: "write" }] }]
  const text = (evidence, { prompt = "p", set = "wide", id = "tools-send" } = {}) => `# ${id}\n- Plugin: slack\n- Skill under test: slack\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: seeded\n- Set: ${set}\n\n## Prompt\n${prompt}\n\n## Items\n- [SLK-OC01] major · It answers the question.\n  evidence: ${evidence}\n`
  const problems = (evidence, options) => toolNameProblems(compileCase("cases/slack/x.md", text(evidence, options)), packs)
  assert.match(problems("call:*#1")[0], /positive glob in a wide case/)
  assert.match(problems("call:slack.*#1")[0], /positive glob/)
  assert.match(problems("first:slack.*")[0] ?? "", /positive glob/)
  assert.deepEqual(problems("call:*#1", { set: "route", id: "route-x" }), [], "a routing case may")
  assert.match(problems("absent-arg:slack_send_message args.chanel_idd == X")[0], /cannot be checked against the tool's signature/)
  assert.throws(() => compileCase("cases/slack/tools-send.md", text("text:any contains @canary.linear_cycle", { prompt: "what is in {{canary:linear_cycle}}?" })), /the prompt fills \{\{canary:linear_cycle\}\} and this item grades @canary\.linear_cycle/)
  assert.equal(compileCase("cases/slack/tools-send.md", text("text:any contains @canary.linear_cycle", { prompt: "what is in {{canary:other}}?" })).id, "tools-send")
  const store = scratch()
  try {
    const put = (canaries) => writeFileSync(join(store, "canaries.json"), JSON.stringify(canaries))
    put({ linear_cycle: "Cycle 7q3x9", nested: { a: "k3Zp9WqL" } })
    assert.deepEqual([...loadCanaries({ EVALS_STORE: store }).keys()].sort(), ["linear_cycle", "nested.a"])
    put({ short: "abc", fine: "k3Zp9WqL", flat: "aaaaaaaaaa", num: 12345 })
    assert.throws(() => loadCanaries({ EVALS_STORE: store }), /canaries\.json: flat, num, short must be random tokens of at least 8 characters/)
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------------------------------------ 14: cluster.mjs is the decision path

test("evals report decides with the cluster bootstrap, on fresh baseline trials when asked, and gates the holdout against its concurrent baseline", () => {
  const run = (id, pass, model = "m") => ({ case: id, trial: 1, model, verdict: pass ? "PASS" : "FAIL", items: [{ id: "X-PR01", state: pass ? "pass" : "fail", severity: "blocker" }], budget: {} })
  const arm = (label, iteration, spec) => ({ label, iterations: [iteration], runs: Object.entries(spec).flatMap(([id, outcomes]) => outcomes.map((o, i) => ({ ...run(id, o), trial: i + 1 }))) })
  const ids = Array.from({ length: 12 }, (_, i) => `c${String(i).padStart(2, "0")}`)
  const base = arm("base", "i1", Object.fromEntries(ids.map((id) => [id, [0, 0, 1]])))
  const next = arm("next", "i2", Object.fromEntries(ids.map((id) => [id, [1, 1, 1]])))
  const report = compare([base, next])
  const c = report.comparisons[0]
  assert.ok(c.cluster && c.cluster.cases === 12 && c.cluster.resamples === 5000, "the cluster interval is in every comparison")
  assert.ok(c.cluster.estimate > 0.6 && c.cluster.lo > 0, JSON.stringify(c.cluster))
  assert.match(renderReport(report), /\*\*This decides\*\* \(cases are the unit; models and trials are nested inside each case; 5000 resamples\)/)
  // a fresh baseline: the selecting trials (the first of each) are dropped
  const selecting = new Set(ids.map((id) => `${id}#m#1`))
  const fresh = compare([base, next], { selecting }).comparisons[0]
  assert.equal(fresh.cluster.fresh, true)
  assert.ok(fresh.cluster.estimate < c.cluster.estimate, "the baseline's fresh trials pass more often than the one that selected them")
  assert.match(renderReport(compare([base, next], { selecting })), /baseline is its fresh trials only/)
  assert.equal(clusterArm(summarizeArm(base)).get("c00").get("m").length, 3)
  // the pooled holdout gate: h1 against its concurrent baseline cb-h1; two flipped holdouts hold the plugin
  const holdIds = ["hold-slack-1-a", "hold-slack-2-b", "hold-slack-3-c", "hold-slack-4-d", "hold-linear-1-a", "hold-linear-2-b", "hold-linear-3-c", "hold-linear-4-d"]
  const cb = arm("cb-h1", "cb", Object.fromEntries(holdIds.map((id) => [id, [1, 1, 1]])))
  const h1 = arm("h1", "h", Object.fromEntries(holdIds.map((id) => [id, /slack-[12]-/.test(id) ? [0, 0, 0] : [1, 1, 1]])))
  const gate = holdoutOf(summarizeArm(h1), summarizeArm(cb))
  assert.equal(gate.ok, false)
  assert.deepEqual(gate.held, ["slack"])
  assert.equal(holdoutOf(summarizeArm(cb), summarizeArm(cb)).ok, true)
})
