// The Charts grading adapter: facts about the charts a run saved, derived from the run's own files, for `state:`
// clauses. It reads every `.chart.json` artifact the run added (the files record holds a text file's content up to
// 64 KB) and states, without the plugin's code, what each one says and what its captured rows add up to.
//
// Everything here is computed independently of the plugin: the group values are recomputed from the artifact's
// captured rows with the aggregate its document names, so a case's expected numbers (worked out by hand from the
// world's fixture) are checked against the data the chart actually holds, not against the compiler's output.
//
// The facts, under `charts.`:
//   count                 artifacts the run saved (a generation each)
//   unreadable            artifacts that were too large, not JSON or not a chart artifact
//   html, svg, png        files of that kind the run wrote
//   recipe, aggregate, theme, mode, target, zoom, brush, legend, tooltip, xType, width, height
//                         the distinct values across the artifacts, sorted and joined with "," ("" when none)
//   binding.<role>        the distinct fields bound to that role, joined
//   has.<fact>.<value>    true when any artifact has that value (`has.target.presentation`); for a fact with a known
//                         set of values (recipe, aggregate, mode, target, zoom, brush, legend, tooltip, xType) every
//                         value is listed, false when no artifact has it, so a "never" claim fails rather than blocks
//   rows.count            the distinct captured row counts, joined
//   rows.same             true when every artifact captured the same rows
//   values.<group>        the recomputed value of one group, when every artifact agrees (`values.North`; a group with a
//                         series is `values.<category>__<series>`, so a fixture's keys are plain names); absent when they disagree, when the recipe draws
//                         one mark per row, or when the document has a data.transform (this adapter does not run
//                         transforms, so it states nothing it cannot recompute)
//   values.agree          false when two artifacts' recomputed values differ
//
// A path a case names that is absent is unverifiable, which blocks its item: the adapter never guesses a fact.

const ARTIFACT = /\.chart\.json$/
const KINDS = { html: /\.html$/, svg: /\.svg$/, png: /\.png$/ }

/** The roles that key one mark of each recipe; recipes that draw one mark per row have none. */
const GROUPS = {
  bar: ["category"],
  horizontal_bar: ["category"],
  pie: ["category"],
  donut: ["category"],
  grouped_bar: ["category", "series"],
  stacked_bar: ["category", "series"],
  line: ["x", "series"],
  area: ["x", "series"],
  stacked_area: ["x", "series"],
  heatmap: ["column", "row"],
}
const MEASURE = { line: "y", area: "y", stacked_area: "y" }

const round = (n) => Math.round(n * 1e6) / 1e6

function aggregate(values, how, count) {
  if (how === "count") return count
  const numbers = values.filter((v) => typeof v === "number" && Number.isFinite(v))
  if (!numbers.length) return null
  if (how === "none") return numbers.length === 1 && count === 1 ? numbers[0] : "repeated"
  if (how === "sum") return round(numbers.reduce((a, b) => a + b, 0))
  if (how === "mean") return round(numbers.reduce((a, b) => a + b, 0) / numbers.length)
  if (how === "min") return Math.min(...numbers)
  if (how === "max") return Math.max(...numbers)
  if (how === "median") {
    const sorted = [...numbers].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
  }
  return null
}

const keyPart = (value) => (value === null || value === undefined ? "null" : String(value))

/** The values a fact can take, where the contract fixes them. */
const DOMAINS = {
  recipe: ["bar", "horizontal_bar", "grouped_bar", "stacked_bar", "line", "area", "stacked_area", "scatter", "bubble", "pie", "donut", "histogram", "box_plot", "heatmap"],
  aggregate: ["none", "sum", "mean", "median", "min", "max", "count"],
  mode: ["light", "dark"],
  target: ["inline", "analysis", "report", "presentation", "paper", "native"],
  zoom: ["none", "x"],
  brush: ["none", "interval"],
  legend: ["static", "highlight"],
  tooltip: ["auto", "off"],
  xType: ["temporal", "quantitative", "ordinal"],
}

/** The recomputed value of each group of one recipe artifact, or null when it states none. */
export function groupValues(document) {
  const chart = document?.chart
  if (!chart || chart.kind !== "recipe") return null
  const roles = GROUPS[chart.recipe]
  if (!roles) return null
  if (Array.isArray(chart.data?.transform) && chart.data.transform.length) return null
  const rows = chart.data?.rows
  if (!Array.isArray(rows)) return null
  const bindings = chart.bindings ?? {}
  const how = chart.options?.aggregate ?? "none"
  const measure = bindings[MEASURE[chart.recipe] ?? "value"]
  const groups = new Map()
  for (const row of rows) {
    const key = roles.filter((role) => bindings[role] !== undefined).map((role) => keyPart(row[bindings[role]])).join("__")
    if (!groups.has(key)) groups.set(key, { values: [], count: 0 })
    const group = groups.get(key)
    group.count += 1
    if (measure !== undefined) group.values.push(row[measure])
  }
  const out = {}
  for (const [key, group] of groups) out[key] = aggregate(group.values, how, group.count)
  return out
}

/** One artifact's facts. */
export function artifactFacts(artifact) {
  const document = artifact.document ?? {}
  const chart = document.chart ?? {}
  const captured = artifact.captured ?? {}
  const layout = document.layout ?? {}
  const interactions = { ...(captured.defaults?.interactions ?? {}), ...(document.interactions ?? {}) }
  const capturedLayout = captured.defaults?.layout ?? {}
  return {
    recipe: chart.kind === "recipe" ? chart.recipe : chart.kind === "engine" ? `engine:${chart.engine ?? "auto"}` : undefined,
    aggregate: chart.kind === "recipe" ? (chart.options?.aggregate ?? "none") : undefined,
    theme: captured.theme?.name ?? document.appearance?.theme,
    mode: captured.theme?.tokens?.mode,
    target: layout.mode === "native" ? "native" : (layout.target ?? capturedLayout.profile),
    width: layout.width ?? capturedLayout.width,
    height: layout.height ?? capturedLayout.height,
    xType: chart.options?.xType,
    zoom: interactions.zoom,
    brush: interactions.brush,
    legend: interactions.legend,
    tooltip: interactions.tooltip,
    bindings: chart.bindings ?? {},
    rows: Array.isArray(chart.data?.rows) ? chart.data.rows : null,
    values: groupValues(document),
  }
}

const joined = (values) => [...new Set(values.filter((v) => v !== undefined && v !== null).map(String))].sort().join(",")

/**
 * The facts of one run, from its files record (`[{path, change, text?}]`), as the `state` a `state:` clause reads.
 * Returns null when there is no files record, so every `state:` clause is unverifiable rather than wrong.
 */
export function chartsState(files) {
  if (!Array.isArray(files)) return null
  const written = files.filter((file) => file.change !== "deleted")
  const facts = []
  let unreadable = 0
  for (const file of written.filter((f) => ARTIFACT.test(f.path))) {
    if (typeof file.text !== "string") {
      unreadable += 1
      continue
    }
    try {
      const artifact = JSON.parse(file.text)
      if (artifact?.format !== "opencode-charts-artifact") {
        unreadable += 1
        continue
      }
      facts.push(artifactFacts(artifact))
    } catch {
      unreadable += 1
    }
  }
  const state = { count: facts.length, unreadable }
  for (const [kind, re] of Object.entries(KINDS)) state[kind] = written.filter((f) => re.test(f.path)).length
  const keys = ["recipe", "aggregate", "theme", "mode", "target", "zoom", "brush", "legend", "tooltip", "xType", "width", "height"]
  state.has = {}
  for (const key of keys) {
    state[key] = joined(facts.map((f) => f[key]))
    state.has[key] = Object.fromEntries([...(DOMAINS[key] ?? []).map((v) => [v, false]), ...facts.map((f) => f[key]).filter((v) => v !== undefined && v !== null).map((v) => [String(v), true])])
  }
  state.binding = {}
  for (const role of [...new Set(facts.flatMap((f) => Object.keys(f.bindings)))]) state.binding[role] = joined(facts.map((f) => f.bindings[role]))
  const rowSets = facts.map((f) => (f.rows ? JSON.stringify(f.rows) : null))
  state.rows = { count: joined(facts.map((f) => f.rows?.length)), same: facts.length > 0 && rowSets.every((r) => r !== null && r === rowSets[0]) }
  const valueSets = facts.map((f) => f.values).filter(Boolean)
  const agree = valueSets.every((v) => JSON.stringify(v) === JSON.stringify(valueSets[0]))
  state.values = valueSets.length && agree ? { ...valueSets[0], agree: true } : { agree: valueSets.length ? false : true }
  return { charts: state }
}
