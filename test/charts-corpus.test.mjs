import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { gradeCase, runView } from "../src/grade/grade.mjs"
import { chartsState, groupValues } from "../src/grade/adapters/charts.mjs"
import { adapterState } from "../src/grade/adapters/index.mjs"
import { selectCases } from "../src/case/sets.mjs"

// The Charts task corpus (cases/charts) and its grading adapter, with no model: the adapter's facts from a run's saved
// artifacts, and each case graded against a hand-built good run and bad run, so a case cannot pass vacuously.

const ROOT = join(import.meta.dirname, "..")
const DIR = join(ROOT, "cases", "charts")
const CASES = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "pack.json").map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")))
const byId = (id) => CASES.find((c) => c.id === id)

const head = { schema: "oc-trace/1", run_id: "charts/1", case: "t", exit: 0, failure_class: null, duration_ms: 1000, summary: { steps: 2, tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, cost: { amount_usd: null, source: "missing" }, text: { sha256: "0".repeat(64) } } }
const SCOPE = { ns: "charts", tools: new Set(["render", "quick", "validate", "update", "recommend", "capabilities", "catalogue", "themes", "theme_save"]) }

/** A run: its chart tool calls (inner calls of `execute`), the answer, and the files it wrote. */
function run({ calls = [], text = "", files = [] } = {}) {
  const events = []
  let seq = 1
  for (const c of calls) {
    events.push({ seq: seq++, kind: "tool_call", tool: c.tool, ns: c.ns ?? "charts", via: "execute", args: {}, args_parsed: true })
    events.push({ seq: seq++, kind: "tool_result", tool: c.tool, for_seq: seq - 2, status: "ok" })
  }
  const rawArgs = calls.map((c) => c.args ?? {})
  return runView([JSON.stringify(head), ...events.map((e) => JSON.stringify(e))], { text, files, state: adapterState("charts", files), scope: SCOPE, rawArgs, checkable: ["document", "data", "patch", "expectedRevision", "formats", "theme", "name"] })
}

const SALES = (() => {
  const out = []
  const rev = { North: [[100, 110, 120], [50, 60, 70]], South: [[80, 85, 90], [40, 45, 50]], East: [[60, 65, 70], [30, 35, 40]], West: [[40, 42, 44], [20, 22, 24]] }
  for (const [region, [online, store]] of Object.entries(rev)) for (let i = 0; i < 3; i++) out.push({ region, month: `2024-0${i + 1}-01`, channel: "Online", revenue_eur: online[i] }, { region, month: `2024-0${i + 1}-01`, channel: "Store", revenue_eur: store[i] })
  return out
})()
const CHANGED = SALES.map((row) => (row.region === "North" && row.channel === "Online" ? { ...row, revenue_eur: 1000 } : row))

/** A saved artifact as the plugin writes it (the fields the adapter reads). */
const artifact = ({ recipe = "bar", rows = SALES, bindings = { category: "region", value: "revenue_eur" }, options = { aggregate: "sum" }, theme = "light", mode = theme === "dark" ? "dark" : "light", layout, interactions, profile = "inline", width = 720, height = 420 } = {}) => ({
  format: "opencode-charts-artifact",
  version: 1,
  revision: `sha256:${"a".repeat(64)}`,
  document: { version: 1, chart: { kind: "recipe", recipe, data: { rows }, bindings, options }, ...(layout ? { layout } : {}), ...(interactions ? { interactions } : {}) },
  captured: { theme: { name: theme, tokens: { mode } }, defaults: { layout: { profile, width, height }, interactions: { tooltip: "auto", legend: "static", zoom: "none", brush: "none" } } },
})
const saved = (path, a) => ({ path, change: "added", text: JSON.stringify(a) })

test("the adapter recomputes group values from the captured rows with the document's aggregate", () => {
  const sums = groupValues(artifact().document)
  assert.deepEqual(sums, { North: 510, South: 390, East: 300, West: 192 })
  assert.equal(groupValues(artifact({ options: { aggregate: "mean" } }).document).North, 85)
  assert.equal(groupValues(artifact({ options: { aggregate: "count" } }).document).North, 6)
  assert.equal(groupValues(artifact({ options: {} }).document).North, "repeated")
  assert.deepEqual(groupValues(artifact({ recipe: "grouped_bar", bindings: { category: "region", series: "channel", value: "revenue_eur" } }).document).North__Online, 330)
  // A transform it cannot run, and a recipe of one mark per row, state no values rather than wrong ones.
  assert.equal(groupValues({ chart: { kind: "recipe", recipe: "bar", data: { rows: SALES, transform: [{ filter: "true" }] }, bindings: { category: "region", value: "revenue_eur" }, options: { aggregate: "sum" } } }), null)
  assert.equal(groupValues(artifact({ recipe: "scatter", bindings: { x: "revenue_eur", y: "revenue_eur" }, options: {} }).document), null)
})

test("the adapter's facts: counts, distinct values, every known value listed, agreement across generations", () => {
  const state = chartsState([saved("outputs/charts/a-1/a.chart.json", artifact()), saved("outputs/charts/a-2/a.chart.json", artifact({ theme: "dark", layout: { target: "presentation" }, profile: "presentation", width: 1280, height: 720 })), { path: "outputs/charts/a-2/a.svg", change: "added" }]).charts
  assert.equal(state.count, 2)
  assert.equal(state.svg, 1)
  assert.equal(state.theme, "dark,light")
  assert.equal(state.has.target.presentation, true)
  assert.equal(state.has.zoom.x, false)
  assert.equal(state.width, "1280,720")
  assert.equal(state.rows.same, true)
  assert.equal(state.values.North, 510)
  assert.equal(chartsState(null), null)
  assert.equal(chartsState([{ path: "x.chart.json", change: "added" }]).charts.unreadable, 1)
  const disagree = chartsState([saved("a.chart.json", artifact()), saved("b.chart.json", artifact({ rows: CHANGED }))]).charts
  assert.equal(disagree.values.agree, false)
  assert.equal(disagree.values.North, undefined)
})

test("the corpus: 13 tasks in corpus (7 create, 6 revise) and 2 scripted probes, every item decided by code", () => {
  const ids = (set) => selectCases(CASES, { set }).selected.map((c) => c.id)
  assert.equal(ids("corpus").length, 13)
  assert.equal(ids("create").length, 7)
  assert.equal(ids("revise").length, 6)
  assert.deepEqual(ids("scripted"), ["scripted-probe-document", "scripted-probe-refusal"])
  for (const c of CASES) for (const item of c.items) assert.equal(item.grader, "code", `${c.id} ${item.id}`)
  for (const id of ["long-labels-narrow", "explicit-aggregation", "ambiguous-aggregation", "count-vs-measure", "malformed-field-names", "brand-theme", "light-to-dark", "inline-presentation-inline", "add-zoom", "add-scatter-brush", "unsupported-pie-zoom", "changed-csv-cosmetic", "empty-data"]) assert.ok(byId(id), id)
})

test("a run that did nothing fails every corpus task: none passes or blocks vacuously", () => {
  for (const c of selectCases(CASES, { set: "corpus" }).selected) {
    const graded = gradeCase(c, run({ text: "Sure." }))
    assert.equal(graded.verdict, "FAIL", `${c.id}: ${graded.verdict} ${JSON.stringify(graded.blocked)}`)
  }
})

test("explicit-aggregation: summed per region passes; a mean, or no aggregate, fails", () => {
  const c = byId("explicit-aggregation")
  const quick = { tool: "quick", args: { document: artifact().document } }
  assert.equal(gradeCase(c, run({ calls: [quick], files: [saved("outputs/charts/r-1/r.chart.json", artifact())] })).verdict, "PASS")
  assert.equal(gradeCase(c, run({ calls: [quick], files: [saved("outputs/charts/r-1/r.chart.json", artifact({ options: { aggregate: "mean" } }))] })).verdict, "FAIL")
})

test("changed-csv-cosmetic: an update on the captured rows passes; a redraw from the changed file fails", () => {
  const c = byId("changed-csv-cosmetic")
  const good = run({ calls: [{ tool: "update", args: { patch: { layout: { target: "presentation" } } } }], files: [saved("outputs/charts/r-2/r.chart.json", artifact({ layout: { target: "presentation" }, profile: "presentation", width: 1280, height: 720 }))] })
  assert.equal(gradeCase(c, good).verdict, "PASS")
  const redrawn = run({ calls: [{ tool: "quick", args: {} }], files: [saved("outputs/charts/r-3/r.chart.json", artifact({ rows: CHANGED, layout: { target: "presentation" } }))] })
  const graded = gradeCase(c, redrawn)
  assert.equal(graded.verdict, "FAIL")
  assert.ok(graded.failed.includes("C-OC02") && graded.failed.includes("C-SF01"))
})

test("inline-presentation-inline: two updates to 1280 and 720 with the same rows pass", () => {
  const c = byId("inline-presentation-inline")
  const files = [saved("outputs/charts/r-2/r.chart.json", artifact({ layout: { target: "presentation" }, profile: "presentation", width: 1280, height: 720 })), saved("outputs/charts/r-3/r.chart.json", artifact({ layout: { target: "inline" } }))]
  assert.equal(gradeCase(c, run({ calls: [{ tool: "update" }, { tool: "update" }], files })).verdict, "PASS")
  assert.equal(gradeCase(c, run({ calls: [{ tool: "update" }], files: files.slice(0, 1) })).verdict, "FAIL")
})

test("unsupported-pie-zoom: saying it is unsupported passes; a saved zoom or a claim of one fails", () => {
  const c = byId("unsupported-pie-zoom")
  assert.equal(gradeCase(c, run({ text: "Zoom isn't supported on a pie chart: it is only for temporal line and area charts. A bar chart would work instead." })).verdict, "PASS")
  assert.equal(gradeCase(c, run({ text: "Done, I added zoom to the pie.", files: [saved("o/p.chart.json", artifact({ recipe: "pie", interactions: { zoom: "x" } }))] })).verdict, "FAIL")
})

test("empty-data: reporting the empty file passes; drawing anything fails", () => {
  const c = byId("empty-data")
  assert.equal(gradeCase(c, run({ text: "data/signups.csv has only a header and no rows, so there is nothing to chart." })).verdict, "PASS")
  assert.equal(gradeCase(c, run({ text: "The data is empty, so here is a sample.", files: [{ path: "outputs/charts/s.svg", change: "added" }] })).verdict, "FAIL")
})

test("long-labels-narrow: a filtering transform fails C-SF01 through charts_quick and through charts_render", () => {
  const c = byId("long-labels-narrow")
  const files = [saved("outputs/charts/t-1/t.chart.json", artifact({ rows: SALES.slice(0, 8), bindings: { category: "region", value: "revenue_eur" }, layout: { width: 360, height: 480 }, width: 360, height: 480 }))]
  const transform = [{ filter: "datum.revenue_eur > 50" }]
  for (const call of [
    { tool: "quick", args: { document: { chart: { data: { path: "data/support_tickets.csv", transform } } } } },
    { tool: "render", args: { document: { chart: { data: { path: "data/support_tickets.csv", transform } } } } },
    { tool: "render", args: { spec: {}, data: { path: "data/support_tickets.csv", transform } } },
  ]) assert.ok(gradeCase(c, run({ calls: [call], files })).failed.includes("C-SF01"), call.tool)
  assert.ok(!gradeCase(c, run({ calls: [{ tool: "quick", args: { document: { chart: { data: { path: "data/support_tickets.csv" } } } } }], files })).failed.includes("C-SF01"))
})

test("joined facts are strings: good runs of add-zoom, add-scatter-brush and long-labels-narrow pass", () => {
  const line = { recipe: "line", rows: Array.from({ length: 60 }, (_, i) => ({ date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`, active_users: i })), bindings: { x: "date", y: "active_users" }, options: { xType: "temporal" }, interactions: { zoom: "x" } }
  const zoom = run({ calls: [{ tool: "update" }], text: "Open outputs/charts/d-2/d.html", files: [saved("outputs/charts/d-2/d.chart.json", artifact(line)), { path: "outputs/charts/d-2/d.html", change: "added" }] })
  assert.equal(gradeCase(byId("add-zoom"), zoom).verdict, "PASS")
  assert.deepEqual(gradeCase(byId("add-zoom"), zoom).failed, [])
  const scatter = { recipe: "scatter", rows: Array.from({ length: 12 }, (_, i) => ({ spend_k: i, conversions: i, channel: "Search" })), bindings: { x: "spend_k", y: "conversions", series: "channel" }, options: {}, interactions: { brush: "interval" } }
  const brush = run({ calls: [{ tool: "update" }], files: [saved("outputs/charts/s-2/s.chart.json", artifact(scatter)), { path: "outputs/charts/s-2/s.html", change: "added" }] })
  assert.deepEqual(gradeCase(byId("add-scatter-brush"), brush).failed, [])
  const tickets = Array.from({ length: 8 }, (_, i) => ({ category: `c${i}`, tickets: i }))
  const narrow = run({ calls: [{ tool: "quick", args: { document: { chart: { data: { path: "data/support_tickets.csv" } } } } }], files: [saved("outputs/charts/t-1/t.chart.json", artifact({ rows: tickets, bindings: { category: "category", value: "tickets" }, options: {}, layout: { width: 360, height: 480 }, width: 360, height: 480 }))] })
  assert.deepEqual(gradeCase(byId("long-labels-narrow"), narrow).failed, [])
  const wider = run({ calls: [{ tool: "quick" }], files: [saved("outputs/charts/t-1/t.chart.json", artifact({ rows: tickets, bindings: { category: "category", value: "tickets" }, options: {}, layout: { width: 380, height: 480 }, width: 380, height: 480 }))] })
  assert.deepEqual(gradeCase(byId("long-labels-narrow"), wider).failed, ["C-OC01"])
})
