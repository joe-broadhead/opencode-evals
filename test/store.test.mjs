// One store: `grade` reads recordings from $EVALS_STORE/raw, the place the docs and the runner use.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { storeRoot, rawRoot } from "../src/store.mjs"
import { compileCase } from "../src/case/compile.mjs"

const BIN = join(import.meta.dirname, "..", "bin", "evals")
const temp = () => mkdtempSync(join(tmpdir(), "evals-store-"))

test("the raw recordings live under the store unless EVALS_RAW says otherwise", () => {
  assert.equal(storeRoot({ EVALS_STORE: "/tmp/s" }), "/tmp/s")
  assert.equal(rawRoot({ EVALS_STORE: "/tmp/s" }), join("/tmp/s", "raw"))
  assert.equal(rawRoot({ EVALS_STORE: "/tmp/s", EVALS_RAW: "/tmp/r" }), "/tmp/r")
  assert.match(storeRoot({}), /private[\\/]store$/)
  assert.equal(rawRoot({}), join(storeRoot({}), "raw"))
})

const CASE = `# demo-answer
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

/** A store with one trace and one recording of a case whose only item reads the answer text. */
function fixture(text) {
  const root = temp()
  const store = join(root, "store")
  const cases = join(root, "cases")
  mkdirSync(cases, { recursive: true })
  writeFileSync(join(cases, "demo-answer.md"), CASE)
  writeFileSync(join(cases, "demo-answer.json"), JSON.stringify(compileCase("cases/demo/demo-answer.md", CASE)))
  const traces = join(store, "traces", "it1")
  mkdirSync(traces, { recursive: true })
  const head = { schema: "oc-trace/1", run_id: "it1/demo-answer", iteration: "it1", case: "demo-answer", exit: 0, failure_class: null, duration_ms: 10, model: { id: "m" }, summary: { outer_calls: 0, inner_calls: 0, steps: 1, skills_loaded: [], tokens: {}, cost: { source: "missing" }, text: {} } }
  writeFileSync(join(traces, "demo-answer.trace.jsonl"), `${JSON.stringify(head)}\n`)
  const raw = join(store, "raw", "it1", "demo")
  mkdirSync(raw, { recursive: true })
  writeFileSync(join(raw, "demo-answer.jsonl"), `${JSON.stringify({ type: "text", part: { text } })}\n`)
  return { root, store, cases }
}

const grade = ({ store, cases }, env = {}) =>
  spawnSync(process.execPath, [BIN, "grade", "--iteration", "it1", "--plugin", "demo", "--cases", cases], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, EVALS_STORE: store, EVALS_MODELS_CATALOG: join(store, "absent.json"), ...env },
  })

test("grade reads the answer from $EVALS_STORE/raw", () => {
  const f = fixture("there were eight")
  const run = grade(f)
  assert.equal(run.status, 0, run.stderr)
  const verdicts = JSON.parse(readFileSync(join(f.store, "results", "it1", "verdicts.json"), "utf8"))
  assert.equal(verdicts[0].verdict, "PASS", JSON.stringify(verdicts[0].items))
  rmSync(f.root, { recursive: true, force: true })
})

test("grade --raw points at another recordings tree, and a missing recording is not a pass", () => {
  const f = fixture("there were eight")
  const run = grade(f, { EVALS_RAW: join(f.root, "elsewhere") })
  assert.equal(run.status, 0, run.stderr)
  const verdicts = JSON.parse(readFileSync(join(f.store, "results", "it1", "verdicts.json"), "utf8"))
  assert.notEqual(verdicts[0].verdict, "PASS", "no recording, no answer text: the item cannot pass")
  rmSync(f.root, { recursive: true, force: true })
})
