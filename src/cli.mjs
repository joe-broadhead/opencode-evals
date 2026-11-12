// The CLI. Every subcommand is deterministic: it reads files, computes, and writes files.
//
//   evals compile  --plugin x | --all [--check] [--holdouts]   markdown cases -> oc-case/1 JSON; --check writes nothing
//                  and fails on a change; --holdouts compiles $EVALS_STORE/holdouts/<plugin>/ in the store
//   evals trace    --iteration nx6 [--plugin x] [--from DIR] [--out DIR]
//   evals grade    --iteration nx6 [--plugin x] [--cases DIR] [--traces DIR] [--raw DIR] [--out DIR]
//   evals lock     [--plugin x] [--epoch N]
//   evals scorecard --iteration nx6 [--grading FILE] [--out FILE]
//   evals policy   --a nx5 --b nx6 [--strict]
//   evals report   <label>=<it>[,<it>...] ... [--plugin x] [--set all] [--cases ids] [--all-cases] [--detail] [--json]
//   evals run      --plugin x --iteration it --model p/m --auth none|env:VAR|claude-agent [--cases ids] [--set tune]
//                  [--trials K] [--parallel N] [--arm DIR|none] [--world DIR|FILE] [--host 2.2.6] [--dry-run]
//                  [--isolation container|none] [--unsafe-no-isolation]   (a live run needs filesystem isolation)
//   evals t0       [--root DIR] [--json]
//   evals verify   [--iteration it --plugin x | --all]  re-derive every number, or list the stale iterations
//   evals selftest run the T-G gold cases over synthetic traces

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname, resolve, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { compileCase, casesDigest, codedShare } from "./case/compile.mjs"
import { digestOf, sha256, short, canonical } from "./util/canonical.mjs"
import { harnessVersion } from "./version.mjs"
import { traceFromFiles } from "./trace/normalise.mjs"
import { gradeCase, runView } from "./grade/grade.mjs"
import { decide, numericVerdict } from "./policy/decide.mjs"
import { comparable, DEFAULT_OPTIONS } from "./policy/comparable.mjs"
import { checkX } from "./t0/x.mjs"
import { renderScorecard, compareToHandGrading } from "./report/scorecard.mjs"
import { goldCases } from "./grade/gold.mjs"
import { readPack, writePack, pluginRepo, repoAvailable, derivePack, readSnapshot, allPackIds, familyProblems } from "./pack/from-plugin.mjs"
import { verifyFromRepo, driftReport, renderDrift } from "./pack/snapshot.mjs"
import { runT1, coverageTable } from "./t1/run.mjs"
import { checkPack } from "./t0/generic.mjs"
import { scan as privacyScan, renderScan } from "./privacy/gate.mjs"
import { monthToDate, budgetLine, runCapLines, CAPS } from "./cost/budget.mjs"
import { loadCaps } from "./cost/ledger.mjs"
import { loadPrices, vendorCost } from "./cost/compute.mjs"
import { extendVocab } from "./trace/redact.mjs"
import { loadCatalog, loadMapping, drift } from "./cost/catalog.mjs"
import { runCost, totals, trustOf } from "./cost/rule.mjs"
import { runLabelSession, labelReport, advisoryItems, pageFor as pageOf } from "./label/kit.mjs"
import { storeRoot, rawRoot, tracesDir } from "./store.mjs"
import { splitTrial, trialName, caseEntry, byCase, trialStats } from "./grade/trials.mjs"
import { selectCases } from "./case/sets.mjs"
import { builtinCollisions } from "./grade/select.mjs"
import { pluginCases, privateHoldoutsDir } from "./case/load.mjs"
import { rawCallArgs } from "./trace/rawArgs.mjs"
import { compare as compareArms, renderReport } from "./report/arms.mjs"
import { runBatch } from "./run/runner.mjs"
import { segment } from "./run/paths.mjs"

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
const storePath = () => storeRoot()
const read = (file) => readFileSync(file, "utf8")
const write = (file, text) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`)
}
const json = (value) => JSON.stringify(value, null, 2)
const ensureDir = (dir) => mkdirSync(dir, { recursive: true })
const listCases = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).sort() : [])

function compileAll(plugin = "x", { check = false, dir = path("cases", plugin) } = {}) {
  const files = listCases(dir)
  if (!files.length) throw new Error(`no cases in ${dir}`)
  // Compile every case before writing any: a broken case must not leave a half-written case set.
  const compiled = files.map((file) => {
    const text = read(join(dir, file))
    const caseObject = compileCase(dir === path("cases", plugin) ? join("cases", plugin, file) : join("holdouts", plugin, file), text)
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
    "src/trace/rawArgs.mjs",
    "src/grade/trials.mjs",
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

function stateFor(iteration, caseName) {
  const file = path("fixtures", "state", iteration, `${caseName}.json`)
  return existsSync(file) ? JSON.parse(read(file)) : null
}

function gradeAll(iteration, cases, traceDir = tracesDir(iteration, "x"), rawDir = rawRoot(), plugin = "x") {
  const results = []
  const pack = readSnapshot(plugin, ROOT)
  const scope = pack ? { ns: plugin, tools: new Set((pack.tools ?? []).map((tool) => tool.name)) } : null
  // Every trial of a case is graded: `<case>.trace.jsonl` (one trial, recorded before trials were kept per file) and
  // `<case>.t<k>.trace.jsonl`.
  const files = existsSync(traceDir) ? readdirSync(traceDir).filter((f) => f.endsWith(".trace.jsonl")) : []
  const trialsOf = (id) =>
    files
      .map((file) => ({ file, ...splitTrial(file.replace(/\.trace\.jsonl$/, "")) }))
      .filter((entry) => entry.case === id)
      .sort((a, b) => (a.trial ?? 0) - (b.trial ?? 0))
  for (const caseObject of cases) {
    const found = trialsOf(caseObject.id)
    if (!found.length) {
      results.push({ case: caseObject.id, plugin: caseObject.plugin, verdict: "NOT_RUN", items: [], coverage: { declared: caseObject.items.length }, note: "no trace for this case in the iteration" })
      continue
    }
    for (const { file, trial } of found) {
      const lines = read(join(traceDir, file)).split("\n").filter(Boolean)
      const rawBase = join(rawDir, iteration, plugin, trialName(caseObject.id, trial))
      let text = null
      let rawArgs = null
      if (existsSync(`${rawBase}.jsonl`)) {
        const rawLines = read(`${rawBase}.jsonl`).split("\n").filter(Boolean)
        const last = [...rawLines]
          .reverse()
          .map((l) => JSON.parse(l))
          .find((e) => e.type === "text")
        text = last?.part?.text ?? null
        // The arguments the case declares checkable are read from the recording here, and kept out of every trace.
        if (caseObject.checkable?.length) rawArgs = rawCallArgs(rawLines)
      }
      const files = existsSync(`${rawBase}.files.json`) ? JSON.parse(read(`${rawBase}.files.json`)) : null
      const view = runView(lines, { text, state: stateFor(iteration, caseObject.id), scope, rawArgs, checkable: caseObject.checkable ?? [], files })
      results.push({ ...gradeCase(caseObject, view), ...(trial ? { trial } : {}) })
    }
  }
  return results
}

/**
 * Why a graded iteration no longer says what the code would say: the grader or the case set moved since it was
 * graded. A stale batch is reported, never silently trusted; `evals grade` again refreshes it.
 */
function staleness(batch, plugin) {
  const why = []
  if (batch.grader_sha256 && batch.grader_sha256 !== graderHash()) why.push(`graded by grader \`${short(batch.grader_sha256)}\`; the grader is now \`${short(graderHash())}\`. Re-run \`evals grade --iteration ${batch.iteration} --plugin ${plugin}\`.`)
  const cases = pluginCases(plugin)
  if (cases.length && batch.case_set?.cases_sha256 && batch.case_set.cases_sha256 !== casesDigest(cases)) why.push(`graded against case set \`${short(batch.case_set.cases_sha256)}\`; the cases are now \`${short(casesDigest(cases))}\`.`)
  return why
}

const batchDigest = (results) =>
  digestOf(results.map((r) => ({ case: r.case, ...(r.trial ? { trial: r.trial } : {}), verdict: r.verdict, items: (r.items ?? []).map((i) => [i.id, i.state]) })))

/** The provenance of one iteration, read from its first trace head. */
function iterationProvenance(iteration, plugin = "x") {
  const dir = tracesDir(iteration, plugin)
  if (!existsSync(dir)) return {}
  const first = readdirSync(dir).filter((f) => f.endsWith(".trace.jsonl")).sort()[0]
  if (!first) return {}
  const head = JSON.parse(read(join(dir, first)).split("\n")[0])
  const files = readdirSync(dir).filter((f) => f.endsWith(".trace.jsonl")).sort()
  const texts = files.map((f) => {
    const lines = read(join(dir, f)).split("\n").filter(Boolean).map((l) => JSON.parse(l))
    return `${splitTrial(f.replace(/\.trace\.jsonl$/, "")).trial ? f.replace(/\.trace\.jsonl$/, "") : lines[0].case}:${lines[0].summary?.text?.sha256 ?? ""}`
  })
  const heads = files.map((f) => ({ ...JSON.parse(read(join(dir, f)).split("\n")[0]), file: f }))
  const costs = heads.map((head) => head.summary?.cost ?? {})
  // The vendor side is a separate wallet, at the plugin's own rates, from the resources each trace recorded.
  const prices = loadPrices()
  const vendor = heads.reduce((sum, head) => {
    const calls = runView(read(join(dir, head.file)).split("\n").filter(Boolean)).calls.filter((call) => call.via === "execute")
    return sum + (vendorCost(calls, plugin, prices).amount_usd ?? 0)
  }, 0)
  return {
    head,
    recordings_sha256: digestOf(texts),
    vendor_cost: { amount_usd: vendor, source: "table" },
    cost: {
      // Two totals, never merged: what the provider charged, and what the catalogue would have charged.
      billed_usd: costs.every((c) => typeof c.billed_usd !== "number") ? null : costs.reduce((n, c) => n + (c.billed_usd ?? 0), 0),
      list_usd: costs.every((c) => !c.resolved?.price) ? null : costs.reduce((n, c) => {
        if (!c.resolved?.price) return n
        const price = c.resolved.price
        const tokens = c.tokens ?? {}
        return n + ((tokens.input ?? 0) * price.input + (tokens.output ?? 0) * price.output + (tokens.cacheRead ?? 0) * price.cache_read + (tokens.cacheWrite ?? 0) * price.cache_write) / 1_000_000
      }, 0),
      sources: costs.reduce((acc, c) => ({ ...acc, [c.source]: (acc[c.source] ?? 0) + 1 }), {}),
      missing_runs: costs.filter((c) => c.source === "missing").length,
      catalog: costs[0]?.catalog ?? null,
      mapping: costs.find((c) => c.resolved?.mapping)?.resolved.mapping ?? null,
      mapped_to: (() => {
        const found = costs.find((c) => c.resolved?.via === "mapping")?.resolved
        return found ? `${found.provider}/${found.model}` : null
      })(),
      drift: drift(loadCatalog(), loadMapping()),
      run_date: (heads[0]?.started_at ?? "").slice(0, 10) || null,
      amount_usd: costs.every((c) => typeof c.billed_usd !== "number") ? null : costs.reduce((n, c) => n + (c.billed_usd ?? 0), 0),
      source: costs.every((c) => c.source === "missing") ? "missing" : costs.some((c) => c.source === "billed" && c.billed_usd > 0) ? "billed" : costs[0].source,
    },
  }
}

function batchSummary(iteration, results, caseSet, plugin = caseSet[0]?.plugin ?? "x") {
  const graded = results.filter((r) => r.verdict !== "NOT_RUN")
  const pairs = graded.flatMap((r) => r.pairs ?? [])
  const provenance = iterationProvenance(iteration, plugin)
  return {
    iteration,
    harness_version: harnessVersion(),
    grader_sha256: graderHash(),
    recordings_sha256: provenance.recordings_sha256 ?? null,
    ran_at: new Date().toISOString(),
    cost: provenance.cost ?? { billed_usd: null, list_usd: null, sources: {}, missing_runs: 0 },
    vendor_cost: provenance.vendor_cost ?? { amount_usd: null, source: "missing" },
    provenance: {
      model: { value: provenance.head?.model?.id ?? null, source: "declared" },
      opencode: { value: provenance.head?.provenance?.recorded?.opencode ?? null, source: provenance.head?.provenance?.recorded?.opencode ? "recorded" : "unrecorded" },
      cases: {
        sha256: provenance.head?.provenance?.cases?.sha256 ?? null,
        source: provenance.head?.provenance?.cases?.source ?? "unrecorded",
        rule_set: provenance.head?.provenance?.cases?.rule_set ?? null,
      },
      skills: { sha256: provenance.head?.provenance?.skills?.sha256 ?? null, source: provenance.head?.provenance?.skills?.source ?? "unrecorded" },
      ...Object.fromEntries(["descriptions", "namespace", "tools", "rules"].map((axis) => [axis, { sha256: provenance.head?.provenance?.[axis]?.sha256 ?? null, source: provenance.head?.provenance?.[axis]?.source ?? "unrecorded" }])),
      options: provenance.head?.provenance?.options ?? { sha256: DEFAULT_OPTIONS, source: "default" },
      plugin: { ...(provenance.head?.provenance?.plugin ?? {}), source: provenance.head?.provenance?.plugin?.source ?? "unrecorded" },
      quality: provenance.head?.provenance?.quality ?? "unrecorded",
    },
    // Trials per case, strict pass (every blocker and major item) and pass^k: what one PASS cannot say.
    ...trialStats(results),
    case_set: {
      plugin: caseSet[0]?.plugin ?? "x",
      cases: caseSet.length,
      cases_sha256: casesDigest(caseSet),
      items: caseSet.reduce((n, c) => n + c.items.length, 0),
      coded_share: codedShare(caseSet),
    },
    batch_sha256: batchDigest(results),
    coverage: {
      cases_declared: caseSet.length,
      cases_run: byCase(graded).size,
      items_declared: caseSet.reduce((n, c) => n + c.items.length, 0),
      items_executed: graded.reduce((n, r) => n + (r.coverage?.executed ?? 0), 0),
      items_testable: graded.reduce((n, r) => n + (r.coverage?.testable ?? 0), 0),
      items_passed: graded.reduce((n, r) => n + (r.coverage?.passed ?? 0), 0),
      items_blocked: graded.reduce((n, r) => n + (r.coverage?.blocked ?? 0), 0),
      items_na: graded.reduce((n, r) => n + (r.coverage?.na ?? 0), 0),
      items_advisory: graded.reduce((n, r) => n + (r.coverage?.advisory ?? 0), 0),
    },
    cases: [...byCase(graded).values()].map(caseEntry),
    tokens: graded.reduce(
      (n, r) => ({ total: n.total + (r.budget?.tokens ?? 0), calls: n.calls + (r.budget?.outer_calls ?? 0) + (r.budget?.inner_calls ?? 0) }),
      { total: 0, calls: 0 },
    ),
    pairs,
  }
}

const usage = () => {
  const lines = read(fileURLToPath(import.meta.url)).split("\n")
  const end = lines.findIndex((line) => !line.startsWith("//"))
  return lines.slice(0, end).map((line) => line.replace(/^\/\/ ?/, "")).join("\n")
}

export async function main(argv) {
  const command = argv[0]
  const opt = args(argv.slice(1))
  // `--help` never runs a command: `compile --help` used to compile and rewrite the x cases.
  if (!command || opt.help || argv.includes("-h") || command === "help") {
    console.log(usage())
    return
  }
  // An iteration or a plugin id is a directory name in the store: one safe segment, never a path.
  for (const key of ["iteration", "plugin", "a", "b"]) if (typeof opt[key] === "string") segment(`--${key}`, opt[key])
  switch (command) {
    case "compile": {
      if (!opt.plugin && !opt.all) throw new Error("evals compile --plugin <id>, or --all for every cases/<id>; add --check to write nothing")
      const plugins = opt.all ? readdirSync(path("cases")).filter((name) => listCases(path("cases", name)).length).sort() : [opt.plugin]
      let changes = 0
      for (const plugin of plugins) {
        // --holdouts compiles the store's private holdouts for the plugin, in the store.
        const dir = opt.holdouts ? privateHoldoutsDir(plugin) : path("cases", plugin)
        // Compiled and checked before anything is written: a refused case set leaves the JSON as it was.
        const compiled = compileAll(plugin, { check: true, dir })
        const cases = compiled.map((c) => c.caseObject)
        const share = codedShare(cases)
        // A bare name that is both an OpenCode built-in and a tool of this plugin means every tool of that name.
        const pack = readSnapshot(plugin, ROOT)
        const collisions = pack ? cases.map((c) => [c.id, builtinCollisions(c, (pack.tools ?? []).map((tool) => tool.name))]).filter(([, names]) => names.length) : []
        if (collisions.length) {
          throw new Error(`${collisions.length} ${plugin} case(s) name a tool bare that is both OpenCode's built-in and ${plugin}'s: write ${plugin}.<name> for ${plugin}'s, or keep the bare name for every tool of that name only where ${plugin} has none\n  ${collisions.map(([id, n]) => `${id}: ${n.join(", ")}`).join("\n  ")}`)
        }
        if (!opt.check) for (const { previous, next, changed } of compiled) if (changed) write(previous, next)
        for (const { caseObject, changed, file } of compiled) {
          if (changed) changes++
          if (changed || !opt.check) console.log(`${changed ? (opt.check ? "stale" : "wrote") : "same "} ${plugin}/${file.replace(/\.md$/, ".json")}  items ${caseObject.items.length}`)
        }
        console.log(`${plugin}: cases ${cases.length}  items ${share.total}  coded ${share.coded} (${Math.round(share.share * 100)}%)  digest ${short(casesDigest(cases))}`)
      }
      if (opt.check && changes) {
        console.log(`${changes} compiled case(s) differ from their markdown: run \`evals compile --plugin <id>\` and commit the JSON`)
        process.exitCode = 1
      }
      return
    }
    case "lock": {
      const lock = writeLock(opt.plugin ?? "x", Number(opt.epoch ?? 1))
      console.log(json(lock))
      return
    }
    case "trace": {
      const iteration = opt.iteration ?? "nx6"
      const plugin = opt.plugin ?? "x"
      const from = opt.from ?? process.env.EVALS_RECORDINGS ?? join(rawRoot(), iteration, plugin)
      const out = opt.out ?? join(storePath(), "traces", iteration, plugin)
      if (opt.plugin && (readSnapshot(opt.plugin, ROOT) || repoAvailable(opt.plugin))) extendVocab(readPack(opt.plugin).vocab)
      const manifestFile = path("fixtures", "recordings", "manifest.json")
      const manifest = existsSync(manifestFile) ? JSON.parse(read(manifestFile)) : {}
      const entry = manifest[iteration] ?? {}
      ensureDir(out)
      const files = readdirSync(from).filter((f) => f.endsWith(".jsonl") && !f.includes("summary"))
      for (const file of files) {
        // `<case>.t<k>.jsonl` is trial k of the case; the trace keeps the index and every trial's file.
        const fileName = basename(file, ".jsonl")
        const { case: caseName, trial } = splitTrial(fileName)
        const summaryPath = join(from, `${fileName}.summary.json`)
        const summary = existsSync(summaryPath) ? JSON.parse(read(summaryPath)) : {}
        // A runner that records its own provenance (summary.provenance) is trusted over the hand-kept manifest.
        const prov = summary.provenance ?? null
        const caseDigest = opt.plugin ? casesDigest(pluginCases(opt.plugin)) : null
        const axis = (value) => (value ? { sha256: value, source: "recorded" } : { sha256: null, source: "unrecorded" })
        const trace = traceFromFiles({
          caseName,
          trial,
          iteration,
          plugin,
          base: join(from, fileName),
          manifest: prov
            ? {
                recorded: { iteration, date: summary.started_at ?? entry.date ?? null, runner: summary.runner ?? "unrecorded", runner_version: summary.runner_version ?? null, model: summary.model, opencode: summary.opencode ?? null },
                plugin: { version: prov.plugin_version ?? null, commit: prov.plugin_commit ?? null, sha256: prov.plugin ?? null, source: prov.plugin ? "recorded" : "unrecorded" },
                skills: axis(prov.skills),
                descriptions: axis(prov.descriptions),
                namespace: axis(prov.namespace),
                tools: axis(prov.tools),
                rules: axis(prov.rules),
                // Options are recorded by digest; a runner that records none ran the plugin with none.
                options: prov.options ? { sha256: prov.options, source: "recorded", ...(prov.access ? { access: prov.access } : {}) } : { sha256: DEFAULT_OPTIONS, source: "default" },
                cases: { sha256: caseDigest, source: caseDigest ? "recorded" : "unrecorded", rule_set: prov.rule_set ?? null },
                quality: "recorded",
              }
            : {
                recorded: { iteration, date: entry.date ?? null, runner: "review/tools/run-evals.mjs", model: entry.model ?? "claude-agent/opus#high" },
                plugin: { version: entry.plugin_version ?? null, commit: entry.plugin_commit ?? null, source: entry.plugin_source ?? "unrecorded" },
                skills: { sha256: entry.skill_sha256 ?? null, source: "unrecorded" },
                cases: { sha256: entry.case_set_sha256 ?? null, source: "unrecorded", rule_set: entry.rule_set ?? null },
                quality: entry.quality ?? "unrecorded",
              },
          pricing: { models: {} },
          model: summary.model ?? entry.model ?? "claude-agent/opus#high",
          stderr: summary.stderr ?? "",
        })
        writeFileSync(join(out, `${fileName}.trace.jsonl`), `${trace.lines.join("\n")}\n`)
      }
      console.log(`traced ${files.length} runs of ${iteration} -> ${out}`)
      return
    }
    case "grade": {
      const iteration = opt.iteration ?? "nx6"
      const plugin = opt.plugin ?? "x"
      // The repository's cases and the store's private holdouts, or exactly the directory --cases names.
      const cases = pluginCases(plugin, { dir: opt.cases ?? null })
      const results = gradeAll(iteration, cases, opt.traces ?? tracesDir(iteration, plugin), opt.raw ?? rawRoot(), plugin)
      const summary = batchSummary(iteration, results, cases, plugin)
      const out = opt.out ?? join(storePath(), "results", iteration)
      ensureDir(out)
      write(join(out, "verdicts.json"), json(results))
      write(join(out, "batch.json"), json(summary))
      const counts = results.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {})
      const pct = (value) => (value === null ? "n/a" : `${Math.round(value * 100)}%`)
      console.log(`${iteration}: ${JSON.stringify(counts)}  items ${summary.coverage.items_testable}/${summary.coverage.items_executed} testable, ${summary.coverage.items_blocked} blocked, ${summary.coverage.items_na} n/a  strict ${pct(summary.strict.rate)} of ${summary.strict.runs} run(s), k=${summary.trials.min}${summary.trials.max !== summary.trials.min ? `-${summary.trials.max}` : ""} pass^k ${pct(summary.pass_k.strict)} strict  -> ${out}`)
      return
    }
    case "scorecard": {
      const iteration = opt.iteration ?? "nx6"
      const results = JSON.parse(read(opt.results ?? join(storePath(), "results", iteration, "verdicts.json")))
      const batch = JSON.parse(read(join(storePath(), "results", iteration, "batch.json")))
      const gradingFile = opt.grading ?? (process.env.EVALS_GRADING ?? "")
      const hand = existsSync(gradingFile) ? JSON.parse(read(gradingFile)) : null
      const comparison = hand ? compareToHandGrading(results, hand) : null
      // Every disagreement must carry an authored explanation; the note lives in the case's `## Notes`.
      const notes = {}
      for (const caseObject of pluginCases(opt.plugin ?? batch.case_set?.plugin ?? "x")) {
        for (const note of caseObject.notes ?? []) if (note.id) notes[note.id] = note.text
      }
      const plugin = opt.plugin ?? batch.case_set?.plugin ?? "x"
      const title = readSnapshot(plugin, ROOT)?.name ?? plugin
      const text = renderScorecard({ batch, results, comparison, iteration, notes, title, stale: staleness(batch, plugin) })
      const out = opt.out ?? join(storePath(), "results", iteration, "scorecard.md")
      write(out, text)
      write(join(storePath(), "results", iteration, "scorecard.json"), json({ batch, comparison }))
      console.log(text.split("\n").slice(0, 4).join("\n"))
      console.log(`-> ${out}`)
      return
    }
    case "policy": {
      const a = JSON.parse(read(join(storePath(), "results", opt.a ?? "nx4", "batch.json")))
      const b = JSON.parse(read(join(storePath(), "results", opt.b ?? "nx6", "batch.json")))
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
        `| strict pass (every blocker and major, per run) | ${n.strict.a === null ? "—" : n.strict.a.toFixed(3)} -> ${n.strict.b === null ? "—" : n.strict.b.toFixed(3)} |`,
        `| strict pass^k (cases whose every trial passed) | ${n.passK.a === null ? "—" : n.passK.a.toFixed(3)} -> ${n.passK.b === null ? "—" : n.passK.b.toFixed(3)} (k=${n.trials}) |`,
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
    case "run": {
      const result = await runBatch({
        plugin: opt.plugin,
        iteration: opt.iteration,
        model: opt.model,
        auth: opt.auth,
        cases: opt.cases,
        set: opt.set,
        trials: opt.trials,
        parallel: opt.parallel,
        arm: opt.arm,
        world: opt.world,
        host: opt.host,
        timeout: opt.timeout,
        options: opt.options,
        stale: opt.stale,
        casesDir: opt["cases-dir"],
        dryRun: Boolean(opt["dry-run"]),
        keep: Boolean(opt.keep),
        keepCredentials: Boolean(opt["keep-credentials"]),
        isolation: opt.isolation,
        scripted: Boolean(opt.scripted),
        unsafeNoIsolation: Boolean(opt["unsafe-no-isolation"]),
        append: Boolean(opt.append),
      })
      if (result.results?.some((r) => r.error)) process.exitCode = 1
      return
    }
    case "report": {
      // Arms over trials: strict pass, pass^k, item rates, and a paired bootstrap against the first arm.
      const arms = opt._.map((spec) => {
        const at = spec.indexOf("=")
        if (at < 1) throw new Error(`an arm is <label>=<iteration>[,<iteration>...], not ${JSON.stringify(spec)}`)
        return { label: spec.slice(0, at), iterations: spec.slice(at + 1).split(",").filter(Boolean).map((it) => segment("iteration", it)) }
      })
      if (!arms.length) throw new Error("evals report <label>=<iteration>[,<iteration>...] ...")
      const verdictsOf = (iteration) => {
        const file = join(storePath(), "results", iteration, "verdicts.json")
        if (!existsSync(file)) throw new Error(`not graded: ${iteration} (run evals grade --iteration ${iteration})`)
        return JSON.parse(read(file))
      }
      const loaded = arms.map((arm) => ({ ...arm, results: arm.iterations.map((iteration) => ({ iteration, results: verdictsOf(iteration) })) }))
      const plugin = opt.plugin ?? loaded[0].results[0]?.results.find((r) => r.plugin)?.plugin ?? "x"
      const caseList = pluginCases(plugin)
      const meta = new Map(caseList.map((c) => [c.id, c]))
      const keep = new Set(selectCases(caseList, { patterns: opt.cases ?? "*", set: opt.set ?? "all" }).selected.map((c) => c.id))
      // A time-window case (`Seed: time=day`) asks about the world's day: a run recorded on another UTC day asked a
      // different question, so it is dropped, whatever arm it belongs to.
      let dropped = 0
      const sameDay = (iteration, run) => {
        if (!/(^|\s)time=day(\s|$)/.test(meta.get(run.case)?.seed ?? "")) return true
        const file = join(rawRoot(), iteration, plugin, `${trialName(run.case, run.trial)}.summary.json`)
        if (!existsSync(file)) return true
        const summary = JSON.parse(read(file))
        const worldNow = summary.world?.now ?? summary.corpus_now
        if (!worldNow || !summary.started_at) return true
        return String(summary.started_at).slice(0, 10) === new Date(worldNow).toISOString().slice(0, 10)
      }
      const armsIn = loaded.map((arm) => ({
        label: arm.label,
        iterations: arm.iterations,
        runs: arm.results.flatMap(({ iteration, results }) =>
          results.filter((run) => run.verdict !== "NOT_RUN" && keep.has(run.case)).filter((run) => (sameDay(iteration, run) ? true : (dropped++, false))),
        ),
      }))
      const report = compareArms(armsIn, { allCases: Boolean(opt["all-cases"]), resamples: Number(opt.resamples ?? 5000) })
      if (opt.json) {
        console.log(json({ ...report, rows: report.rows.map(({ byCase: _, ...row }) => row), dropped }))
        return
      }
      console.log(`# report, ${plugin}${opt.set ? ` (set ${opt.set})` : ""}\n`)
      console.log(renderReport(report, { detail: Boolean(opt.detail) }))
      if (dropped) console.log(`\n${dropped} time-window run(s) dropped: recorded on another UTC day than their world's.`)
      return
    }
    case "t0": {
      const root = opt.root ?? pluginRepo("x")
      if (!root) {
        const report = checkPack(readPack("x"), null)
        console.log(opt.json ? json(report) : report.text)
        if (report.failed) process.exitCode = 1
        return
      }
      const report = checkX(root, path("cases", "x"), loadCases("x"))
      console.log(opt.json ? json(report) : report.text)
      if (opt.write) write(path("results", "t0", "x.json"), json(report))
      if (report.failed) process.exitCode = 1
      return
    }
    case "verify": {
      if (opt.all) {
        // Every graded iteration in the store, against the grader and the cases as they are now: no re-grading.
        const root = join(storePath(), "results")
        const rows = (existsSync(root) ? readdirSync(root) : [])
          .filter((name) => existsSync(join(root, name, "batch.json")))
          .sort()
          .map((name) => {
            const batch = JSON.parse(read(join(root, name, "batch.json")))
            const plugin = batch.case_set?.plugin ?? "x"
            return { iteration: name, plugin, why: staleness(batch, plugin) }
          })
        for (const row of rows) console.log(`${row.why.length ? "STALE  " : "current"} ${row.iteration.padEnd(24)} ${row.plugin.padEnd(10)} ${row.why.join(" ")}`)
        const stale = rows.filter((row) => row.why.length).length
        console.log(`\n${rows.length} graded iteration(s), ${stale} stale`)
        if (stale) process.exitCode = 1
        return
      }
      const failures = []
      const iteration = opt.iteration ?? "nx6"
      const summaryFile = join(storePath(), "results", iteration, "batch.json")
      if (!existsSync(summaryFile)) throw new Error(`no batch at ${summaryFile}; run grade first`)
      const previous = JSON.parse(read(summaryFile))
      for (const why of staleness(previous, opt.plugin ?? previous.case_set?.plugin ?? "x")) failures.push(`stale: ${why}`)
      const cases = loadCases(opt.plugin ?? "x")
      const lockFile = path("cases", opt.plugin ?? "x", "evals.lock")
      if (existsSync(lockFile)) {
        const lock = JSON.parse(read(lockFile))
        if (lock.cases_sha256 !== casesDigest(cases)) failures.push(`the case set moved since the lock: ${short(lock.cases_sha256)} -> ${short(casesDigest(cases))}`)
        if (lock.grader_sha256 !== graderHash()) failures.push(`the grader moved since the lock: ${short(lock.grader_sha256)} -> ${short(graderHash())}`)
      } else failures.push("no cases/x/evals.lock")
      const graded = pluginCases(opt.plugin ?? "x")
      const results = gradeAll(iteration, graded, tracesDir(iteration, opt.plugin ?? "x"), undefined, opt.plugin ?? "x")
      const again = batchSummary(iteration, results, graded, opt.plugin ?? "x")
      if (again.batch_sha256 !== previous.batch_sha256) failures.push(`batch digest moved: ${short(previous.batch_sha256)} -> ${short(again.batch_sha256)}`)
      if (canonical(again.coverage) !== canonical(previous.coverage)) failures.push("coverage moved")
      const verdicts = JSON.parse(read(join(storePath(), "results", iteration, "verdicts.json")))
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
    case "pack": {
      // CI has no checkouts: the committed snapshots are verified on their own, which is a real check —
      // schema, digest, counts and the family's invariants. A machine with checkouts also reports drift.
      // Every committed snapshot, and every plugin checkout configuration points at (EVALS_PLUGIN_ROOT, EVALS_REPO_<ID>).
      const ids = opt._.length ? opt._ : allPackIds(ROOT)
      if (!ids.length) throw new Error("no packs to verify: packs/<id>/pack.json is missing")
      let failures = 0
      const drifted = []
      const report = []
      for (const id of ids) {
        if (opt.sync) {
          if (!repoAvailable(id)) {
            console.log(`${id.padEnd(10)} skipped: no checkout (set EVALS_REPO_${id.toUpperCase()} or EVALS_PLUGIN_ROOT)`)
            continue
          }
          const before = readSnapshot(id, ROOT)
          const live = derivePack(id)
          const problems = familyProblems(live)
          if (problems.length && !before) {
            console.log(`${id.padEnd(10)} skipped: not a family pack — ${problems.join("; ")}`)
            continue
          }
          const drift = before ? driftReport(live, before) : null
          const pack = writePack(id)
          if (drift?.drift) console.log(renderDrift(id, drift))
          console.log(`${id.padEnd(10)} ${before ? "synced " : "created"}  tools ${pack.counts.tools} (${pack.counts.reads} read, ${pack.counts.writes} write, ${pack.counts.denied} denied)  skills ${pack.counts.skills}  access ${pack.access?.default ?? "—"}  ${pack.digest.slice(0, 12)}`)
          continue
        }
        if (!readSnapshot(id, ROOT) && repoAvailable(id)) {
          const problems = familyProblems(derivePack(id))
          // A checkout that is not a family plugin has no pack to differ from: named, never counted.
          if (problems.length) {
            report.push(`${id.padEnd(10)} skipped: not a family plugin — ${problems.join("; ")}`)
            continue
          }
          drifted.push(id)
          report.push(`${id.padEnd(10)} no snapshot: \`evals pack --sync ${id}\` creates one`)
          continue
        }
        const verified = verifyFromRepo(id, ROOT)
        failures += verified.ok ? 0 : 1
        if (verified.ok) {
          const pack = JSON.parse(read(join(ROOT, "packs", id, "pack.json")))
          let line = `${id.padEnd(10)} ok  ${String(pack.digest).slice(0, 12)}  tools ${pack.counts?.tools ?? 0}  skills ${pack.counts?.skills ?? 0}  t1 ${(pack.t1 ?? []).length}`
          if (repoAvailable(id)) {
            const drift = driftReport(derivePack(id), pack)
            if (drift.drift) {
              drifted.push(id)
              line += "\n" + renderDrift(id, drift)
            }
          }
          report.push(line)
        } else {
          report.push(`${id.padEnd(10)} FAILED\n  ${verified.problems.join("\n  ")}`)
        }
      }
      console.log(report.join("\n"))
      if (!opt.sync && !failures && drifted.length) {
        console.log(`\n${drifted.length} pack(s) differ from their checkout (${drifted.join(", ")}): \`evals pack --sync\` refreshes a snapshot after review.`)
        if (opt.strict) process.exitCode = 1
      }
      if (failures) process.exitCode = 1
      return
    }
    case "t1": {
      const store = opt.store ?? storePath()
      const ids = opt.plugin ? [opt.plugin] : allPackIds(ROOT).filter((id) => readSnapshot(id, ROOT))
      const versions = opt.versions ? String(opt.versions).split(",") : undefined
      const packs = ids.filter((id) => {
        if (repoAvailable(id)) return true
        console.log(`${id}: skipped, no checkout (set EVALS_REPO_${id.toUpperCase()} or EVALS_PLUGIN_ROOT)`)
        return false
      }).map((id) => ({ ...readPack(id), repo: pluginRepo(id) }))
      const results = await runT1({ packs, store, versions, fakeModule: process.env.EVALS_X_FAKE, log: (line) => console.error(line) })
      const table = coverageTable(results)
      const text = [`# T1 coverage`, "", ...table.lines, "", "`p` pass, `f` fail, `u` unsupported, `—` not run."].join("\n")
      console.log(text)
      write(join(storePath(), "results", "t1", "coverage.md"), text)
      write(join(storePath(), "results", "t1", "coverage.json"), json(results.map((r) => ({ plugin: r.plugin, version: r.version, summary: r.summary, checks: r.checks.map((c) => [c.id, c.state]) }))))
      const failures = results.flatMap((r) => r.checks.filter((c) => c.state === "fail").map((c) => `${r.plugin}@${r.version} ${c.id}: ${c.detail}`))
      if (failures.length) {
        console.log(`\n${failures.length} failing check(s):\n  ${failures.join("\n  ")}`)
        process.exitCode = 1
      }
      return
    }
    case "t0-all": {
      const ids = opt._.length ? opt._ : allPackIds(ROOT).filter((id) => readSnapshot(id, ROOT))
      let failed = 0
      for (const id of ids) {
        const report = checkPack(readPack(id), repoAvailable(id) ? pluginRepo(id) : null)
        failed += report.failed
        console.log(`${id.padEnd(10)} ${report.checks.length} checks, ${report.failed} fail, ${report.warned} warn`)
      }
      if (failed) process.exitCode = 1
      return
    }
    case "privacy": {
      const result = privacyScan({ history: opt["history-only"] ? true : true })
      console.log(opt.json ? json(result) : renderScan(result))
      if (!result.ok) process.exitCode = 1
      return
    }
    case "budget": {
      const store = opt.store ?? storePath()
      const mtd = monthToDate(store)
      if (opt.json) console.log(json({ ...mtd, caps: CAPS, run_caps: loadCaps(store) }))
      else console.log([budgetLine(store), ...runCapLines(store).map((line) => `  ${line}`)].join("\n"))
      return
    }
    case "cost": {
      const store = opt.store ?? storePath()
      const iteration = opt.iteration ?? "nx6"
      const prices = loadPrices()
      const catalog = loadCatalog()
      const mapping = loadMapping()
      const dir = tracesDir(iteration, opt.plugin ?? "x")
      if (!existsSync(dir)) throw new Error(`no traces for ${iteration} in ${store}`)
      let runDate = null
      const rows = []
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".trace.jsonl"))) {
        const lines = read(join(dir, file)).split("\n").filter(Boolean).map((line) => JSON.parse(line))
        const head = lines[0]
        runDate ??= (head.started_at ?? "").slice(0, 10) || null
        const calls = runView(lines).calls.filter((call) => call.via === "execute")
        const vendor = vendorCost(calls, opt.plugin ?? "x", prices)
        const model = runCost({ steps: lines.filter((e) => e.kind === "model_call").map((e) => ({ cost: e.billed_usd, tokens: e.tokens })), model: { provider: head.model?.provider, id: head.model?.id }, catalog, mapping })
        rows.push({ case: head.case, model, vendor })
      }
      const all = totals(rows.map((row) => row.model))
      const vendorTotal = rows.reduce((sum, row) => sum + (row.vendor.amount_usd ?? 0), 0)
      const money = (value) => (value === null || value === undefined ? "missing" : `$${value.toFixed(3)}`)
      const table = [
        `# Cost, ${iteration} (${opt.plugin ?? "x"})`,
        "",
        `- model, billed: **${money(all.billed_usd)}** (${all.billed_runs}/${rows.length} runs reported a cost)`,
        `- model, list: **${money(all.list_usd)}** (${all.list_runs}/${rows.length} resolved in the catalogue)`,
        `- sources: ${Object.entries(all.sources).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}${all.missing_runs ? `; ${all.missing_runs} missing, never counted as $0` : ""}`,
        `- vendor: **${vendorTotal.toFixed(3)}** — ${prices.vendors?.[opt.plugin ?? "x"]?.source ?? "no source"}`,
        `- catalogue: ${catalog.digest ? catalog.digest.slice(0, 12) : "absent"}, fetched ${catalog.fetched_at ?? "never"}`,
        ...(() => {
          const entries = drift(catalog, mapping)
          if (!entries.length) return ["- mapping: none"]
          return entries.map((entry) => {
            const t = trustOf(runDate, entry.asOf)
            const trust = t.trust === "assumed" ? `assumed: ${t.why}` : t.trust === "verified" ? `verified: ${t.why}` : "unknown: ${t.why}"
            return `- mapping: \`${entry.alias}\` → \`${entry.to}\` (asOf ${entry.asOf}; ${trust})${entry.stale ? ` — **STALE**: ${entry.note}` : ""}`
          })
        })(),
        "",
        "| case | billed $ | list $ | source | posts | authors | vendor $ |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...rows.map((row) => `| ${row.case} | ${row.model.billed_usd === null ? "—" : row.model.billed_usd.toFixed(3)} | ${row.model.amount_usd === null ? "missing" : row.model.amount_usd.toFixed(3)} | ${row.model.source} | ${row.vendor.resources?.posts ?? 0} | ${row.vendor.resources?.authors ?? 0} | ${row.vendor.amount_usd === null ? "—" : row.vendor.amount_usd.toFixed(3)} |`),
      ].join("\n")
      console.log(table)
      if (opt.write) write(join(store, "results", iteration, "cost.md"), table)
      return
    }
    case "label": {
      const store = opt.store ?? storePath()
      const plugin = opt.plugin ?? "x"
      const iteration = opt.iteration ?? "nx6"
      if (opt.report) {
        const report = labelReport(store, plugin)
        console.log(json(report))
        return
      }
      const items = advisoryItems(store, plugin, iteration)
      if (opt.list) {
        for (const item of items) console.log(`${item.case}/${item.item} (${item.severity}) ${item.ask.slice(0, 100)}`)
        console.log(`\n${items.length} advisory item(s) in ${iteration}`)
        return
      }
      const rawDir = join(store, "raw", iteration, plugin)
      const textFor = (item) => {
        const file = join(rawDir, `${trialName(item.case, item.trial)}.jsonl`)
        if (!existsSync(file)) return null
        const last = read(file).split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((event) => event.type === "text").pop()
        return last?.part?.text ?? null
      }
      if (opt["dry-run"]) {
        for (const item of items.slice(0, Number(opt.limit ?? 3))) console.log(pageOf(item, textFor(item)))
        return
      }
      const result = await runLabelSession({ store, plugin, iteration, textFor, input: process.stdin, output: process.stdout, limit: opt.limit ? Number(opt.limit) : undefined })
      console.log(`\nlabelled ${result.labelled}, ${result.remaining} left`)
      return
    }
    case "check": {
      const plugin = opt.plugin ?? "x"
      const store = opt.store ?? storePath()
      const repo = repoAvailable(plugin) ? pluginRepo(plugin) : null
      const blockers = []
      console.log(`# check — ${plugin}`)
      const t0 = checkPack(readPack(plugin), repo)
      console.log(`T0: ${t0.checks.length - t0.failed}/${t0.checks.length} pass${t0.failed ? `, ${t0.failed} FAIL` : ""}`)
      for (const check of t0.checks.filter((c) => !c.ok && c.severity === "error")) blockers.push(`T0 ${check.id}: ${check.detail}`)
      const gold = goldCases()
      let goldFailed = 0
      for (const entry of gold) {
        const result = gradeCase(entry.case, runView(entry.trace, { text: entry.text ?? null, state: entry.state ?? null }))
        const ok = result.verdict === entry.expect.verdict && (entry.expect.failed ?? []).every((id) => result.failed.includes(id))
        if (!ok) goldFailed++
      }
      console.log(`T-G: ${gold.length - goldFailed}/${gold.length} gold cases reproduce`)
      for (let i = 0; i < goldFailed; i++) blockers.push(`T-G: ${gold[i].name}`)
      if (process.env.EVALS_SDK_DIR && repo) {
        const packs = [{ ...readPack(plugin), repo }]
        const results = await runT1({ packs, store, versions: [], log: () => {} })
        const checks = results.flatMap((r) => r.checks ?? [])
        const failed = checks.filter((c) => c.state === "fail")
        console.log(`T1: ${checks.filter((c) => c.state === "pass").length}/${checks.length} pass${failed.length ? `, ${failed.length} FAIL` : ""}${checks.length ? "" : " (not configured)"}`)
        for (const check of failed) blockers.push(`T1 ${check.id}: ${check.detail}`)
      } else {
        console.log(`T1: not configured (${repo ? "set EVALS_SDK_DIR" : "no checkout for " + plugin})`)
      }
      console.log(blockers.length ? `\n${blockers.length} blocker(s):\n  ${blockers.join("\n  ")}` : "\nno blockers")
      if (blockers.length) process.exitCode = 1
      return
    }
    default:
      console.log(`unknown command ${JSON.stringify(command)}\n\n${usage()}`)
      process.exitCode = 2
  }
}
