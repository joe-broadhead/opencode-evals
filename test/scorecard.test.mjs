// The scorecard names its plugin, lists the runs a subset made rather than every declared case, and says when the
// grader or the cases moved since the batch was graded; `verify --all` finds every such batch.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

const BIN = join(import.meta.dirname, "..", "bin", "evals")

function store({ grader = "0".repeat(64) } = {}) {
  const root = mkdtempSync(join(tmpdir(), "evals-scorecard-"))
  const dir = join(root, "results", "h1")
  mkdirSync(dir, { recursive: true })
  const ran = { case: "hot-file", plugin: "history", verdict: "PASS", items: [{ id: "H-OC01", severity: "blocker", state: "pass" }], failed: [], findings: [], na: [] }
  const missing = { case: "auth-timeline", plugin: "history", verdict: "NOT_RUN", items: [], coverage: { declared: 5 } }
  writeFileSync(join(dir, "verdicts.json"), JSON.stringify([ran, missing]))
  writeFileSync(
    join(dir, "batch.json"),
    JSON.stringify({
      iteration: "h1",
      harness_version: "test",
      grader_sha256: grader,
      batch_sha256: "b".repeat(64),
      coverage: { cases_declared: 66, cases_run: 1, items_declared: 477, items_executed: 1, items_testable: 1, items_passed: 1, items_blocked: 0, items_na: 0, items_advisory: 0 },
      case_set: { plugin: "history", cases: 66, cases_sha256: "c".repeat(64), items: 477, coded_share: { share: 1 } },
      trials: { min: 1, max: 1, runs: 1 },
      strict: { runs: 1, passed: 1, rate: 1 },
      pass_k: { cases: 1, verdict: 1, strict: 1 },
      tokens: { total: 10, calls: 1 },
      cost: { sources: {} },
      provenance: { model: { value: "claude-agent/haiku" } },
    }),
  )
  return root
}

const cli = (root, args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, EVALS_STORE: root, EVALS_MODELS_CATALOG: join(root, "absent.json") } })

test("the scorecard is titled by the plugin, lists what ran, and counts what did not", () => {
  const root = store()
  const out = cli(root, ["scorecard", "--iteration", "h1", "--plugin", "history"])
  assert.equal(out.status, 0, out.stderr)
  const text = readFileSync(join(root, "results", "h1", "scorecard.md"), "utf8")
  assert.match(text, /^# History — scorecard, `h1`/)
  assert.doesNotMatch(text, /X plugin/)
  assert.match(text, /\| hot-file \| \*\*PASS\*\*/)
  assert.doesNotMatch(text, /auth-timeline/, "a declared case the iteration did not run is not a row")
  assert.match(text, /1 declared case\(s\) were not run/)
  assert.match(text, /Strict pass \(every blocker and major\): \*\*100%\*\*/)
  rmSync(root, { recursive: true, force: true })
})

test("a batch graded by another grader, or against other cases, is stale, and says so", () => {
  const root = store()
  const text = (cli(root, ["scorecard", "--iteration", "h1", "--plugin", "history"]), readFileSync(join(root, "results", "h1", "scorecard.md"), "utf8"))
  assert.match(text, /> \*\*Stale\.\*\* graded by grader `000000000000`/)
  assert.match(text, /graded against case set `cccccccccccc`/)
  const all = cli(root, ["verify", "--all"])
  assert.equal(all.status, 1)
  assert.match(all.stdout, /STALE\s+h1\s+history/)
  assert.match(all.stdout, /1 graded iteration\(s\), 1 stale/)
  rmSync(root, { recursive: true, force: true })
})
