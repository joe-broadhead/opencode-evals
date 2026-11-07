// D4, enforced in the runner: a hard cap of $25 a month for models and $10 for vendor APIs across the
// family, with the month to date on every scorecard. A run that would cross the cap does not start.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const CAPS = {
  model_usd: Number(process.env.EVALS_BUDGET_MODEL_USD ?? 25),
  vendor_usd: Number(process.env.EVALS_BUDGET_VENDOR_USD ?? 10),
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
  const rows = ledger(store).filter((row) => monthOf(row.at ?? "") === month)
  // Only billed spend consumes the cap; a list-price shadow is reported, never charged.
  const model = rows.reduce((sum, row) => sum + (typeof row.cost?.billed_usd === "number" ? row.cost.billed_usd : 0), 0)
  const shadow = rows.reduce((sum, row) => sum + (typeof row.cost?.list_usd === "number" ? row.cost.list_usd : 0), 0)
  const vendor = rows.reduce((sum, row) => sum + (typeof row.vendor?.amount_usd === "number" ? row.vendor.amount_usd : 0), 0)
  const unknown = rows.filter((row) => row.cost?.amount_usd === null || row.cost?.source === "missing").length
  return { month, runs: rows.length, model_usd: model, vendor_usd: vendor, shadow_list_usd: shadow, unknown_cost_runs: unknown }
}

/** Throws when a proposed run would cross a cap. A run with unknown prices is allowed but reported. */
export function assertWithinBudget(store, { model_usd = 0, vendor_usd = 0 } = {}) {
  const mtd = monthToDate(store)
  const next = { model_usd: mtd.model_usd + model_usd, vendor_usd: mtd.vendor_usd + vendor_usd }
  if (next.model_usd > CAPS.model_usd) throw new Error(`D4 budget: model spend would reach $${next.model_usd.toFixed(2)} of $${CAPS.model_usd} this month`)
  if (next.vendor_usd > CAPS.vendor_usd) throw new Error(`D4 budget: vendor spend would reach $${next.vendor_usd.toFixed(2)} of $${CAPS.vendor_usd} this month`)
  return { ...mtd, projected: next, caps: CAPS }
}

export const budgetLine = (store) => {
  const mtd = monthToDate(store)
  return `Month to date (${mtd.month}): $${mtd.model_usd.toFixed(2)} of $${CAPS.model_usd} billed models (a $${mtd.shadow_list_usd.toFixed(2)} list-price shadow is reported and not charged), $${mtd.vendor_usd.toFixed(2)} of $${CAPS.vendor_usd} vendor APIs, ${mtd.runs} run(s)${mtd.unknown_cost_runs ? `, ${mtd.unknown_cost_runs} with a missing price` : ""}.`
}
