// A case's Truth: claims, checked against the world's truth file before a run is reserved (HG-14).
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { parseTruth, truthAt, checkTruth } from "../src/case/truth.mjs"
import { compileCase } from "../src/case/compile.mjs"
import { truthCheck } from "../src/run/runner.mjs"
import { dirWorld } from "../src/run/world.mjs"

const TRUTH = { ids: { "stripe-v2": "ses_abc" }, sql: { avgCostByAgent: [{ agent: "build", avg_usd: 1.08 }, { agent: "plan", avg_usd: 0.93 }], sessions7dApi: [{ n: 20 }] }, counts: { list14d: { top: 40 } } }

test("a truth path walks keys, list indices and list elements picked by a field", () => {
  assert.equal(truthAt(TRUTH, "ids.stripe-v2"), "ses_abc")
  assert.equal(truthAt(TRUTH, "sql.avgCostByAgent[agent=build].avg_usd"), 1.08)
  assert.equal(truthAt(TRUTH, "sql.sessions7dApi.0.n"), 20)
  assert.equal(truthAt(TRUTH, "sql.avgCostByAgent[agent=explore].avg_usd"), undefined)
  assert.equal(truthAt(TRUTH, "nothing.here"), undefined)
  assert.deepEqual(parseTruth("counts.list14d.top == 40; ids.stripe-v2 == ses_abc"), [{ path: "counts.list14d.top", value: 40 }, { path: "ids.stripe-v2", value: "ses_abc" }])
  assert.throws(() => parseTruth("counts.list14d.top = 40"), /unreadable truth/)
})

test("checkTruth reports each claim, and a moved number or a missing path is bad", () => {
  const cases = [
    { id: "a", truth: [{ path: "sql.avgCostByAgent[agent=build].avg_usd", value: 1.09 }] },
    { id: "b", truth: [{ path: "counts.list14d.top", value: 40 }, { path: "counts.gone", value: 1 }] },
    { id: "c" },
  ]
  const { rows, bad } = checkTruth(cases, TRUTH)
  assert.equal(rows.length, 3)
  assert.deepEqual(bad.map((r) => [r.case, r.path, r.found]), [["a", "sql.avgCostByAgent[agent=build].avg_usd", 1.08], ["b", "counts.gone", null]])
})

const caseText = (truth) => `# t-case
- Plugin: demo
- Skill under test: s
- Tier: T3
- Source: test
- Decision tested: test
${truth}
## Prompt
p

## Items
- [H-OC01] blocker · It answers with the number.
  evidence: text:any matches /40/
`

test("Truth: compiles into the case, a bad one is a compile error, and a case without it compiles as before", () => {
  assert.deepEqual(compileCase("cases/demo/t-case.md", caseText("- Truth: counts.list14d.top == 40")).truth, [{ path: "counts.list14d.top", value: 40 }])
  assert.equal("truth" in compileCase("cases/demo/t-case.md", caseText("")), false)
  assert.throws(() => compileCase("cases/demo/t-case.md", caseText("- Truth: counts.list14d.top 40")), /unreadable truth/)
})

test("a world that names its truth is checked; a case that claims one in a world without it is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-truth-"))
  writeFileSync(join(dir, "truth.json"), JSON.stringify(TRUTH))
  writeFileSync(join(dir, "world.json"), JSON.stringify({ truth: "truth.json" }))
  const cases = [{ id: "a", truth: [{ path: "sql.avgCostByAgent[agent=build].avg_usd", value: 1.09 }] }, { id: "b", truth: [{ path: "counts.list14d.top", value: 40 }] }]
  assert.equal(truthCheck([{ id: "plain" }], dirWorld(dir)), null, "no claim, no check")
  assert.deepEqual(truthCheck(cases, dirWorld(dir)).bad.map((r) => r.case), ["a"])
  writeFileSync(join(dir, "world.json"), "{}")
  assert.throws(() => truthCheck(cases, dirWorld(dir)), /names no truth file/)
  writeFileSync(join(dir, "world.json"), JSON.stringify({ truth: "absent.json" }))
  assert.throws(() => truthCheck(cases, dirWorld(dir)), /is not there/)
  rmSync(dir, { recursive: true, force: true })
})

test("evals truth prints every claim and fails on a moved one", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-truth-cli-"))
  const world = join(dir, "world")
  const cases = join(dir, "cases")
  mkdirSync(world)
  mkdirSync(cases)
  writeFileSync(join(world, "truth.json"), JSON.stringify(TRUTH))
  writeFileSync(join(world, "world.json"), JSON.stringify({ truth: "truth.json" }))
  const write = (truth) => writeFileSync(join(cases, "t-case.json"), JSON.stringify(compileCase("cases/demo/t-case.md", caseText(truth))))
  const evals = () => spawnSync(process.execPath, [join(import.meta.dirname, "..", "bin", "evals"), "truth", "--plugin", "demo", "--world", world, "--cases-dir", cases], { encoding: "utf8" })
  write("- Truth: counts.list14d.top == 40")
  const good = evals()
  assert.equal(good.status, 0, good.stderr)
  assert.match(good.stdout, /1\/1 truth claim\(s\) hold/)
  write("- Truth: counts.list14d.top == 42")
  const bad = evals()
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /is 40, the case was written for 42/)
  rmSync(dir, { recursive: true, force: true })
})
