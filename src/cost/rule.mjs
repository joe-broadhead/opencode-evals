// The owner's cost rule, in one pure function.
//
// Billed beats list, because the provider's own number is the truth when it exists. A provider that reports
// zero on a subscription still consumed tokens, so the catalogue's list price is used and tagged. A model
// the catalogue prices at zero is genuinely free. A model nobody can price is `missing`: never zero, and
// never silently left out of a total.

import { loadCatalog, loadMapping, resolve, listPrice } from "./catalog.mjs"

/**
 * @returns {{amount_usd: number|null, source: "billed"|"list-price"|"free"|"missing", why?: string, price?: object}}
 */
export function classify({ billed, tokens, price }) {
  const hasTokens = (tokens?.input ?? 0) + (tokens?.output ?? 0) + (tokens?.cacheRead ?? 0) + (tokens?.cacheWrite ?? 0) > 0
  if (typeof billed === "number" && billed > 0) return { amount_usd: billed, source: "billed" }
  if (price && price.input === 0 && price.output === 0 && price.cache_read === 0 && price.cache_write === 0) {
    return { amount_usd: 0, source: "free", price }
  }
  if (price && hasTokens) {
    return { amount_usd: listPrice(tokens, price), source: "list-price", price }
  }
  if (price && !hasTokens) return { amount_usd: 0, source: "free", price }
  return {
    amount_usd: null,
    source: "missing",
    why: typeof billed === "number" && billed === 0 ? "the provider billed nothing and the model has no catalogue price" : "no price for this model",
  }
}

/**
 * One recorded run's model cost, from its step costs and its split token counters.
 * @param {{steps: Array<{cost: number|null, tokens: object}>, model: {provider: string, id: string}, catalog?, mapping?}} run
 */
export function runCost({ steps, model, catalog = loadCatalog(), mapping = loadMapping() }) {
  const tokens = steps.reduce(
    (sum, step) => ({
      input: sum.input + (step.tokens?.input ?? 0),
      output: sum.output + (step.tokens?.output ?? 0),
      cacheRead: sum.cacheRead + (step.tokens?.cache?.read ?? step.tokens?.cacheRead ?? 0),
      cacheWrite: sum.cacheWrite + (step.tokens?.cache?.write ?? step.tokens?.cacheWrite ?? 0),
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  )
  const billedSteps = steps.filter((step) => typeof step.cost === "number")
  const billed = billedSteps.length ? billedSteps.reduce((sum, step) => sum + step.cost, 0) : null
  const resolved = resolve(catalog, model.provider, model.id, mapping)
  const verdict = classify({ billed, tokens, price: resolved.price })
  return {
    ...verdict,
    billed_usd: billed,
    billed_steps: billedSteps.length,
    tokens,
    model: `${model.provider}/${model.id}`,
    resolved: resolved.price
      ? { provider: resolved.provider, model: resolved.model, via: resolved.via, price: resolved.price, ...(resolved.mapping ? { mapping: resolved.mapping } : {}) }
      : { source: "missing", why: resolved.why },
    catalog: { digest: catalog.digest, fetched_at: catalog.fetched_at },
  }
}

/**
 * Whether a run's list cost can be trusted: the mapping is a claim dated `asOf`, and a run made before that
 * date was priced by assumption. It is shown with the number, never used to hide it.
 */
export function trustOf(runDate, asOf) {
  if (!runDate || !asOf) return { trust: "unknown", why: "no run date or no mapping date" }
  return runDate < asOf
    ? { trust: "assumed", why: `the run is dated ${runDate}, before the mapping's ${asOf}` }
    : { trust: "verified", why: `the run is dated ${runDate}, on or after the mapping's ${asOf}` }
}

/** Two totals side by side: what the provider charged, and what the catalogue would have charged. */
export function totals(runs) {
  const billed = runs.reduce((sum, run) => sum + (typeof run.billed_usd === "number" ? run.billed_usd : 0), 0)
  const billable = runs.filter((run) => typeof run.billed_usd === "number").length
  const list = runs.reduce((sum, run) => sum + (run.resolved?.price ? listPrice(run.tokens, run.resolved.price) : 0), 0)
  const priced = runs.filter((run) => run.resolved?.price).length
  const sources = {}
  for (const run of runs) sources[run.source] = (sources[run.source] ?? 0) + 1
  return {
    billed_usd: billable ? billed : null,
    billed_runs: billable,
    list_usd: priced ? list : null,
    list_runs: priced,
    missing_runs: runs.filter((run) => run.source === "missing").length,
    free_runs: runs.filter((run) => run.source === "free").length,
    sources,
  }
}
