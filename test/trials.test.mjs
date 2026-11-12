// Trials are kept, graded and aggregated; one trial never ships.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { splitTrial, trialName, strictPass, aggregateVerdict, caseEntry, trialStats } from "../src/grade/trials.mjs"
import { compileCase } from "../src/case/compile.mjs"
import { comparable } from "../src/policy/comparable.mjs"
import { decide } from "../src/policy/decide.mjs"

const BIN = join(import.meta.dirname, "..", "bin", "evals")

test("a trial suffix is parsed, and a name without one is a single legacy trial", () => {
  assert.deepEqual(splitTrial("pagination-decision.t3"), { case: "pagination-decision", trial: 3, suffix: ".t3" })
  assert.deepEqual(splitTrial("pagination-decision"), { case: "pagination-decision", trial: null, suffix: "" })
  assert.equal(trialName("c", 2), "c.t2")
  assert.equal(trialName("c", null), "c")
})

const run = (verdict, items, extra = {}) => ({ case: "c", verdict, items, failed: items.filter((i) => i.state === "fail").map((i) => i.id), ...extra })

test("strict pass needs every blocker and major; PASS only needs the blockers", () => {
  const majorFailed = run("PASS", [{ id: "A", severity: "blocker", state: "pass" }, { id: "B", severity: "major", state: "fail" }, { id: "C", severity: "minor", state: "fail" }])
  const clean = run("PASS", [{ id: "A", severity: "blocker", state: "pass" }, { id: "B", severity: "major", state: "na" }, { id: "C", severity: "minor", state: "fail" }])
  const blockedMajor = run("BLOCKED", [{ id: "B", severity: "major", state: "blocked" }])
  assert.equal(strictPass(majorFailed), false)
  assert.equal(strictPass(clean), true, "a failed minor is a note")
  assert.equal(strictPass(blockedMajor), false, "an unsettled major is not a pass")
})

test("a case passes over its trials only when every trial passes (pass^k)", () => {
  assert.equal(aggregateVerdict(["PASS", "PASS", "PASS"]), "PASS")
  assert.equal(aggregateVerdict(["PASS", "FAIL", "PASS"]), "FAIL")
  assert.equal(aggregateVerdict(["PASS", "BLOCKED"]), "BLOCKED")
  const pass = run("PASS", [{ id: "A", severity: "blocker", state: "pass" }], { trial: 1 })
  const fail = run("FAIL", [{ id: "A", severity: "blocker", state: "fail" }], { trial: 2, failed_blockers: ["A"] })
  const entry = caseEntry([pass, fail])
  assert.equal(entry.verdict, "FAIL")
  assert.equal(entry.trials, 2)
  assert.deepEqual(entry.verdicts, ["PASS", "FAIL"])
  assert.deepEqual(entry.failed_blockers, ["A"])
  const stats = trialStats([pass, fail, { ...pass, case: "d" }, { ...pass, case: "d", trial: 2 }])
  assert.deepEqual(stats.trials, { min: 2, max: 2, runs: 4 })
  assert.equal(stats.strict.rate, 0.75)
  assert.equal(stats.pass_k.strict, 0.5)
})

const CASE = `# c
- Plugin: demo
- Skill under test: demo
- Tier: T3
- Source: test
- Decision tested: the answer names the number

## Prompt
how many?

## Items
- [D-OC01] blocker · It says eight.
  evidence: text:any matches /\\beight\\b/
`

test("three trials in one iteration: three recordings, three traces, three verdicts, one aggregated case", () => {
  const root = mkdtempSync(join(tmpdir(), "evals-trials-"))
  const store = join(root, "store")
  const cases = join(root, "cases")
  mkdirSync(cases, { recursive: true })
  writeFileSync(join(cases, "c.md"), CASE)
  writeFileSync(join(cases, "c.json"), JSON.stringify(compileCase("cases/demo/c.md", CASE)))
  const raw = join(store, "raw", "it", "demo")
  mkdirSync(raw, { recursive: true })
  for (const [trial, text] of [[1, "eight"], [2, "seven"], [3, "eight"]]) {
    writeFileSync(join(raw, `c.t${trial}.jsonl`), `${JSON.stringify({ type: "text", timestamp: 1000 + trial, part: { text } })}\n`)
    writeFileSync(join(raw, `c.t${trial}.summary.json`), JSON.stringify({ exit: 0, trial, model: "mock/m1", runner: "evals run" }))
  }
  const env = { PATH: process.env.PATH, EVALS_STORE: store, EVALS_MODELS_CATALOG: join(store, "absent.json") }
  const traced = spawnSync(process.execPath, [BIN, "trace", "--iteration", "it", "--plugin", "demo"], { encoding: "utf8", env })
  assert.equal(traced.status, 0, traced.stderr)
  assert.deepEqual(readdirSync(join(store, "traces", "it", "demo")).sort(), ["c.t1.trace.jsonl", "c.t2.trace.jsonl", "c.t3.trace.jsonl"])
  const head = JSON.parse(readFileSync(join(store, "traces", "it", "demo", "c.t2.trace.jsonl"), "utf8").split("\n")[0])
  assert.equal(head.case, "c")
  assert.equal(head.trial, 2)
  assert.equal(head.run_id, "it/c#t2")
  const graded = spawnSync(process.execPath, [BIN, "grade", "--iteration", "it", "--plugin", "demo", "--cases", cases], { encoding: "utf8", env })
  assert.equal(graded.status, 0, graded.stderr)
  const verdicts = JSON.parse(readFileSync(join(store, "results", "it", "verdicts.json"), "utf8"))
  assert.deepEqual(verdicts.map((v) => [v.trial, v.verdict]), [[1, "PASS"], [2, "FAIL"], [3, "PASS"]])
  const batch = JSON.parse(readFileSync(join(store, "results", "it", "batch.json"), "utf8"))
  assert.deepEqual(batch.trials, { min: 3, max: 3, runs: 3 })
  assert.equal(batch.coverage.cases_run, 1)
  assert.equal(batch.cases[0].verdict, "FAIL", "one failing trial fails the case")
  assert.deepEqual(batch.cases[0].verdicts, ["PASS", "FAIL", "PASS"])
  rmSync(root, { recursive: true, force: true })
})

const axis = (v) => ({ sha256: v, source: "recorded" })
const batch = (over = {}) => ({
  coverage: { cases_declared: 2, cases_run: 2, items_executed: 4, items_testable: 4, items_passed: 4, items_blocked: 0 },
  cases: [{ case: "a", verdict: "PASS" }, { case: "b", verdict: "PASS" }],
  cost: { amount_usd: null, source: "missing" },
  provenance: { skills: axis("s1"), descriptions: axis("d"), namespace: axis("n"), tools: axis("t"), rules: axis("r"), cases: axis("c"), model: { value: "m", source: "declared" }, opencode: { value: "2.2.6", source: "recorded" } },
  ...over,
})

test("one trial per case never ships; two or more can", () => {
  const a = batch({ cases: [{ case: "a", verdict: "FAIL", failed_majors: ["X"] }, { case: "b", verdict: "PASS" }] })
  const one = batch({ provenance: { ...batch().provenance, skills: axis("s2") } })
  const single = decide({ comparison: comparable(a, one, "skill"), a, b: one })
  assert.equal(single.verdict, "ask")
  assert.match(single.reasons.join(" "), /1 trial\(s\) per case/)
  const three = { ...one, trials: { min: 3, max: 3, runs: 6 } }
  const multi = decide({ comparison: comparable({ ...a, trials: { min: 3, max: 3, runs: 6 } }, three, "skill"), a: { ...a, trials: { min: 3, max: 3, runs: 6 } }, b: three })
  assert.equal(multi.verdict, "ship")
  assert.equal(multi.numeric.trials, 3)
})
