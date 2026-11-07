// The scorecard: one page per batch, every number with its denominator, and the disagreements with the
// hand grading named item by item. A disagreement without an authored explanation is printed as
// UNEXPLAINED, and `verify` fails on it.

import { budgetLine } from "../cost/budget.mjs"

/** The store a batch was written from: the scorecard is rendered by the CLI, which passes it through. */
const storeOf = (batch) => batch.store ?? process.env.EVALS_STORE ?? new URL("../../../private/store", import.meta.url).pathname

const pct = (value) => (value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`)
const list = (values) => (values && values.length ? values.join(", ") : "—")

const AREA_NAMES = {
  TR: "triggering",
  OC: "outcome",
  PR: "process",
  EF: "efficiency",
  RL: "reliability",
  SF: "safety",
  RB: "robustness",
}

const areaOf = (id) => id.split("-")[1]?.slice(0, 2) ?? "??"

/** My item verdicts against the hand grading's assertion and forbidden verdicts. */
export function compareToHandGrading(results, hand) {
  const handByCase = new Map(hand.map((entry) => [entry.case, entry]))
  const pairs = []
  for (const result of results) {
    const entry = handByCase.get(result.case)
    if (!entry || !result.pairs) continue
    for (const pair of result.pairs) {
      for (const mapping of pair.maps_to) {
        const forbidden = mapping.startsWith("F")
        const index = Number(mapping.slice(1)) - 1
        const source = forbidden ? entry.forbidden ?? [] : entry.assertions ?? []
        const recorded = source[index]
        if (!recorded) continue
        const theirs = forbidden ? (recorded.violated ? "fail" : "pass") : recorded.passed ? "pass" : "fail"
        const mine = pair.mine
        const comparable = mine === "pass" || mine === "fail"
        pairs.push({ case: result.case, item: pair.item, maps_to: mapping, mine, theirs, comparable, recorded: recorded.text })
      }
    }
  }
  const scored = pairs.filter((p) => p.comparable)
  const agree = scored.filter((p) => p.mine === p.theirs).length
  const disagreements = scored.filter((p) => p.mine !== p.theirs)
  const unscored = pairs.filter((p) => !p.comparable)
  // Cohen's kappa over the scored pairs, both classes "fail" being the rare one.
  const n = scored.length
  let kappa = null
  if (n) {
    const observed = agree / n
    const mineFail = scored.filter((p) => p.mine === "fail").length / n
    const theirsFail = scored.filter((p) => p.theirs === "fail").length / n
    const expected = mineFail * theirsFail + (1 - mineFail) * (1 - theirsFail)
    kappa = expected === 1 ? null : (observed - expected) / (1 - expected)
  }
  return { pairs, scored: n, agree, disagreements, unscored, accuracy: n ? agree / n : null, kappa }
}

/** @returns {string} the markdown scorecard */
export function renderScorecard({ batch, results, comparison, iteration, notes = {} }) {
  const lines = []
  const c = batch.coverage
  lines.push(`# X plugin — retroactive scorecard, \`${iteration}\``)
  lines.push("")
  lines.push(`Re-derived by code from the recorded run. Harness \`${batch.harness_version}\`. Case set \`${batch.case_set.cases_sha256.slice(0, 12)}\` (${batch.case_set.cases} cases, ${batch.case_set.items} items, ${Math.round(batch.case_set.coded_share.share * 100)}% code-decided). Grader \`${(batch.grader_sha256 ?? "").slice(0, 12) || "—"}\`. Batch \`${batch.batch_sha256.slice(0, 12)}\`.`)
  lines.push("")
  lines.push(`Coverage: **${c.cases_run}/${c.cases_declared}** cases run · **${c.items_testable}/${c.items_executed}** items testable (${c.items_blocked} blocked, ${c.items_na} n/a, ${c.items_advisory} advisory).`)
  lines.push("")
  lines.push("## Verdicts")
  lines.push("")
  lines.push("| Case | Verdict | Failed items | Blocked | Findings (majors) | n/a |")
  lines.push("| --- | --- | --- | --- | --- | --- |")
  for (const r of results) {
    lines.push(`| ${r.case} | **${r.verdict}** | ${list(r.failed)} | ${list([...(r.blocked ?? []), ...(r.blocked_minor ?? [])])} | ${list(r.findings)} | ${list(r.na)} |`)
  }
  const counts = results.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {})
  lines.push(`| **${results.length} cases** | ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")} | | | | |`)
  lines.push("")
  lines.push("## By axis")
  lines.push("")
  lines.push("| Axis | Items | Passed | Failed | Blocked | n/a |")
  lines.push("| --- | --- | --- | --- | --- | --- |")
  const axes = new Map()
  for (const r of results) {
    for (const item of r.items ?? []) {
      const area = areaOf(item.id)
      const row = axes.get(area) ?? { items: 0, pass: 0, fail: 0, blocked: 0, na: 0, advisory: 0 }
      row.items++
      if (item.state === "pass") row.pass++
      else if (item.state === "fail") row.fail++
      else if (item.state === "blocked") row.blocked++
      else if (item.state === "na") row.na++
      else row.advisory++
      axes.set(area, row)
    }
  }
  for (const [area, row] of [...axes.entries()].sort()) {
    const label = `${AREA_NAMES[area] ?? area}${row.advisory ? ` (${row.advisory} advisory)` : ""}`
    lines.push(`| ${label} | ${row.items} | ${row.pass} | ${row.fail} | ${row.blocked} | ${row.na} |`)
  }
  lines.push("")
  lines.push("## Against the hand grading")
  lines.push("")
  if (!comparison) {
    lines.push("_No grading.json for this iteration._")
  } else {
    lines.push(
      `**${comparison.scored}** item-assertion pairs scored: **${comparison.agree} agree**, **${comparison.disagreements.length} disagree** (accuracy ${pct(comparison.accuracy)}, Cohen's κ ${comparison.kappa === null ? "—" : comparison.kappa.toFixed(2)}). ${comparison.unscored.length} pairs unscored (BLOCKED, n/a or advisory).`,
    )
    lines.push("")
    if (comparison.disagreements.length) {
      lines.push("| Case | Item | Maps to | Mine | Hand | Explanation |")
      lines.push("| --- | --- | --- | --- | --- | --- |")
      for (const d of comparison.disagreements) {
        const why = notes[d.item] ?? "**UNEXPLAINED**"
        lines.push(`| ${d.case} | ${d.item} | ${d.maps_to} | ${d.mine} | ${d.theirs} | ${why} |`)
      }
      lines.push("")
    }
    if (comparison.unscored.length) {
      lines.push(`Unscored: ${comparison.unscored.map((p) => `${p.case}/${p.item} (${p.mine})`).join(", ")}.`)
      lines.push("")
    }
  }
  lines.push("## Cost")
  lines.push("")
  const cost = batch.cost ?? {}
  const money = (value) => (typeof value === "number" ? `$${value.toFixed(3)}` : "missing")
  const mix = Object.entries(cost.sources ?? {}).map(([source, runs]) => `${source} ${runs}`).join(", ") || "none"
  lines.push(`**${batch.tokens.total.toLocaleString()}** tokens across ${batch.tokens.calls} tool calls.`)
  lines.push("")
  lines.push("| What | Amount | How it was decided |")
  lines.push("| --- | --- | --- |")
  lines.push(`| The provider billed | ${money(cost.billed_usd)} | summed from each model call's own \`cost\` field |`)
  lines.push(`| The catalogue would charge | ${money(cost.list_usd)} | tokens × models.dev, resolved per model |`)
  lines.push(`| Classified as | ${mix} | billed > 0 wins; else list-price; zero is free; unknown is missing |`)
  lines.push(`| Vendor | see the cost report | the plugin's own per-resource rates, its own source |`)
  lines.push("")
  lines.push(`Catalogue \`${(cost.catalog?.digest ?? "").slice(0, 12) || "absent"}\`, fetched ${cost.catalog?.fetched_at ?? "never"}. ${cost.missing_runs ? `${cost.missing_runs} run(s) could not be priced: reported, never counted as $0.` : ""}`)
  lines.push("")
  lines.push(budgetLine(batch.store ?? process.env.EVALS_STORE ?? storeOf(batch)))
  lines.push("")
  return lines.join("\n")
}
