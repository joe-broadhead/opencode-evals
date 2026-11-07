// The hand-label kit: shows one advisory item at a time with the evidence it needs, takes a one-key label,
// and appends it. It prepares the calibration set — it never labels anything itself, and it never guesses
// when the evidence is not there (that is `u`).
//
// Sized for the owner: one screen per item, the answer span quoted, no scrolling, so 120 labels fit in
// well under an hour (about 25 seconds each).

import { createInterface } from "node:readline"
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { redactEvidence } from "../trace/redact.mjs"

const KEYS = { y: "satisfied", n: "violated", u: "unknown", s: "skip", q: "quit" }

/** Every advisory item instance in a graded batch, with what a label needs. */
export function advisoryItems(store, plugin, iteration) {
  const verdicts = join(store, "results", iteration, "verdicts.json")
  if (!existsSync(verdicts)) return []
  const cases = new Map()
  const caseDir = join(import.meta.dirname, "..", "..", "cases", plugin)
  if (existsSync(caseDir)) {
    for (const file of readdirSync(caseDir).filter((f) => f.endsWith(".json"))) {
      const parsed = JSON.parse(readFileSync(join(caseDir, file), "utf8"))
      cases.set(parsed.id, parsed)
    }
  }
  const out = []
  for (const result of JSON.parse(readFileSync(verdicts, "utf8"))) {
    if (result.verdict === "NOT_RUN") continue
    const caseObject = cases.get(result.case)
    for (const item of result.items ?? []) {
      if (item.state !== "advisory") continue
      const source = caseObject?.items.find((entry) => entry.id === item.id)
      out.push({
        plugin,
        iteration,
        case: result.case,
        item: item.id,
        severity: item.severity,
        ask: source?.ask ?? item.id,
        note: source?.note ?? null,
        context: (result.items ?? []).filter((entry) => entry.state === "pass" || entry.state === "fail").slice(0, 3).map((entry) => `${entry.id} ${entry.state}`),
      })
    }
  }
  return out
}

export const labelsPath = (store, plugin) => join(store, "labels", `${plugin}.jsonl`)

export function readLabels(store, plugin) {
  const file = labelsPath(store, plugin)
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

export function recordLabel(store, entry) {
  mkdirSync(join(store, "labels"), { recursive: true })
  appendFileSync(labelsPath(store, entry.plugin), `${JSON.stringify(entry)}\n`)
}

/** The page for one item: the ask, the answer span it is about, and the code-graded context. */
export function pageFor(item, { text }) {
  const last = String(text ?? "")
    .split("\n")
    .filter((line) => line.trim())
    .slice(-2)
    .join(" / ")
  const span = redactEvidence(last).slice(0, 220)
  return [
    `${item.item}  ${item.case}  (${item.severity})`,
    `  ${item.ask}`,
    span ? `  answer: ${span}` : "  answer: (not available in this store)",
    `  graded: ${item.context.join(", ")}`,
    item.note ? `  note: ${item.note.slice(0, 160)}` : "",
    "  [y] satisfied  [n] violated  [u] unknown  [s] skip  [q] quit",
  ]
    .filter(Boolean)
    .join("\n")
}

/** Interactive labelling. `input` and `output` are injectable so the flow can be tested end to end. */
export async function runLabelSession({ store, plugin, iteration, textFor = () => null, input, output, limit }) {
  const items = advisoryItems(store, plugin, iteration)
  const done = new Set(readLabels(store, plugin).map((label) => `${label.iteration}/${label.case}/${label.item}`))
  const queue = items.filter((item) => !done.has(`${item.iteration}/${item.case}/${item.item}`)).slice(0, limit ?? Infinity)
  if (!queue.length) {
    output.write(`nothing to label for ${plugin} in ${iteration}: ${items.length} advisory item(s), all labelled\n`)
    return { labelled: 0, remaining: 0 }
  }
  const rl = createInterface({ input, output, terminal: false })
  let labelled = 0
  const ask = () => new Promise((resolve) => rl.question("> ", (answer) => resolve(answer.trim().toLowerCase())))
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index]
    output.write(`\n[${index + 1}/${queue.length}] ${pageFor(item, { text: textFor(item) })}\n`)
    const answer = await ask()
    if (answer === "q") break
    const label = KEYS[answer]
    if (!label || label === "skip") continue
    recordLabel(store, { plugin: item.plugin, iteration: item.iteration, case: item.case, item: item.item, label, at: new Date().toISOString() })
    labelled++
  }
  rl.close()
  return { labelled, remaining: queue.length - labelled }
}

/** What is labelled, per item: the counts a kappa calculation will consume. */
export function labelReport(store, plugin) {
  const labels = readLabels(store, plugin)
  const byItem = {}
  for (const label of labels) {
    byItem[label.item] ??= { satisfied: 0, violated: 0, unknown: 0 }
    byItem[label.item][label.label] = (byItem[label.item][label.label] ?? 0) + 1
  }
  return { total: labels.length, items: Object.keys(byItem).length, byItem }
}
