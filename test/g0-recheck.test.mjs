// The G0 re-check's eight remaining changes (PR #8 at 5001f74), each with a test that fails if it regresses.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { compileCase } from "../src/case/compile.mjs"
import { dataOf, dataMinimum, seedPlugins, DATA_MINIMUM } from "../src/case/schema.mjs"
import { gateCases, seedRefusal, seedFiles } from "../src/run/gate.mjs"
import { runBatch } from "../src/run/runner.mjs"
import { writeHalt, readHalt } from "../src/run/halt.mjs"
import { ensureServicePort, serviceRunning } from "../src/run/service-port.mjs"
import { toolNameProblems } from "../src/case/toolnames.mjs"
import { selectingTrials, compare, summarizeArm } from "../src/report/arms.mjs"
import { resolveAliases } from "../src/p0/probes.mjs"
import { flatten } from "../src/grade/targets.mjs"
import { assertLaunchWithinRound, RoundCapError } from "../src/cost/budget.mjs"
import { installFakeOpencode, installFakeBun } from "./helpers/fake-opencode.mjs"

const scratch = () => mkdtempSync(join(tmpdir(), "evals-g0r-"))
const caseText = (plugin, header, id = "tools-x") => `# ${id}\n- Plugin: ${plugin}\n- Skill under test: ${plugin}\n- Tier: T3\n- Source: t\n- Decision tested: x\n${header}\n## Prompt\np\n\n## Items\n- [XX-OC01] major · It answers the question.\n  evidence: text:any matches /./\n`

// ---------------------------------------------------------------------------------------------- 1: Data: from the plugins a case uses

test("1: the Data: minimum is derived from the case's plugin and every plugin its Seed: plugins= names, the highest wins", () => {
  for (const plugin of ["granola", "wisprflow", "plaud", "affinity"]) assert.equal(DATA_MINIMUM[plugin], "real", plugin)
  for (const plugin of ["metaview", "ashby"]) assert.equal(DATA_MINIMUM[plugin], "candidate", plugin)
  // a granola case that says synthetic: refused (granola reads real meetings)
  assert.throws(() => compileCase("cases/granola/tools-x.md", caseText("granola", "- Set: wide\n- Data: synthetic")), /a case that uses granola reads real data \(other people's words\), not synthetic/)
  assert.equal(compileCase("cases/granola/tools-x.md", caseText("granola", "- Set: wide\n- Data: real")).data, "real")
  // a slack deep case that seeds metaview and says own: refused, and the plugin that set the minimum is named
  assert.throws(() => compileCase("cases/slack/deep-x.md", caseText("slack", "- Set: deep\n- Data: own\n- Seed: plugins=metaview,slack", "deep-x")), /a case that uses metaview \(Seed: plugins=\) reads candidate data \(HR records\), not own: declare `- Data: candidate`/)
  assert.equal(compileCase("cases/slack/deep-x.md", caseText("slack", "- Set: deep\n- Data: candidate\n- Seed: plugins=metaview,slack", "deep-x")).data, "candidate")
  // the highest over several plugins
  assert.deepEqual(dataMinimum({ plugin: "slack", seed: "plugins=granola, ashby files=x" }), { kind: "candidate", plugin: "ashby" })
  assert.deepEqual(dataMinimum({ plugin: "slack", seed: "plugins=granola,plaud" }), { kind: "real", plugin: "granola" })
  assert.equal(dataMinimum({ plugin: "slack", seed: "plugins=linear,notion" }), null, "sandbox-readable plugins have none")
  assert.deepEqual(seedPlugins("cwd=api plugins=a, b files=jobs time=day"), ["a", "b"])
  assert.deepEqual(seedPlugins("plugins=a,b"), ["a", "b"])
  assert.deepEqual(seedPlugins(null), [])
  assert.deepEqual(seedPlugins("cwd=api"), [])
})

test("1: the gate reads the derived data, not the label: an `own` case that seeds metaview is candidate data, and the scripted model reads nothing", () => {
  const sneaky = { id: "deep-sneaky", plugin: "slack", data: "own", seed: "plugins=metaview,slack", sets: ["deep"], prompt: "p", items: [] }
  assert.equal(dataOf(sneaky), "candidate")
  assert.equal(gateCases([sneaky], { model: "opencode/deepseek-v4.1-flash" }).runnable.length, 0)
  assert.equal(gateCases([sneaky], { model: "claude-agent/haiku" }).runnable.length, 0, "no matrix, no model")
  assert.equal(gateCases([sneaky], { model: "claude-agent/sonnet", matrix: { candidate: ["claude-agent/sonnet"] } }).runnable.length, 1)
  assert.equal(gateCases([sneaky], { model: "mock/m1" }).runnable.length, 1, "the scripted model reads nothing a case holds")
  assert.equal(gateCases([{ ...sneaky, seed: "plugins=linear" }], { model: "opencode/deepseek-v4.1-flash" }).runnable.length, 1, "an own case that uses sandbox plugins is not third-party data")
})

// ---------------------------------------------------------------------------------------------- 2: seed paths at any depth

test("2: a seed's paths are checked at any depth: a nested opencode.json, instruction file or .claude/.agents/.opencode directory is refused", () => {
  for (const bad of ["api/opencode.json", "a/b/opencode.jsonc", "sub/AGENTS.md", "a/b/CLAUDE.md", "sub/.claude/x", "api/.agents/skill/SKILL.md", "api/.opencode/plugins/x.ts", "a/.opencode/opencode.json", "api/.opencode/jobs/run.sh"]) assert.ok(seedRefusal(bad), bad)
  for (const good of [".opencode/jobs/nightly.md", "api/.opencode/jobs/nightly.json", "api/src/app.ts", "docs/opencode.md"]) assert.equal(seedRefusal(good), null, good)
  const root = scratch()
  try {
    mkdirSync(join(root, "fixtures", "seeds", "nested", "api"), { recursive: true })
    writeFileSync(join(root, "fixtures", "seeds", "nested", "api", "opencode.json"), "{}")
    assert.throws(() => seedFiles("files=nested cwd=api", join(root, "p"), { root }), /api\/opencode\.json is host configuration/)
    assert.equal(existsSync(join(root, "p")), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------------- 3: the mid-batch HALT re-read

test("3: a batch whose store gains a HALT mid-batch (another batch of the wave halted it) stops at its next launch", async () => {
  const root = scratch()
  try {
    const casesDir = join(root, "cases")
    mkdirSync(casesDir)
    for (const id of ["demo-1", "demo-2", "demo-3", "demo-4"]) {
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
    const store = join(root, "store")
    const caller = { PATH: process.env.PATH, HOME: home, EVALS_STORE: store, EVALS_OPENCODE_BIN: installFakeOpencode(bin), EVALS_BUN: installFakeBun(bin), EVALS_TMP: tmp }
    // Another batch halts the wave after this one's first run: the marker appears while this batch is running.
    const log = (line) => {
      if (/\[1\/4\]/.test(line)) writeHalt(store, { reason: "linear_save_issue completed outside commit mode", batch: "other-batch", trial: "tools-y.t1" })
    }
    const result = await runBatch({ isolation: "none", unsafeNoIsolation: true, plugin: "demo", iteration: "mid", model: "mock/m1", auth: "none", scripted: true, arm, casesDir, parallel: 1 }, { caller, log })
    assert.equal(result.launched, 1, "the other three never launched")
    assert.match(result.stopped, /the wave is halted: linear_save_issue completed outside commit mode \(batch other-batch/)
    assert.equal(readHalt(store).batch, "other-batch")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------------- 4: a URL status is a running service

test("4: `opencode service status` printing the service's URL is running, so a second call keeps the port and sets nothing", () => {
  const ports = { "/real": 49374 }
  const calls = []
  const exec = (command, args, { env }) => {
    calls.push(`${env.HOME} ${args.join(" ")}`)
    if (args[1] === "get") return { code: 0, stdout: ports[env.HOME] ? `${ports[env.HOME]}\n` : "", stderr: "" }
    if (args[1] === "set") {
      ports[env.HOME] = Number(args[3])
      return { code: 0, stdout: "", stderr: "" }
    }
    // the profile's own service is up after its first command, and says only its URL
    if (args[1] === "status") return { code: 0, stdout: env.HOME === "/evals" && ports["/evals"] ? `http://127.0.0.1:${ports["/evals"]}\n` : "stopped\n", stderr: "" }
    return { code: 1, stdout: "", stderr: "" }
  }
  const mine = { HOME: "/evals" }
  const real = { HOME: "/real" }
  let busy = new Set()
  const isFree = (p) => !busy.has(p)
  const first = ensureServicePort({ opencode: "oc", profileEnv: mine, realEnv: real, exec, isFree, env: {} })
  assert.deepEqual([first.port, first.changed], [47950, true])
  busy = new Set([47950]) // its own service now holds the port
  for (let i = 0; i < 4; i++) {
    const again = ensureServicePort({ opencode: "oc", profileEnv: mine, realEnv: real, exec, isFree, env: {} })
    assert.deepEqual([again.port, again.changed], [47950, false], `call ${i + 2}`)
  }
  assert.equal(calls.filter((c) => /service set/.test(c)).length, 1, "the port was set once, not on every call")
  assert.equal(serviceRunning({ opencode: "oc", env: mine, port: 47950, exec }), true)
  assert.equal(serviceRunning({ opencode: "oc", env: mine, port: 47951, exec }), false, "a URL on another port is a stranger")
  assert.equal(serviceRunning({ opencode: "oc", env: { HOME: "/x" }, port: 47950, exec }), false, "stopped")
  assert.equal(serviceRunning({ opencode: "oc", env: mine, exec: () => ({ code: 0, stdout: "http://localhost:47950", stderr: "" }) }), true)
  assert.equal(serviceRunning({ opencode: "oc", env: mine, exec: () => ({ code: 0, stdout: "service running", stderr: "" }) }), true, "an older version's words")
})

// ---------------------------------------------------------------------------------------------- 5: argument paths in wide blockers

test("5: a blocker in a wide case that rests on an argument path no signature declares is refused; a major item, or a declared argument, is fine", () => {
  const packs = [{ id: "slack", version: "0.0.6", pluginId: "slack.workspace", tools: [{ name: "slack_send_message", permission: "slack_slack_send_message", class: "write", args: ["channel_id", "text"] }, { name: "slack_search_users", permission: "slack_slack_search_users", class: "read" }] }]
  const problems = (severity, evidence, set = "wide") => {
    const text = `# ${set === "wide" ? "tools-x" : "route-x"}\n- Plugin: slack\n- Skill under test: slack\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: seeded\n- Set: ${set}\n\n## Prompt\np\n\n## Items\n- [SLK-PR01] ${severity} · Aimed at the sandbox the user named.\n  evidence: ${evidence}\n`
    return toolNameProblems(compileCase("cases/slack/x.md", text), packs)
  }
  assert.match(problems("blocker", "target:slack_send_message#1 args.chnl in @slack.sandbox_channel")[0], /rests on the argument `chnl` of slack_send_message, which no signature in the pack declares/)
  assert.match(problems("blocker", "call:slack_search_users#1 args.query == x")[0], /argument `query` of slack_search_users/)
  assert.deepEqual(problems("blocker", "target:slack_send_message#1 args.channel_id in @slack.sandbox_channel"), [], "declared in the pack")
  assert.deepEqual(problems("major", "target:slack_send_message#1 args.chnl in @slack.sandbox_channel"), [], "a major item fails or is unverifiable at grade time, the safe direction")
  assert.deepEqual(problems("blocker", "target:slack_send_message#1 args.chnl in @slack.sandbox_channel", "route"), [], "only wide cases")
})

// ---------------------------------------------------------------------------------------------- 6: the selecting trials

const caseBody = (id, set) => `# ${id}\n- Plugin: slack\n- Skill under test: slack\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: seeded\n- Set: ${set}\n\n## Prompt\np\n\n## Items\n- [SLK-TR01] major · It answers.\n  evidence: text:any matches /./\n`
const writeCases = (dir, specs) => {
  mkdirSync(dir, { recursive: true })
  for (const [id, set] of specs) writeFileSync(join(dir, `${id}.json`), JSON.stringify(compileCase(`cases/slack/${id}.md`, caseBody(id, set))))
}
const verdict = (id, trial, pass, model = "m") => ({ case: id, plugin: "slack", trial, model, verdict: pass ? "PASS" : "FAIL", items: [{ id: "SLK-TR01", state: pass ? "pass" : "fail", severity: "major" }], budget: {} })

test("6: selectingTrials takes the first-pass trial of each wide case and model, once, and never a deep case's", () => {
  const wide = new Set(["tools-a", "tools-b", "tools-c"])
  const runs = [
    verdict("tools-a", 1, false), verdict("tools-a", 2, false), verdict("tools-a", 3, true), // first fails: recorded once, not the later failure
    verdict("tools-b", 1, true), verdict("tools-b", 2, false), // first passes: not selected, a later failure is a fresh draw
    verdict("tools-c", 2, false), verdict("tools-c", 1, false, "ds"), verdict("tools-c", 3, false, "ds"), // per model, lowest trial; order of the file does not matter
    verdict("deep-x", 1, false), verdict("deep-x", 2, false), // a deep case is never selected
    { case: "tools-d", trial: 1, verdict: "NOT_RUN" },
  ]
  wide.add("tools-d")
  assert.deepEqual(selectingTrials(runs, wide), ["tools-a#m#1", "tools-c#ds#1", "tools-c#m#2"])
  assert.deepEqual(selectingTrials(runs, new Set()), [])
  assert.throws(() => selectingTrials(runs), /needs the set of wide case ids/)
})

test("6: evals select records the wide cases' first-pass trials once and refuses to overwrite; evals report applies the list to wide cases only", () => {
  const root = scratch()
  try {
    const store = join(root, "store")
    const casesDir = join(root, "cases")
    writeCases(casesDir, [["tools-w-one", "wide"], ["tools-w-two", "wide"], ["deep-d-one", "deep"]])
    mkdirSync(join(store, "results", "base1"), { recursive: true })
    const runs = [verdict("tools-w-one", 1, false), verdict("tools-w-one", 2, true), verdict("tools-w-one", 3, true), verdict("tools-w-two", 1, true), verdict("tools-w-two", 2, true), verdict("tools-w-two", 3, true), verdict("deep-d-one", 1, false), verdict("deep-d-one", 2, true), verdict("deep-d-one", 3, true)]
    writeFileSync(join(store, "results", "base1", "verdicts.json"), JSON.stringify(runs))
    const evals = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, "..", "bin", "evals"), ...args], { encoding: "utf8", env: { PATH: process.env.PATH, EVALS_STORE: store, HOME: root } })
    const out = evals("select", "base1", "--cases-dir", casesDir)
    assert.equal(out.status, 0, out.stderr)
    assert.match(out.stdout, /base1: 1 selecting trial\(s\) written to results\/base1\/selecting\.json/)
    const file = join(store, "results", "base1", "selecting.json")
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), ["tools-w-one#m#1"], "the deep case's failed first trial is not recorded")
    // recorded once: a second select, even after more trials, is refused and leaves the list as it was
    const again = evals("select", "base1", "--cases-dir", casesDir)
    assert.notEqual(again.status, 0)
    assert.match(again.stderr, /already has results\/base1\/selecting\.json: it is recorded once/)
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), ["tools-w-one#m#1"])
    assert.match(evals("select", "nope", "--cases-dir", casesDir).stderr, /not graded: nope/)
    // the report: the baseline is judged on the trials that did not select. The wide case's failed first trial is out (so the baseline is 5 of 5 on wide), and
    // the deep case keeps its failed first trial.
    mkdirSync(join(store, "results", "n1"), { recursive: true })
    writeFileSync(join(store, "results", "n1", "verdicts.json"), JSON.stringify(runs.map((r) => ({ ...r, verdict: "PASS", items: [{ id: "SLK-TR01", state: "pass", severity: "major" }] }))))
    const report = (...extra) => {
      const r = evals("report", "base=base1", "next=n1", "--plugin", "slack", "--cases-dir", casesDir, "--set", "wide,deep", "--json", "--resamples", "50", ...extra)
      assert.equal(r.status, 0, r.stderr)
      return JSON.parse(r.stdout).comparisons[0].cluster
    }
    const auto = report()
    const all = report("--no-fresh")
    assert.equal(auto.fresh, true, "evals report reads the baseline's selecting.json by itself")
    assert.equal(all.fresh, false)
    // next passes everything. Over every trial the baseline is 7 of 9; with the wide case's failed first trial out it is 7 of 8 (the deep case's failure stays),
    // so the improvement shrinks: the baseline is not inflated by the wide trials taken out and the deep ones left in.
    assert.ok(auto.estimate < all.estimate, `the automatic read removes the selecting trial: ${auto.estimate} against ${all.estimate}`)
    // a list that names a deep case's trial (made by hand, or by an older evals select) does not remove it either
    const hand = join(root, "hand.json")
    writeFileSync(hand, JSON.stringify(["tools-w-one#m#1", "deep-d-one#m#1"]))
    assert.equal(report("--selecting", hand).estimate, auto.estimate, "an entry for a deep case is ignored")
    // with only the deep case's entry nothing is removed at all
    const deepOnly = join(root, "deep.json")
    writeFileSync(deepOnly, JSON.stringify(["deep-d-one#m#1"]))
    assert.equal(report("--selecting", deepOnly).estimate, all.estimate, "a deep case's trial is never taken out")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("6: evals policy says that only evals report decides the statistical claim", () => {
  assert.match(readFileSync(join(import.meta.dirname, "..", "src", "cli.mjs"), "utf8"), /It computes no interval: the statistical claim .* is `evals report`'s/)
  assert.match(readFileSync(join(import.meta.dirname, "..", "docs", "running.md"), "utf8"), /`evals report` decides/)
})

// ---------------------------------------------------------------------------------------------- 7: live-writes.json holds aliases

test("7: @aliases in a live probe's code are resolved from targets.json; an unknown one is named, an email is left alone", () => {
  const targets = flatten({ slack: { sandbox_channel: "C0SANDBOX" }, gws: { self: "me@example.org", note: "it's" } })
  const code = "return await tools.slack.slack_send_message({ channel_id: '@slack.sandbox_channel', text: 'x' })"
  assert.deepEqual(resolveAliases(code, targets), { code: "return await tools.slack.slack_send_message({ channel_id: 'C0SANDBOX', text: 'x' })", missing: [] })
  const two = resolveAliases("a('@gws.self', '@gws.note', '@slack.nowhere', 'user@example.com')", targets)
  assert.deepEqual(two.missing, ["@slack.nowhere"])
  assert.match(two.code, /'me@example\.org', 'it\\'s', '@slack\.nowhere', 'user@example\.com'/, "values are escaped for a JS string; an email is not an alias")
  assert.deepEqual(resolveAliases("no aliases", targets), { code: "no aliases", missing: [] })
  assert.deepEqual(resolveAliases("'@a.b'", null).missing, ["@a.b"], "no targets file: unresolved")
})

// ---------------------------------------------------------------------------------------------- 8: the defence-in-depth checks

test("8: dataOf never answers below a plugin's minimum, and defaults to real; assertLaunchWithinRound refuses on its own, past the runner's check", () => {
  assert.equal(dataOf({ plugin: "slack", data: undefined }), "real", "no label, no legacy corpus: real")
  assert.equal(dataOf({ plugin: "x" }), "real")
  assert.equal(dataOf({ plugin: "history" }), "own")
  assert.equal(dataOf({ plugin: "charts" }), "synthetic")
  assert.equal(dataOf({ plugin: "granola", data: "synthetic" }), "real")
  assert.equal(dataOf({ plugin: "slack", data: "seeded", seed: "plugins=ashby" }), "candidate")
  assert.equal(dataOf({ plugin: "slack", data: "candidate" }), "candidate")
  // with an estimate available the only thing that can refuse is the function's own "no ceiling" check
  const store = scratch()
  try {
    const env = { EVALS_ASSUMED_RUN_USD: "0.1" }
    assert.throws(() => assertLaunchWithinRound(store, { model: "claude-agent/haiku", tier: "wide" }, env), (e) => e instanceof RoundCapError && /no round ceiling or cap is set: cannot hold claude-agent\/haiku to anything/.test(e.message))
    assert.throws(() => assertLaunchWithinRound(store, { model: "openrouter/x", tier: "deep" }, env), /no round ceiling or cap is set/)
    assert.equal(assertLaunchWithinRound(store, { model: "mock/m1", tier: "wide" }, env).metered, false)
    assert.equal(assertLaunchWithinRound(store, { model: "claude-agent/haiku", tier: "wide" }, { ...env, EVALS_ROUND_CEILING_USD: "10" }).enforced, true)
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})
