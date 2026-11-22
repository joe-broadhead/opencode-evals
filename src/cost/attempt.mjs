// Data-only accounting shared by the legacy runner and parent postmortem reader.
import { listPrice } from "./catalog.mjs"
export function singleAttemptCost(stdout = "", price = null) {
  const parts = []
  for (const line of String(stdout).split("\n")) {
    try { const event = JSON.parse(line); if (event.type === "step_finish") parts.push(event.part ?? {}) } catch { /* partial stream */ }
  }
  const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0
  const receipts = parts.map(p => {
    const valid = number(p.tokens?.input) && number(p.tokens?.output) && number(p.tokens?.cache?.read) && number(p.tokens?.cache?.write)
    const tokens = valid ? { input: p.tokens.input, output: p.tokens.output, cacheRead: p.tokens.cache.read, cacheWrite: p.tokens.cache.write } : null
    return { billed_usd: number(p.cost) ? p.cost : null, tokens, list_usd: tokens && price ? listPrice(tokens, price) : null }
  })
  const known = key => receipts.some(r => r[key] !== null) ? receipts.reduce((n, r) => n + (r[key] ?? 0), 0) : null
  return { receipts, known_billed_usd: known("billed_usd"), known_list_usd: known("list_usd"), receipt_usage_complete: receipts.length > 0 && receipts.every(r => r.tokens !== null), attempt_complete: false, completion_basis: "qualified-native-terminal-unavailable", billed_usd: null, list_usd: null, tokens: null, cost_source: known("billed_usd") === null ? "missing" : "billed-partial", billed_incomplete: true, usage_missing: true }
}
