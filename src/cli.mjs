// The CLI. Every subcommand is deterministic: it reads files, computes, and writes files.
//
//   evals compile  [--plugin x] [--check]     markdown cases -> oc-case/1 JSON
//   evals trace    --iteration nx6 [--from DIR] [--out DIR]
//   evals grade    --iteration nx6 [--cases DIR] [--traces DIR] [--raw DIR] [--state DIR] [--out DIR]
//   evals lock     [--plugin x] [--epoch N]
//   evals scorecard --iteration nx6 [--grading FILE] [--out FILE]
//   evals policy   --a nx5 --b nx6 [--strict]
//   evals t0       [--root DIR] [--json]
//   evals verify   re-derive every number from the stored inputs and compare
//   evals selftest run the T-G gold cases over synthetic traces

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync, chmodSync } from "node:fs"
import { join, dirname, resolve, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { compileCase, casesDigest, codedShare } from "./case/compile.mjs"
import { digestOf, sha256, short, canonical } from "./util/canonical.mjs"
import { harnessVersion } from "./version.mjs"
import { traceFromFiles } from "./trace/normalise.mjs"
import { gradeCase, runView } from "./grade/grade.mjs"
import { decide, numericVerdict } from "./policy/decide.mjs"
import { comparable } from "./policy/comparable.mjs"
import { checkX } from "./t0/x.mjs"
import { renderScorecard, compareToHandGrading } from "./report/scorecard.mjs"
import { goldCases } from "./grade/gold.mjs"

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)))
const args = (argv) => {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--")) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith("--")) {
        out[key] = next
        i++
      } else out[key] = true
    } else out._.push(a)
  }
  return out
}

const path = (...parts) => join(ROOT, ...parts)
const read = (file) => readFileSync(file, "utf8")
const write = (file, text) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`)
}
const json = (value) => JSON.stringify(value, null, 2)
const ensureDir = (dir) => mkdirSync(dir, { recursive: true })
const listCases = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).sort() : [])

function compileAll(plugin = "x", { check = false } = {}) {
  const dir = path("cases", plugin)
  const files = listCases(dir)
  if (!files.length) throw new Error(`no cases in ${dir}`)
  // Compile every case before writing any: a broken case must not leave a half-written case set.
  const compiled = files.map((file) => {
    const text = read(join(dir, file))
    const caseObject = compileCase(join("cases", plugin, file), text)
    const previous = join(dir, file.replace(/\.md$/, ".json"))
    const next = `${json(caseObject)}\n`
    const changed = !existsSync(previous) || read(previous) !== next
    return { caseObject, changed, file, previous, next }
  })
  if (!check) for (const { previous, next, changed } of compiled) if (changed) write(previous, next)
  return compiled
}

function loadCases(plugin = "x") {
  const dir = path("cases", plugin)
  return listCases(dir).map((file) => JSON.parse(read(join(dir, file.replace(/\.md$/, ".json")))))
}

/** Grader hash: the files whose change can change a verdict. */
function graderHash() {
  const files = [
    "src/grade/evidence.mjs",
    "src/grade/grade.mjs",
    "src/grade/select.mjs",
    "src/trace/analyse.mjs",
    "src/trace/redact.mjs",
    "src/grade/gold.mjs",
  ]
  const digests = {}
  for (const file of files) digests[file] = sha256(read(path(file)))
  return digestOf(digests)
}

function writeLock(plugin = "x", epoch = 1) {
  const cases = loadCases(plugin)
  const lock = {
    plugin,
    epoch,
    cases: cases.length,
    items: cases.reduce((n, c) => n + c.items.length, 0),
    cases_sha256: casesDigest(cases),
    grader_sha256: graderHash(),
    // No harness version here: the lock freezes the case set and the grader, and the version of the code
    // that produced a result belongs in that result (every trace head and batch carries it).
    frozen_at: new Date().toISOString(),
  }
  write(path("cases", plugin, "evals.lock"), json(lock))
  return lock
}

/** The raw answer text for a recorded case, from the private tree only. */
function textFor(iteration, caseName) {
  const base = path("..", "private", "raw", iteration, "x", caseName)
  for (const candidate of [base, `${base}.jsonl`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      const lines = read(candidate).split("\n").filter(Boolean)
      const last = [...lines].reverse().map((l) => JSON.parse(l)).find((e) => e.type === "text")
      return last?.part?.text ?? ""
    }
  }
  return null
}

function stateFor(iteration, caseName) {
  const file = path("fixtures", "state", iteration, `${caseName}.json`)
  return existsSync(file) ? JSON.parse(read(file)) : null
}

function gradeAll(iteration, casesDir = path("cases", "x"), tracesDir = path("traces", iteration), rawDir = path("..", "private", "raw")) {
  const cases = casesDir.endsWith(".json") ? [] : listCases(casesDir).map((f) => JSON.parse(read(join(casesDir, f.replace(/\.md$/, ".json")))))
  const results = []
  for (const caseObject of cases) {
    const traceFile = join(tracesDir, `${caseObject.id}.trace.jsonl`)
    if (!existsSync(traceFile)) {
      results.push({ case: caseObject.id, plugin: caseObject.plugin, verdict: "NOT_RUN", items: [], coverage: { declared: caseObject.items.length }, note: "no trace for this case in the iteration" })
      continue
    }
    const lines = read(traceFile).split("\n").filter(Boolean)
    const rawBase = join(rawDir, iteration, "x", caseObject.id)
    let text = null
    if (existsSync(`${rawBase}.jsonl`)) {
      const last = [...read(`${rawBase}.jsonl`).split("\n").filter(Boolean)]
        .reverse()
        .map((l) => JSON.parse(l))
        .find((e) => e.type === "text")
      text = last?.part?.text ?? null
    }
    const view = runView(lines, { text, state: stateFor(iteration, caseObject.id) })
    results.push(gradeCase(caseObject, view))
  }
  return results
}

const batchDigest = (results) =>
  digestOf(results.map((r) => ({ case: r.case, verdict: r.verdict, items: (r.items ?? []).map((i) => [i.id, i.state]) })))

/** The provenance of one iteration, read from its first trace head. */
function iterationProvenance(iteration) {
  const dir = path("traces", iteration)
  if (!existsSync(dir)) return {}
  const first = readdirSync(dir).filter((f) => f.endsWith(".trace.jsonl")).sort()[0]
  if (!first) return {}
  const head = JSON.parse(read(join(dir, first)).split("\n")[0])
  const files = readdirSync(dir).filter((f) => f.endsWith(".trace.jsonl")).sort()
  const texts = files.map((f) => {
    const lines = read(join(dir, f)).split("\n").filter(Boolean).map((l) => JSON.parse(l))
    return `${lines[0].case}:${lines[0].summary?.text?.sha256 ?? ""}`
  })
  const costs = files.map((f) => JSON.parse(read(join(dir, f)).split("\n")[0]).summary?.cost ?? {})
  return {
    head,
    recordings_sha256: digestOf(texts),
    cost: {
      amount_usd: costs.every((c) => typeof c.amount_usd !== "number") ? null : costs.reduce((n, c) => n + (c.amount_usd ?? 0), 0),
      source: costs.every((c) => c.source === "missing") ? "missing" : costs[0].source,
    },
  }
}

function batchSummary(iteration, results, caseSet) {
  const graded = results.filter((r) => r.verdict !== "NOT_RUN")
  const pairs = graded.flatMap((r) => r.pairs ?? [])
  const provenance = iterationProvenance(iteration)
  return {
    iteration,
    harness_version: harnessVersion(),
    grader_sha256: graderHash(),
    recordings_sha256: provenance.recordings_sha256 ?? null,
    cost: provenance.cost ?? { amount_usd: null, source: "missing" },
    provenance: {
      model: { value: provenance.head?.model?.id ?? null, source: "declared" },
      opencode: { value: provenance.head?.provenance?.recorded?.opencode ?? null, source: "unrecorded" },
      cases: {
        sha256: provenance.head?.provenance?.cases?.sha256 ?? null,
        source: provenance.head?.provenance?.cases?.source ?? "unrecorded",
        rule_set: provenance.head?.provenance?.cases?.rule_set ?? null,
      },
      skills: { sha256: provenance.head?.provenance?.skills?.sha256 ?? null, source: provenance.head?.provenance?.skills?.source ?? "unrecorded" },
      plugin: { ...(provenance.head?.provenance?.plugin ?? {}), source: provenance.head?.provenance?.plugin?.source ?? "unrecorded" },
      quality: provenance.head?.provenance?.quality ?? "unrecorded",
    },
    case_set: {
      plugin: "x",
      cases: caseSet.length,
      cases_sha256: casesDigest(caseSet),
      items: caseSet.reduce((n, c) => n + c.items.length, 0),
      coded_share: codedShare(caseSet),
    },
    batch_sha256: batchDigest(results),
    coverage: {
      cases_declared: caseSet.length,
      cases_run: graded.length,
      items_declared: caseSet.reduce((n, c) => n + c.items.length, 0),
      items_executed: graded.reduce((n, r) => n + (r.coverage?.executed ?? 0), 0),
      items_testable: graded.reduce((n, r) => n + (r.coverage?.testable ?? 0), 0),
      items_passed: graded.reduce((n, r) => n + (r.coverage?.passed ?? 0), 0),
      items_blocked: graded.reduce((n, r) => n + (r.coverage?.blocked ?? 0), 0),
      items_na: graded.reduce((n, r) => n + (r.coverage?.na ?? 0), 0),
      items_advisory: graded.reduce((n, r) => n + (r.coverage?.advisory ?? 0), 0),
    },
    cases: graded.map((r) => ({
      case: r.case,
      verdict: r.verdict,
      failed: r.failed,
      failed_blockers: r.failed_blockers ?? [],
      failed_majors: r.failed_majors ?? [],
      blocked: [...(r.blocked ?? []), ...(r.blocked_minor ?? [])],
      findings: r.findings,
      na: r.na,
      forbidden_violations: r.forbidden_violations,
      budget: r.budget,
    })),
    tokens: graded.reduce(
      (n, r) => ({ total: n.total + (r.budget?.tokens ?? 0), calls: n.calls + (r.budget?.outer_calls ?? 0) + (r.budget?.inner_calls ?? 0) }),
      { total: 0, calls: 0 },
    ),
    pairs,
  }
}

export async function main(argv) {
  const command = argv[0]
  const opt = args(argv.slice(1))
  switch (command) {
    case "compile": {
      const plugin = opt.plugin ?? "x"
      const compiled = compileAll(plugin, { check: Boolean(opt.check) })
      const cases = compiled.map((c) => c.caseObject)
      const share = codedShare(cases)
      for (const { caseObject, changed, file } of compiled) {
        console.log(`${changed ? "wrote" : "same "} ${file.replace(/\.md$/, ".json")}  items ${caseObject.items.length}`)
      }
      console.log(`cases ${cases.length}  items ${share.total}  coded ${share.coded} (${Math.round(share.share * 100)}%)  digest ${short(casesDigest(cases))}`)
      return
    }
    case "lock": {
      const lock = writeLock(opt.plugin ?? "x", Number(opt.epoch ?? 1))
      console.log(json(lock))
      return
    }
    case "trace": {
      const iteration = opt.iteration ?? "nx6"
      const from = opt.from ?? process.env.HOME + `/opencode-release/review/evalruns/${iteration}/x`
      const out = opt.out ?? path("traces", iteration)
      const manifestFile = path("fixtures", "recordings", "manifest.json")
      const manifest = existsSync(manifestFile) ? JSON.parse(read(manifestFile)) : {}
      const entry = manifest[iteration] ?? {}
      ensureDir(out)
      const files = readdirSync(from).filter((f) => f.endsWith(".jsonl") && !f.includes("summary"))
      for (const file of files) {
        const caseName = basename(file, ".jsonl")
        const summaryPath = join(from, `${caseName}.summary.json`)
        const summary = existsSync(summaryPath) ? JSON.parse(read(summaryPath)) : {}
        const trace = traceFromFiles({
          caseName,
          iteration,
          base: join(from, caseName),
          manifest: {
            recorded: { iteration, date: entry.date ?? null, runner: "review/tools/run-evals.mjs", model: entry.model ?? "claude-agent/opus#high" },
            plugin: { version: entry.plugin_version ?? null, commit: entry.plugin_commit ?? null, source: entry.plugin_source ?? "unrecorded" },
            skills: { sha256: entry.skill_sha256 ?? null, source: "unrecorded" },
            cases: { sha256: entry.case_set_sha256 ?? null, source: "unrecorded", rule_set: entry.rule_set ?? null },
            quality: entry.quality ?? "unrecorded",
          },
          pricing: { models: {} },
          model: entry.model ?? "claude-agent/opus#high",
          stderr: summary.stderr ?? "",
        })
        writeFileSync(join(out, `${caseName}.trace.jsonl`), `${trace.lines.join("\n")}\n`)
      }
      console.log(`traced ${files.length} runs of ${iteration} -> ${out}`)
      return
    }
    case "grade": {
      const iteration = opt.iteration ?? "nx6"
      const cases = loadCases(opt.plugin ?? "x")
      const results = gradeAll(iteration, path("cases", opt.plugin ?? "x"), path("traces", iteration))
      const summary = batchSummary(iteration, results, cases)
      const out = opt.out ?? path("results", iteration)
      ensureDir(out)
      write(join(out, "verdicts.json"), json(results))
      write(join(out, "batch.json"), json(summary))
      const counts = results.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {})
      console.log(`${iteration}: ${JSON.stringify(counts)}  items ${summary.coverage.items_testable}/${summary.coverage.items_executed} testable, ${summary.coverage.items_blocked} blocked, ${summary.coverage.items_na} n/a  -> ${out}`)
      return
    }
    case "scorecard": {
      const iteration = opt.iteration ?? "nx6"
      const results = JSON.parse(read(opt.results ?? path("results", iteration, "verdicts.json")))
      const batch = JSON.parse(read(path("results", iteration, "batch.json")))
      const gradingFile = opt.grading ?? process.env.HOME + `/opencode-release/review/evalruns/${iteration}/x/grading.json`
      const hand = existsSync(gradingFile) ? JSON.parse(read(gradingFile)) : null
      const comparison = hand ? compareToHandGrading(results, hand) : null
      // Every disagreement must carry an authored explanation; the note lives in the case's `## Notes`.
      const notes = {}
      for (const caseObject of loadCases(opt.plugin ?? "x")) {
        for (const note of caseObject.notes ?? []) if (note.id) notes[note.id] = note.text
      }
      const text = renderScorecard({ batch, results, comparison, iteration, notes })
      const out = opt.out ?? path("results", iteration, "scorecard.md")
      write(out, text)
      write(path("results", iteration, "scorecard.json"), json({ batch, comparison }))
      console.log(text.split("\n").slice(0, 4).join("\n"))
      console.log(`-> ${out}`)
      return
    }
    case "policy": {
      const a = JSON.parse(read(path("results", opt.a ?? "nx4", "batch.json")))
      const b = JSON.parse(read(path("results", opt.b ?? "nx6", "batch.json")))
      const comparison = comparable(a, b, opt.axis ?? "skill", { assume: opt.assume ?? "refuse" })
      const verdict = decide({ comparison, a, b, noiseFloor: Number(opt["noise-floor"] ?? 0.2) })
      if (opt.json) {
        console.log(json(verdict))
        return
      }
      const n = verdict.numeric
      const lines = [
        `# policy: ${opt.a ?? "nx4"} -> ${opt.b ?? "nx6"}  (axis ${comparison.axis})`,
        "",
        `**${verdict.verdict.toUpperCase()}** — basis ${verdict.basis}`,
        "",
        ...verdict.reasons.map((r) => `- ${r}`),
        "",
        "| Number | Value |",
        "| --- | --- |",
        `| shared cases | ${n.sharedCases} |`,
        `| pass rate (items testable/executed) | ${n.passRate.a === null ? "—" : n.passRate.a.toFixed(3)} -> ${n.passRate.b === null ? "—" : n.passRate.b.toFixed(3)} |`,
        `| cases fixed | ${n.fixes.length ? n.fixes.join(", ") : "—"} |`,
        `| cases regressed | ${n.caseRegressions.length ? n.caseRegressions.join(", ") : "—"} |`,
        `| new blocker failures | ${n.newBlockerFailures.length ? n.newBlockerFailures.join(", ") : "—"} |`,
        `| new major findings | ${n.newMajorFailures.length ? n.newMajorFailures.join(", ") : "—"} |`,
        `| failed items in b | ${n.failedItems.join(", ") || "—"} |`,
        `| cost per passing case | ${n.costPerPass.delta === null ? `not computable (cost source: ${n.costSource})` : `${n.costPerPass.delta > 0 ? "+" : ""}${Math.round(n.costPerPass.delta * 100)}%`} |`,
        "",
        `Comparability: ${comparison.why.length ? comparison.why.join("; ") : "every axis but the one under test matches"}.`,
      ]
      console.log(lines.join("\n"))
      return
    }
    case "t0": {
      const root = opt.root ?? process.env.HOME + "/opencode-x"
      const report = checkX(root, path("cases", "x"), loadCases("x"))
      console.log(opt.json ? json(report) : report.text)
      if (opt.write) write(path("results", "t0", "x.json"), json(report))
      if (report.failed) process.exitCode = 1
      return
    }
    case "verify": {
      const failures = []
      const iteration = opt.iteration ?? "nx6"
      const summaryFile = path("results", iteration, "batch.json")
      if (!existsSync(summaryFile)) throw new Error(`no batch at ${summaryFile}; run grade first`)
      const previous = JSON.parse(read(summaryFile))
      const cases = loadCases(opt.plugin ?? "x")
      const lockFile = path("cases", opt.plugin ?? "x", "evals.lock")
      if (existsSync(lockFile)) {
        const lock = JSON.parse(read(lockFile))
        if (lock.cases_sha256 !== casesDigest(cases)) failures.push(`the case set moved since the lock: ${short(lock.cases_sha256)} -> ${short(casesDigest(cases))}`)
        if (lock.grader_sha256 !== graderHash()) failures.push(`the grader moved since the lock: ${short(lock.grader_sha256)} -> ${short(graderHash())}`)
      } else failures.push("no cases/x/evals.lock")
      const results = gradeAll(iteration)
      const again = batchSummary(iteration, results, cases)
      if (again.batch_sha256 !== previous.batch_sha256) failures.push(`batch digest moved: ${short(previous.batch_sha256)} -> ${short(again.batch_sha256)}`)
      if (canonical(again.coverage) !== canonical(previous.coverage)) failures.push("coverage moved")
      const verdicts = JSON.parse(read(path("results", iteration, "verdicts.json")))
      if (canonical(verdicts) !== canonical(results)) failures.push("verdicts.json is not what the inputs produce")
      console.log(failures.length ? `MISMATCH\n  ${failures.join("\n  ")}` : `reproduced ${iteration}: batch ${short(again.batch_sha256)}, ${again.coverage.items_testable}/${again.coverage.items_executed} testable`)
      if (failures.length) process.exitCode = 1
      return
    }
    case "selftest": {
      const gold = goldCases()
      let failed = 0
      for (const entry of gold) {
        const view = runView(entry.trace, { text: entry.text ?? null, state: entry.state ?? null })
        const result = gradeCase(entry.case, view)
        const ok = result.verdict === entry.expect.verdict && (entry.expect.failed ?? []).every((id) => result.failed.includes(id))
        if (!ok) failed++
        console.log(`${ok ? "ok  " : "FAIL"} ${entry.case.id.padEnd(34)} ${result.verdict.padEnd(8)} expected ${entry.expect.verdict}${entry.expect.failed?.length ? ` failing ${entry.expect.failed.join(",")}` : ""}`)
      }
      console.log(`${gold.length - failed}/${gold.length} gold cases reproduce their known verdict`)
      if (failed) process.exitCode = 1
      return
    }
    default:
      console.log(read(path("README.md")).split("\n").slice(0, 30).join("\n"))
  }
}
