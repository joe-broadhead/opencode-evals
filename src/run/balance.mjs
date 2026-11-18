// R14: what a batch with a SPENDING plugin may still spend (EVALS-232 §3.2). A "read" that bills (Tavily's search, X's reads, an
// Affinity call against the firm's shared monthly quota, an OpenRouter key's credit) is capped inside a budget checked before every
// batch. Each vendor's use is counted from the ledger (the runs already recorded) and, when a live fetcher is given, from the
// vendor's own balance; the batch is refused when the larger of the two plus what the batch could add would cross the limit.
//
//   limits   `vendors` in caps.json (the owner's): { tavily_credits: 500, affinity_calls: 1000, x_usd: 15, openrouter_usd: 5 }
//   counted  `vendor_use` on each ledger run: { tavily_credits, affinity_calls }, from the run's own tool calls
//   live     { tavily(): credits used, x(): usd spent, openrouter(): usd spent }, supplied by the caller with the round's dedicated keys

/** Credits a Tavily call costs at most, from its published table: a batch is held to the worst case. */
export const TAVILY_CREDITS = Object.freeze({ search: 2, extract: 2, map: 2, crawl: 50, research: 250 })

/** What one recording's tool calls spent: { tavily_credits, affinity_calls } from the names of the inner and direct calls. */
export function vendorUseOf(callNames = []) {
  const use = { tavily_credits: 0, affinity_calls: 0 }
  for (const raw of callNames) {
    const name = String(raw).replace(/^tools\./, "")
    const tavily = /^tavily[._]tavily[._]([a-z]+)|^tavily[._]([a-z]+)$|^tavily_([a-z]+)$/.exec(name)
    if (tavily) use.tavily_credits += TAVILY_CREDITS[tavily[1] ?? tavily[2] ?? tavily[3]] ?? 2
    if (/^affinity[._]/.test(name)) use.affinity_calls += 1
  }
  return use
}

/** The plugins whose reads spend, among those a batch names. */
export const SPENDING = Object.freeze({ tavily: "tavily_credits", affinity: "affinity_calls", x: "x_usd", openrouter: "openrouter_usd", inference: "openrouter_usd" })

/**
 * Checks the batch. `runsByPlugin` is { plugin: planned runs }, `ledger` the entries, `limits` the owner's caps, `live` the fetchers.
 * Returns { ok, lines: [one per spending plugin], refusals: [why] }. A spending plugin with no limit set is refused: a cap that is
 * not written down is not a cap.
 */
export async function checkBalances({ plugins, runsByPlugin = {}, ledger = [], limits = {}, live = {} }) {
  const lines = []
  const refusals = []
  const spent = (field) => ledger.filter((e) => e.kind === "run").reduce((n, e) => n + (e.vendor_use?.[field] ?? 0), 0)
  for (const plugin of [...new Set(plugins)].sort()) {
    const field = SPENDING[plugin]
    if (!field) continue
    const limit = limits[field]
    if (typeof limit !== "number") {
      refusals.push(`${plugin}: no limit for ${field} in caps.json "vendors": a spending plugin runs only under a written cap`)
      continue
    }
    const runs = runsByPlugin[plugin] ?? 0
    let counted = field === "tavily_credits" || field === "affinity_calls" ? spent(field) : 0
    let reported = null
    const fetcher = { tavily_credits: live.tavily, x_usd: live.x, openrouter_usd: live.openrouter }[field]
    if (fetcher) {
      try {
        reported = Number(await fetcher())
        if (!Number.isFinite(reported)) throw new Error("not a number")
      } catch (error) {
        refusals.push(`${plugin}: the vendor's balance could not be read (${String(error.message ?? error).slice(0, 80)}): refusing rather than guessing`)
        continue
      }
    }
    // The larger of what the ledger counted and what the vendor reports is what is used.
    const used = Math.max(counted, reported ?? 0)
    // Worst case for this batch: every planned run spends the plugin's most expensive call once (credits) or one call (a quota).
    const perRun = field === "tavily_credits" ? TAVILY_CREDITS.crawl : field === "affinity_calls" ? 5 : field === "x_usd" ? 0.25 : 0.1
    const projected = used + runs * perRun
    lines.push(`${plugin}: ${field} ${used.toFixed(2)} used${reported !== null ? ` (vendor reports ${reported}, ledger ${counted})` : " (ledger)"}, +${(runs * perRun).toFixed(2)} worst case, of ${limit}`)
    if (projected > limit) refusals.push(`${plugin}: ${field} would reach ${projected.toFixed(2)} of ${limit}`)
  }
  return { ok: refusals.length === 0, lines, refusals }
}
