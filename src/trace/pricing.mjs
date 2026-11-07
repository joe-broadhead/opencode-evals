// Cost, derived in the harness, never claimed by a model. A price we do not have is reported as missing,
// not guessed: `source` is provider | table | missing, and a missing price is a fact about the run.

const FIELDS = ["input", "output", "cache_read", "cache_write"]

/**
 * @param {{input:number, output:number, cacheRead:number, cacheWrite:number, reasoning?:number}} tokens
 * @param {string} model
 * @param {{models?: Record<string, Record<string, number|null>>}} table
 */
export function costOf(tokens, model, table = { models: {} }) {
  const entry = table?.models?.[model]
  if (!entry) return { amount_usd: null, currency: "USD", source: "missing", why: `no price table entry for ${model}` }
  if (FIELDS.some((f) => typeof entry[f] !== "number")) {
    return { amount_usd: null, currency: entry.currency ?? "USD", source: "missing", why: `price table entry for ${model} is incomplete` }
  }
  const amount =
    tokens.input * entry.input +
    tokens.output * entry.output +
    (tokens.cacheRead ?? 0) * entry.cache_read +
    (tokens.cacheWrite ?? 0) * entry.cache_write
  return { amount_usd: Math.round(amount * 1e6) / 1e6, currency: entry.currency ?? "USD", source: "table", table_version: entry.version ?? null }
}

/** The rate card is data, and it is empty until the owner supplies it. */
export const emptyTable = () => ({ version: 1, currency: "USD", models: {} })
