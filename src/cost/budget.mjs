// D4, enforced in the runner: a hard cap of $25 a month for models and $10 for vendor APIs across the
// family, with the month to date on every scorecard. A run that would cross the cap does not start.
//
// Dollars only see what a provider billed. A subscription bills $0, so the run caps (ledger.mjs) are what stops a
// subscription eval: every run counts against them, priced or not.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ledgerMonth, loadCaps, readLedger, usage } from "./ledger.mjs"

const dollars = (env, name, fallback) => {
  const raw = env[name]
  if (raw === undefined || raw === "") return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a number of dollars, not ${JSON.stringify(raw)}`)
  return value
}

/** The monthly dollar caps, from the environment given (the caller's), strictly: a cap that is not a number is an error. */
export function budgetCaps(env = process.env) {
  return { model_usd: dollars(env, "EVALS_BUDGET_MODEL_USD", 25), vendor_usd: dollars(env, "EVALS_BUDGET_VENDOR_USD", 10) }
}

/** The caps from this process's environment, read when they are used. */
export const CAPS = {
  get model_usd() {
    return budgetCaps().model_usd
  },
  get vendor_usd() {
    return budgetCaps().vendor_usd
  },
  toJSON() {
    return budgetCaps()
  },
}

const monthOf = (iso) => String(iso ?? "").slice(0, 7)

/** Every batch record under the store, newest first, with what it cost and when. */
export function ledger(store) {
  const root = join(store, "results")
  if (!existsSync(root)) return []
  const rows = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name === "batch.json") {
        try {
          const batch = JSON.parse(readFileSync(path, "utf8"))
          rows.push({
            path,
            iteration: batch.iteration ?? null,
            at: batch.ran_at ?? batch.frozen_at ?? null,
            cost: batch.cost ?? { amount_usd: null, source: "missing" },
            vendor: batch.vendor_cost ?? null,
            cases: batch.coverage?.cases_run ?? null,
          })
        } catch {
          // an unreadable record is not a cost
        }
      }
    }
  }
  walk(root)
  return rows.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")))
}

export function monthToDate(store, month = new Date().toISOString().slice(0, 7)) {
  const runs = ledgerMonth(store, month)
  // A batch whose runs the ledger recorded is counted from the ledger, run by run; a batch from before the ledger (or
  // from another runner) is counted from its own record. Never both.
  const rows = ledger(store).filter((row) => monthOf(row.at ?? "") === month && !runs.iterations.includes(row.iteration))
  // Only billed spend consumes the cap; a list-price shadow is reported, never charged.
  const model = rows.reduce((sum, row) => sum + (typeof row.cost?.billed_usd === "number" ? row.cost.billed_usd : 0), 0) + runs.billed_usd
  const shadow = rows.reduce((sum, row) => sum + (typeof row.cost?.list_usd === "number" ? row.cost.list_usd : 0), 0)
  const vendor = rows.reduce((sum, row) => sum + (typeof row.vendor?.amount_usd === "number" ? row.vendor.amount_usd : 0), 0)
  const unknown = rows.filter((row) => row.cost?.amount_usd === null || row.cost?.source === "missing").length + runs.unpriced_runs
  return { month, runs: rows.length + runs.runs, batches: rows.length, ledger_runs: runs.runs, reserved_runs: runs.reserved, model_usd: model, vendor_usd: vendor, shadow_list_usd: shadow, unknown_cost_runs: unknown, priced_runs: runs.priced_runs }
}

/**
 * What `runs` more runs would bill: the month's mean per priced run, or nothing when no run this month was priced.
 * A subscription run is never priced, so its projection is $0: the run cap stops it, not this.
 */
export function projectedSpend(store, runs, month = new Date().toISOString().slice(0, 7)) {
  const month_ = ledgerMonth(store, month)
  if (!month_.priced_runs) return { model_usd: 0, basis: "no priced run this month" }
  const perRun = month_.billed_usd / month_.priced_runs
  return { model_usd: perRun * runs, basis: `$${perRun.toFixed(4)} per run, the month's mean over ${month_.priced_runs} priced run(s)` }
}

/** Throws when a proposed run would cross a cap. A run with unknown prices is allowed but reported. */
export function assertWithinBudget(store, { model_usd = 0, vendor_usd = 0 } = {}, env = process.env) {
  const caps = budgetCaps(env)
  const mtd = monthToDate(store)
  const next = { model_usd: mtd.model_usd + model_usd, vendor_usd: mtd.vendor_usd + vendor_usd }
  if (next.model_usd > caps.model_usd) throw new Error(`D4 budget: model spend would reach $${next.model_usd.toFixed(2)} of $${caps.model_usd} this month`)
  if (next.vendor_usd > caps.vendor_usd) throw new Error(`D4 budget: vendor spend would reach $${next.vendor_usd.toFixed(2)} of $${caps.vendor_usd} this month`)
  return { ...mtd, projected: next, caps }
}

export const budgetLine = (store) => {
  const mtd = monthToDate(store)
  const caps = loadCaps(store)
  const used = usage(readLedger(store), { month: mtd.month, plugin: null, iteration: null })
  return `Month to date (${mtd.month}): $${mtd.model_usd.toFixed(2)} of $${CAPS.model_usd} billed models (a $${mtd.shadow_list_usd.toFixed(2)} list-price shadow is reported and not charged), $${mtd.vendor_usd.toFixed(2)} of $${CAPS.vendor_usd} vendor APIs, ${mtd.runs} run(s)${mtd.unknown_cost_runs ? `, ${mtd.unknown_cost_runs} with a missing price` : ""}. Run cap: ${used.total_month} of ${caps.total_month} runs reserved this month, at most ${caps.per_plugin_month} per plugin.`
}

/** Runs reserved this month, per plugin, against the caps. */
export function runCapLines(store, month = new Date().toISOString().slice(0, 7)) {
  const caps = loadCaps(store)
  const entries = readLedger(store)
  const plugins = [...new Set(entries.filter((entry) => entry.kind === "reserve" && entry.month === month).map((entry) => entry.plugin))].sort()
  return plugins.map((plugin) => `${plugin}: ${usage(entries, { month, plugin, iteration: null }).per_plugin_month} of ${caps.per_plugin_month} runs`)
}
