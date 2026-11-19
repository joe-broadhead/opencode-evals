// D4, enforced in the runner: a hard cap of $25 a month for models and $10 for vendor APIs across the
// family, with the month to date on every scorecard. A run that would cross the cap does not start.
//
// Dollars only see what a provider billed. A subscription bills $0, so the run caps (ledger.mjs) are what stops a
// subscription eval: every run counts against them, priced or not.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ledgerMonth, loadCaps, readLedger, usage, outstanding, outstandingList, capsFile } from "./ledger.mjs"
import { loadCatalog, loadMapping, resolve as resolvePrice, listPrice } from "./catalog.mjs"

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

/**
 * What one run of `model` is expected to cost, and how that is known. In order: the month's mean billed cost of the
 * model's priced runs; the catalogue's list price (through the mapping) for the model's mean recorded tokens; an
 * assumption the owner configured (`EVALS_ASSUMED_RUN_USD`, or `assumed_run_usd` in caps.json, a number or a map by
 * model). With none of them the dollar cap cannot be enforced for the run, and that is said, never taken as $0.
 */
export function projectedRunUsd(store, model, env = process.env, month = new Date().toISOString().slice(0, 7)) {
  const runs = readLedger(store).filter((entry) => entry.kind === "run" && entry.month === month && entry.model === model)
  const billed = runs.filter((entry) => typeof entry.billed_usd === "number" && entry.billed_usd > 0)
  if (billed.length) return { usd: billed.reduce((n, e) => n + e.billed_usd, 0) / billed.length, basis: `the month's mean billed over ${billed.length} run(s) of ${model}` }
  const [provider, ...rest] = String(model ?? "").split("/")
  const price = resolvePrice(loadCatalog(env), provider, rest.join("/"), loadMapping(env)).price
  const counted = runs.filter((entry) => entry.tokens && typeof entry.tokens === "object")
  if (price && counted.length) {
    const mean = counted.reduce((n, e) => n + (listPrice(e.tokens, price) ?? 0), 0) / counted.length
    return { usd: mean, basis: `list price for the mean tokens of ${counted.length} run(s) of ${model}` }
  }
  const assumed = env.EVALS_ASSUMED_RUN_USD
  if (assumed !== undefined && assumed !== "") return { usd: dollars(env, "EVALS_ASSUMED_RUN_USD", 0), basis: "assumed (EVALS_ASSUMED_RUN_USD)" }
  const file = capsFile(store, env)
  if (existsSync(file)) {
    const configured = JSON.parse(readFileSync(file, "utf8")).assumed_run_usd
    const value = typeof configured === "number" ? configured : configured?.[model]
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return { usd: value, basis: `assumed (assumed_run_usd in ${file})` }
  }
  return { usd: null, basis: `no price for ${model}: no billed or token-counted run this month, no catalogue price, no EVALS_ASSUMED_RUN_USD or assumed_run_usd` }
}

/**
 * The dollar check for a batch of `runs` at `perRunUsd` each: what the month has billed, plus every batch's reserved
 * runs that have not billed yet, plus this batch, must stay within the cap. With no price for this batch the cap is
 * not enforceable for it: the run caps alone apply, and the result says so.
 */
export function assertBatchWithinBudget(store, { runs, perRunUsd, basis = null }, env = process.env) {
  const caps = budgetCaps(env)
  const committed = monthToDate(store).model_usd
  const pending = outstanding(readLedger(store))
  if (typeof perRunUsd !== "number") return { enforceable: false, committed, outstanding: pending, why: basis ?? "no price for this batch's runs" }
  const next = committed + pending.usd + runs * perRunUsd
  if (next > caps.model_usd) {
    throw new Error(`D4 budget: model spend would reach $${next.toFixed(2)} of $${caps.model_usd} this month ($${committed.toFixed(2)} billed, $${pending.usd.toFixed(2)} reserved by batches still running, $${(runs * perRunUsd).toFixed(2)} for this one)`)
  }
  return { enforceable: true, committed, outstanding: pending, projected: next, caps }
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
  const pending = outstanding(readLedger(store), mtd.month)
  const reserved = pending.runs ? ` Reserved and not yet billed: ${pending.runs} run(s), $${pending.usd.toFixed(2)} expected${pending.unpriced ? `; ${pending.unpriced} of them have no price, so the dollar cap is not enforceable for them and the run caps alone apply` : ""}.` : ""
  return `Month to date (${mtd.month}): $${mtd.model_usd.toFixed(2)} of $${CAPS.model_usd} billed models (a $${mtd.shadow_list_usd.toFixed(2)} list-price shadow is reported and not charged), $${mtd.vendor_usd.toFixed(2)} of $${CAPS.vendor_usd} vendor APIs, ${mtd.runs} run(s)${mtd.unknown_cost_runs ? `, ${mtd.unknown_cost_runs} with a missing price` : ""}.${reserved} Run cap: ${used.total_month} of ${caps.total_month} runs reserved this month, at most ${caps.per_plugin_month} per plugin.`
}

/** Runs reserved this month, per plugin, against the caps. */
export function runCapLines(store, month = new Date().toISOString().slice(0, 7)) {
  const caps = loadCaps(store)
  const entries = readLedger(store)
  const plugins = [...new Set(entries.filter((entry) => entry.kind === "reserve" && entry.month === month).map((entry) => entry.plugin))].sort()
  return plugins.map((plugin) => `${plugin}: ${usage(entries, { month, plugin, iteration: null }).per_plugin_month} of ${caps.per_plugin_month} runs`)
}


// ---------------------------------------------------------------------------------------------------------------- R9
// The round's list-price ceiling. A subscription run bills $0, so the dollar cap above never sees a Claude run; every
// run is therefore also priced at LIST (its tokens against the frozen catalogue, through the model map), the sum goes
// in the ledger, and each LAUNCH checks it: what the round has spent at list price, plus what other batches' reserved
// runs are expected to cost, plus this run and the ones of this batch still running, must stay within the phase ceiling
// (`EVALS_ROUND_CEILING_USD`, the lead sets it per phase) and the hard cap (`EVALS_ROUND_CAP_USD`, or `round_cap_usd` in
// caps.json). A run with no estimate cannot be held to the cap, so while a cap is set it is refused, never taken as $0.

export class RoundCapError extends Error {
  constructor(message) {
    super(message)
    this.name = "RoundCapError"
  }
}

/** The tier a case is priced as: deep for the multi-step and commit sets, wide for the rest. */
export const tierOf = (caseObject) => ((caseObject?.sets ?? []).some((name) => name === "deep" || name === "commit") ? "deep" : "wide")

/** Does a model of this id bill? Everything but the harness's own scripted model (`mock/...`). */
export const isMetered = (model) => !String(model ?? "").startsWith("mock/")

/** The ceiling, the hard cap and the one that binds. `limit` is null when neither is set. */
export function roundLimits(store, env = process.env) {
  const file = capsFile(store, env)
  const fromFile = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
  const ceiling = env.EVALS_ROUND_CEILING_USD !== undefined && env.EVALS_ROUND_CEILING_USD !== "" ? dollars(env, "EVALS_ROUND_CEILING_USD", 0) : null
  const capEnv = env.EVALS_ROUND_CAP_USD !== undefined && env.EVALS_ROUND_CAP_USD !== ""
  const cap = capEnv ? dollars(env, "EVALS_ROUND_CAP_USD", 0) : typeof fromFile.round_cap_usd === "number" ? fromFile.round_cap_usd : null
  const set = [ceiling, cap].filter((value) => value !== null)
  return { ceiling, cap, limit: set.length ? Math.min(...set) : null, binds: ceiling !== null && (cap === null || ceiling <= cap) ? "phase ceiling" : "round cap" }
}

/** What the round has spent at list price: every recorded run's `list_usd`, in every month. */
export function listSpent(store) {
  const runs = readLedger(store).filter((entry) => entry.kind === "run")
  return { usd: runs.reduce((sum, entry) => sum + (typeof entry.list_usd === "number" ? entry.list_usd : 0), 0), runs: runs.length, unpriced: runs.filter((entry) => isMetered(entry.model) && typeof entry.list_usd !== "number").length }
}

/** Runs of a model and tier needed before the measured mean replaces the table's estimate. */
export const MIN_MEASURED_RUNS = 5

/** Runs of a model and tier after which the plain mean replaces the margin. */
export const MEASURED_ENOUGH = 30

/**
 * What one run of `model` at `tier` is expected to cost at list price: the mean of this round's recorded runs once there
 * are enough of them (the pilot's measured means replace the table), else `estimate_run_usd[model][tier]` in caps.json,
 * else `EVALS_ASSUMED_RUN_USD`, else the mean of fewer measured runs. Null when none of them exists.
 */
export function estimateRunUsd(store, model, tier, env = process.env) {
  const runs = readLedger(store).filter((entry) => entry.kind === "run" && entry.model === model && (entry.tier ?? "wide") === tier && typeof entry.list_usd === "number")
  const costs = runs.map((entry) => entry.list_usd).sort((a, b) => a - b)
  const mean = costs.length ? costs.reduce((n, x) => n + x, 0) / costs.length : null
  // A mean of a few runs is a noisy basis for a ceiling: until MEASURED_ENOUGH runs are in, the larger of the mean and the 75th
  // percentile is used (G0 review 3.6), and only then the mean.
  if (mean !== null && costs.length >= MEASURED_ENOUGH) return { usd: mean, basis: `the mean list cost of ${costs.length} recorded ${tier} run(s) of ${model}` }
  if (mean !== null && costs.length >= MIN_MEASURED_RUNS) {
    const p75 = costs[Math.min(costs.length - 1, Math.ceil(0.75 * costs.length) - 1)]
    return { usd: Math.max(mean, p75), basis: `the 75th-percentile list cost of ${costs.length} recorded ${tier} run(s) of ${model} (a margin until ${MEASURED_ENOUGH} are in)` }
  }
  const file = capsFile(store, env)
  const table = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).estimate_run_usd?.[model]?.[tier] : undefined
  if (typeof table === "number" && Number.isFinite(table) && table >= 0) return { usd: table, basis: `estimate_run_usd[${model}][${tier}] in ${file}` }
  if (env.EVALS_ASSUMED_RUN_USD !== undefined && env.EVALS_ASSUMED_RUN_USD !== "") return { usd: dollars(env, "EVALS_ASSUMED_RUN_USD", 0), basis: "assumed (EVALS_ASSUMED_RUN_USD)" }
  if (mean !== null) return { usd: Math.max(mean, costs.at(-1)), basis: `the largest list cost of ${costs.length} recorded ${tier} run(s) of ${model} (fewer than ${MIN_MEASURED_RUNS})` }
  return { usd: null, basis: `no estimate for ${model} at tier ${tier}: no recorded run, no estimate_run_usd entry, no EVALS_ASSUMED_RUN_USD` }
}

/**
 * The per-launch check. Throws RoundCapError (naming the ceiling that binds) when one more run would cross it; returns
 * the projection otherwise. `running` is this batch's runs in flight, `batch` its id (its own reservation is not counted:
 * its runs are checked one by one, here). With no ceiling and no cap set, nothing is checked.
 */
export function assertLaunchWithinRound(store, { model, tier = "wide", running = 0, batch = null }, env = process.env) {
  const limits = roundLimits(store, env)
  // Fail closed (G0 review 1.3): a model that bills (a subscription model bills $0 and still counts at list price) is never launched
  // with no ceiling and no cap to hold it to. Only the harness's own scripted model, which bills nothing, is exempt.
  if (limits.limit === null && !isMetered(model)) return { enforced: false, metered: false }
  if (limits.limit === null) throw new RoundCapError(`no round ceiling or cap is set: cannot hold ${model} to anything. Set EVALS_ROUND_CEILING_USD (the phase's) or EVALS_ROUND_CAP_USD / round_cap_usd in caps.json`)
  const estimate = estimateRunUsd(store, model, tier, env)
  if (estimate.usd === null) throw new RoundCapError(`${limits.binds}: cannot hold ${model} to $${limits.limit}: ${estimate.basis}`)
  const spent = listSpent(store)
  // A recorded run with no list cost (no catalogue price, or no tokens reported) is a hole in the sum, so the cap cannot be trusted.
  if (spent.unpriced > 0) throw new RoundCapError(`${limits.binds}: ${spent.unpriced} recorded run(s) have no list price, so what the round has spent is not known: price them (the model map and the catalogue) before launching more`)
  const others = outstandingList(readLedger(store).filter((entry) => entry.batch !== batch))
  const projected = spent.usd + others.usd + estimate.usd * (running + 1)
  if (projected > limits.limit) {
    throw new RoundCapError(`${limits.binds}: the next ${model} run would take the round to $${projected.toFixed(2)} of $${limits.limit} at list price ($${spent.usd.toFixed(2)} spent over ${spent.runs} run(s), $${others.usd.toFixed(2)} reserved by other batches, $${(estimate.usd * (running + 1)).toFixed(2)} for ${running + 1} run(s) of ${model} at ${estimate.basis})`)
  }
  return { enforced: true, limit: limits.limit, binds: limits.binds, spent: spent.usd, others: others.usd, estimate: estimate.usd, projected, basis: estimate.basis }
}
