// Arms compared over trials: strict pass, pass^k, item rates by area, cost in calls, time and tokens, and a paired
// bootstrap over cases for every arm against the first. Pure: the CLI reads the verdicts and hands them in.
//
// The bootstrap's random stream is seeded from the comparison itself (the two arms' iterations and the cases they
// share), never shared across comparisons: one arm's interval does not move when another arm is listed beside it.

import { sha256 } from "../util/canonical.mjs"
import { strictPass } from "../grade/trials.mjs"

/** mulberry32: a small, fast, well-mixed 32-bit generator. Deterministic for a seed. */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const seedOf = (text) => parseInt(sha256(String(text)).slice(0, 8), 16)

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** The mean of per-case differences and its percentile interval over `resamples` resamples of the cases. */
export function pairedBootstrap(diffs, { resamples = 5000, seed = 1, level = 0.95 } = {}) {
  if (!diffs.length) return { n: 0, mean: null, lo: null, hi: null, better: 0, worse: 0, same: 0 }
  const next = rng(seed)
  const draws = new Array(resamples)
  for (let r = 0; r < resamples; r++) {
    let total = 0
    for (let i = 0; i < diffs.length; i++) total += diffs[Math.floor(next() * diffs.length)]
    draws[r] = total / diffs.length
  }
  draws.sort((a, b) => a - b)
  const tail = (1 - level) / 2
  const better = diffs.filter((d) => d > 0).length
  const worse = diffs.filter((d) => d < 0).length
  return { n: diffs.length, mean: mean(diffs), lo: draws[Math.floor(tail * resamples)], hi: draws[Math.min(resamples - 1, Math.floor((1 - tail) * resamples))], better, worse, same: diffs.length - better - worse, resamples, seed }
}

export const areaOf = (id) => (/^[A-Z]+-([A-Z]+)/.exec(id) ?? [])[1] ?? "??"

/** One arm: its runs grouped by case, and its rates. `restrictTo` limits it to a set of case ids. */
export function summarizeArm(arm, restrictTo = null) {
  const byCase = new Map()
  for (const run of arm.runs) {
    if (run.verdict === "NOT_RUN") continue
    if (restrictTo && !restrictTo.has(run.case)) continue
    if (!byCase.has(run.case)) byCase.set(run.case, [])
    byCase.get(run.case).push(run)
  }
  const runs = [...byCase.values()].flat()
  const itemRate = (pred) => {
    const items = runs.flatMap((run) => (run.items ?? []).filter((item) => pred(item) && item.state !== "na" && item.state !== "advisory"))
    return items.length ? items.filter((item) => item.state === "pass").length / items.length : null
  }
  const areas = [...new Set(runs.flatMap((run) => (run.items ?? []).map((item) => areaOf(item.id))))].sort()
  const groups = [...byCase.values()]
  return {
    label: arm.label,
    iterations: arm.iterations,
    byCase,
    runs: runs.length,
    cases: byCase.size,
    trials: groups.length ? { min: Math.min(...groups.map((g) => g.length)), max: Math.max(...groups.map((g) => g.length)) } : { min: 0, max: 0 },
    strict: mean(runs.map((run) => (strictPass(run) ? 1 : 0))),
    blocker: mean(runs.map((run) => (run.verdict === "PASS" ? 1 : 0))),
    passK: { strict: mean(groups.map((g) => (g.every(strictPass) ? 1 : 0))), verdict: mean(groups.map((g) => (g.every((run) => run.verdict === "PASS") ? 1 : 0))) },
    areas: Object.fromEntries(areas.map((area) => [area, itemRate((item) => areaOf(item.id) === area)])),
    outer: mean(runs.map((run) => run.budget?.outer_calls ?? 0)),
    inner: mean(runs.map((run) => run.budget?.inner_calls ?? 0)),
    secs: mean(runs.map((run) => (run.budget?.wall_ms ?? 0) / 1000)),
    tokensK: mean(runs.map((run) => (run.budget?.tokens ?? 0) / 1000)),
  }
}

const caseRate = (summary, id) => {
  const runs = summary.byCase.get(id)
  return runs.filter(strictPass).length / runs.length
}

/** The paired comparison of `b` against `a` on the cases both ran: strict-pass rate per case, b minus a. */
export function compareArms(a, b, { resamples = 5000 } = {}) {
  const ids = [...a.byCase.keys()].filter((id) => b.byCase.has(id)).sort()
  const diffs = ids.map((id) => caseRate(b, id) - caseRate(a, id))
  const seed = seedOf([a.iterations.join(","), b.iterations.join(","), ids.join(",")].join("|"))
  return { a: a.label, b: b.label, cases: ids, ...pairedBootstrap(diffs, { resamples, seed }) }
}

/**
 * Every arm, the per-case table and the comparisons. Rows are compared on the cases every arm ran (unless `allCases`);
 * each comparison against the first arm uses the cases those two arms share, with its own random stream.
 */
export function compare(arms, { allCases = false, resamples = 5000 } = {}) {
  const first = arms.map((arm) => summarizeArm(arm))
  const common = first.length > 1 && !allCases ? new Set([...first[0].byCase.keys()].filter((id) => first.every((s) => s.byCase.has(id)))) : null
  const rows = common ? arms.map((arm) => summarizeArm(arm, common)) : first
  const comparisons = first.slice(1).map((summary) => compareArms(first[0], summary, { resamples }))
  return { rows, common: common ? [...common].sort() : null, comparisons }
}

const pct = (x) => (x === null || x === undefined ? "n/a" : `${Math.round(x * 100)}%`)
const pts = (x) => (x === null || x === undefined ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`)

export function renderReport({ rows, common, comparisons }, { detail = false } = {}) {
  const areas = [...new Set(rows.flatMap((row) => Object.keys(row.areas)))].sort()
  const lines = []
  if (common) lines.push(`Compared on the ${common.length} case(s) every arm ran.`, "")
  lines.push(`| arm | runs | k | strict | strict pass^k | no blocker failed | ${areas.join(" | ")} | calls (out+in) | secs | tokens (k) |`)
  lines.push(`| --- | --- | --- | --- | --- | --- | ${areas.map(() => "---").join(" | ")} | --- | --- | --- |`)
  for (const row of rows) {
    const k = row.trials.min === row.trials.max ? `${row.trials.min}` : `${row.trials.min}-${row.trials.max}`
    lines.push(`| ${row.label} | ${row.runs} | ${k} | ${pct(row.strict)} | ${pct(row.passK.strict)} | ${pct(row.blocker)} | ${areas.map((area) => pct(row.areas[area])).join(" | ")} | ${(row.outer ?? 0).toFixed(1)}+${(row.inner ?? 0).toFixed(1)} | ${(row.secs ?? 0).toFixed(0)} | ${(row.tokensK ?? 0).toFixed(0)} |`)
  }
  if (comparisons.length) {
    lines.push("", `Paired bootstrap over cases, strict-pass rate per case, against \`${rows[0].label}\`:`, "")
    lines.push("| arm | cases | difference | 95% interval | better | worse | same |")
    lines.push("| --- | --- | --- | --- | --- | --- | --- |")
    for (const c of comparisons) lines.push(`| ${c.b} | ${c.n} | ${pts(c.mean)} pts | [${pts(c.lo)}, ${pts(c.hi)}] | ${c.better} | ${c.worse} | ${c.same} |`)
  }
  if (detail || rows.length > 1) {
    const ids = [...new Set(rows.flatMap((row) => [...row.byCase.keys()]))].sort()
    lines.push("", `| case | ${rows.map((row) => row.label).join(" | ")} |`, `| --- | ${rows.map(() => "---").join(" | ")} |`)
    for (const id of ids) {
      const cells = rows.map((row) => {
        const runs = row.byCase.get(id) ?? []
        if (!runs.length) return "—"
        return `${runs.filter(strictPass).length}/${runs.length}${runs.some((run) => run.verdict !== "PASS") ? " !" : ""}`
      })
      lines.push(`| ${id} | ${cells.join(" | ")} |`)
    }
    lines.push("", "A cell is strict passes of trials; `!` marks a case where a blocker failed in some trial.")
  }
  if (detail) {
    const counts = new Map()
    for (const runs of rows[0].byCase.values()) for (const run of runs) for (const item of run.items ?? []) if (item.state === "fail") counts.set(`${run.case}:${item.id}`, (counts.get(`${run.case}:${item.id}`) ?? 0) + 1)
    lines.push("", `Failing items in \`${rows[0].label}\` (trials):`, "")
    for (const [key, n] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) lines.push(`- ${n} ${key}`)
  }
  return lines.join("\n")
}
