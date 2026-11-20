// Holdouts are in no selection but their own, and they need none of this round's sets or id prefixes.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { compileCase } from "../src/case/compile.mjs"
import { selectCases, parseSets, inSets, isHoldout, familyOf, setCounts } from "../src/case/sets.mjs"
import { validateCase } from "../src/case/schema.mjs"

const ROOT = join(import.meta.dirname, "..")
const header = (id, { holdout = false, set = null, data = "seeded" } = {}) =>
  `# ${id}\n- Plugin: slack\n- Skill under test: slack\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: ${data}\n${holdout ? "- Holdout: true\n" : ""}${set ? `- Set: ${set}\n` : ""}\n## Prompt\np\n\n## Items\n- [SLK-OC01] major · It answers.\n  evidence: text:any matches /./\n`
const kase = (id, options) => compileCase(`cases/slack/${id}.md`, header(id, options))

// What the holdout lane wrote (Set: local to get past the id rule), and what it can now write.
const tuners = [
  kase("tools-read-a", { set: "wide" }),
  kase("route-no-1", { set: "route" }),
  kase("deep-plan-1", { set: "deep" }),
  kase("commit-send-1", { set: "commit" }),
  kase("local-only-1", { set: "local" }),
  kase("plain-1", { set: "local, core" }),
]
const holdouts = [
  kase("hold-slack-1-local", { holdout: true, set: "local" }),
  kase("hold-slack-2-wide", { holdout: true, set: "wide" }),
  kase("hold-slack-3-deep", { holdout: true, set: "deep" }),
  kase("hold-slack-4-bare", { holdout: true }),
  kase("hold-slack-5-core", { holdout: true, set: "local, core" }),
]
const all = [...tuners, ...holdouts]
const ids = (cases) => cases.map((c) => c.id)

test("a holdout compiles without a round set and without a round set's id prefix; any other case still needs both", () => {
  for (const c of holdouts) assert.equal(c.holdout, true, c.id)
  assert.deepEqual(holdouts[0].sets, ["local"])
  assert.deepEqual(holdouts[1].sets, ["wide"], "a holdout may name wide although its id is hold-…")
  assert.equal(holdouts[3].sets, undefined, "a holdout needs no Set at all")
  // not a holdout: the rules are as they were
  // a hold- id without the header is still a holdout to every selection (the id alone keeps it out), and needs no round set either
  assert.equal(isHoldout(kase("hold-slack-8-unmarked", { set: "wide" })), true)
  assert.throws(() => kase("plain-wide", { set: "wide" }), /a case in set wide has an id like tools-<slug>/)
  assert.throws(() => kase("plain-none", {}), /declares one of this round's sets/)
  assert.throws(() => kase("hold-slack-9-x", { holdout: true, data: "nonsense" }), /Data must be one of/)
})

test("a hold- id is a holdout even without the header", () => {
  assert.equal(isHoldout({ id: "hold-slack-1-x" }), true)
  assert.equal(isHoldout({ id: "x", holdout: true }), true)
  assert.equal(isHoldout({ id: "tools-hold-x" }), false)
  assert.equal(familyOf({ id: "hold-slack-1-x", sets: ["local"] }), "holdout")
  assert.equal(inSets({ id: "hold-slack-1-x", sets: ["local"] }, ["local", "tune", "tools"]), false)
  assert.equal(inSets({ id: "hold-slack-1-x", sets: ["local"] }, ["holdout"]), true)
})

test("--set local, --set all and every other selection never return a holdout", () => {
  const selections = ["tune", "tools", "all", "local", "wide", "route", "deep", "commit", "hooks", "core", "tune,tools", "all,local", "local,wide,deep", "all,core", "tune,local"]
  for (const set of selections) {
    let selected = []
    try {
      selected = selectCases(all, { set }).selected
    } catch (error) {
      assert.match(error.message, /no case matches|unknown case set/, set)
    }
    assert.deepEqual(selected.filter(isHoldout).map((c) => c.id), [], `--set ${set}`)
    // and a glob that names them does not reach them either
    for (const patterns of ["*", "hold-*", "hold-slack-1-local", "hold-slack-4-bare"]) {
      let got = []
      try {
        got = selectCases(all, { patterns, set }).selected
      } catch (error) {
        assert.match(error.message, /no case matches|unknown case set/)
        if (/unknown case set/.test(error.message)) continue
        if (patterns !== "*") assert.match(error.message, /in holdout, not in --set/, `--set ${set} --cases ${patterns}`)
      }
      assert.deepEqual(got.filter(isHoldout).map((c) => c.id), [], `--set ${set} --cases ${patterns}`)
    }
  }
  assert.deepEqual(ids(selectCases(all, { set: "local" }).selected), ["local-only-1", "plain-1"], "--set local is the local cases, not the holdouts that were given Set: local")
  assert.deepEqual(ids(selectCases(all, { set: "core" }).selected), ["plain-1"], "nor the holdout in a plugin's own set")
  assert.deepEqual(ids(selectCases(all, { set: "all" }).selected), ["tools-read-a"])
  assert.deepEqual(parseSets("all"), ["tune", "tools"])
})

test("naming holdout is the one way to select them, and it returns holdouts only unless other sets are named too", () => {
  assert.deepEqual(ids(selectCases(all, { set: "holdout" }).selected), ids(holdouts).sort())
  assert.deepEqual(ids(selectCases(all, { set: "holdout", patterns: "hold-slack-1-local" }).selected), ["hold-slack-1-local"])
  assert.deepEqual(ids(selectCases(all, { set: "tools,holdout" }).selected), ["hold-slack-1-local", "hold-slack-2-wide", "hold-slack-3-deep", "hold-slack-4-bare", "hold-slack-5-core", "tools-read-a"], "named alongside another set, both")
  assert.deepEqual(ids(selectCases(all, { set: "all,holdout" }).selected), ids(selectCases(all, { set: "tools,holdout" }).selected))
  assert.deepEqual(setCounts(all).holdout, 5, "the counts still say how many there are")
})

test("the CLI: evals report over --set local, the default and --set all never counts a holdout; --set holdout counts them", () => {
  const root = mkdtempSync(join(tmpdir(), "evals-holdout-"))
  try {
    const store = join(root, "store")
    const casesDir = join(root, "cases")
    mkdirSync(casesDir)
    mkdirSync(join(store, "results", "a1"), { recursive: true })
    mkdirSync(join(store, "results", "b1"), { recursive: true })
    for (const c of all) writeFileSync(join(casesDir, `${c.id}.json`), JSON.stringify(c))
    const verdicts = (verdict) => all.flatMap((c) => [1, 2].map((trial) => ({ case: c.id, plugin: "slack", trial, model: "m", verdict, items: [{ id: "SLK-OC01", state: verdict === "PASS" ? "pass" : "fail", severity: "major" }], budget: {} })))
    writeFileSync(join(store, "results", "a1", "verdicts.json"), JSON.stringify(verdicts("FAIL")))
    writeFileSync(join(store, "results", "b1", "verdicts.json"), JSON.stringify(verdicts("PASS")))
    const casesIn = (...extra) => {
      const out = spawnSync(process.execPath, [join(ROOT, "bin", "evals"), "report", "a=a1", "b=b1", "--plugin", "slack", "--cases-dir", casesDir, "--json", "--resamples", "20", ...extra], { encoding: "utf8", env: { PATH: process.env.PATH, EVALS_STORE: store, HOME: root } })
      return out.status === 0 ? JSON.parse(out.stdout).rows.find((r) => r.label === "a").cases : `error: ${out.stderr.split("\n").find((l) => /^Error/.test(l)) ?? out.stderr}`
    }
    assert.equal(casesIn("--set", "local"), 2, "local-only-1 and plain-1, not the three holdouts that were given Set: local")
    assert.equal(casesIn("--set", "all"), 1, "tools-read-a")
    assert.equal(casesIn(), 1, "the default is all")
    assert.equal(casesIn("--set", "holdout"), 5)
    assert.match(casesIn("--set", "local", "--cases", "hold-*"), /no case matches hold-\*; 5 matching case\(s\) are in holdout, not in --set local/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("Holdout: is `true` or `false` and nothing else: True, TRUE, yes and 1 are a compile error, not an ordinary case a tuner could be given", () => {
  for (const spelling of ["True", "TRUE", "yes", "1", "y", "on", " "]) {
    const text = header("hold-slack-9-x", { set: "local" }).replace("- Set: local\n", `- Holdout: ${spelling}\n- Set: local\n`)
    assert.throws(() => compileCase("cases/slack/hold-slack-9-x.md", text), /Holdout: is `true` or `false`, not/, `Holdout: ${spelling}`)
  }
  assert.equal(compileCase("cases/slack/hold-slack-9-x.md", header("hold-slack-9-x", { holdout: true, set: "local" })).holdout, true)
  assert.equal(compileCase("cases/slack/hold-slack-9-x.md", header("hold-slack-9-x", { set: "local" }).replace("- Set: local\n", "- Holdout: false\n- Set: local\n")).holdout, false)
  assert.equal(isHoldout({ id: "hold-slack-9-x", holdout: false }), true, "a hold- id is a holdout whatever the header says")
  // a hand-edited compiled case with the flag as a string is refused when it is read, not returned to a tuner
  const edited = { ...holdouts[0], holdout: "true" }
  assert.throws(() => validateCase(edited, "cases/slack/hold-slack-1-local.json"), /holdout must be true or false, not "true"/)
})
