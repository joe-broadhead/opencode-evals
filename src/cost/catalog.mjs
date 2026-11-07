// The price catalogue: OpenCode's own models.dev data, read as OpenCode exposes it, with the digest of the
// file it came from. No price is typed into this repository — a model the catalogue does not resolve is
// `missing`, and a model the catalogue prices at zero is genuinely free.

import { readFileSync, existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { sha256 } from "../util/canonical.mjs"

/** Where OpenCode caches models.dev, in the order it looks. Configuration first, then the usual paths. */
export function catalogPath(env = process.env) {
  if (env.EVALS_MODELS_CATALOG) return env.EVALS_MODELS_CATALOG
  const cache = env.XDG_CACHE_HOME ?? join(homedir(), ".cache")
  return join(cache, "opencode", "models.json")
}

export const catalogAvailable = (env) => existsSync(catalogPath(env))

/**
 * The catalogue as `{ providers: { <id>: { models: { <id>: { cost } } } } }`, plus its fingerprint. The file
 * OpenCode writes is already keyed by provider id.
 */
export function loadCatalog(env = process.env) {
  const path = catalogPath(env)
  if (!existsSync(path)) return { providers: {}, digest: null, fetched_at: null, path: null }
  const text = readFileSync(path, "utf8")
  const raw = JSON.parse(text)
  const providers = raw.providers ?? raw
  return {
    providers,
    digest: sha256(text),
    fetched_at: new Date(statSync(path).mtimeMs).toISOString(),
    path,
  }
}

const priceOf = (model) => {
  const cost = model?.cost
  if (!cost || typeof cost !== "object") return null
  const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null)
  const input = number(cost.input)
  const output = number(cost.output)
  if (input === null && output === null) return null
  return {
    // models.dev prices are per million tokens.
    input: input ?? 0,
    output: output ?? 0,
    cache_read: number(cost.cache_read) ?? input ?? 0,
    cache_write: number(cost.cache_write) ?? input ?? 0,
    per: "mtok",
  }
}

/**
 * Resolves a recorded model id to a catalogue entry. The ladder is explicit, and every rung is recorded,
 * because "which model is this" is the one question a price cannot answer on its own:
 *
 *   1. `<provider>/<model>` exactly as recorded;
 *   2. the provider's model, when the recorded provider is an alias named in the mapping file;
 *   3. the model id alone, when exactly one provider prices it;
 *   4. otherwise `missing`, with the reason.
 */
export function resolve(catalog, providerID, modelID, mapping = {}) {
  const providers = catalog.providers ?? {}
  const tryEntry = (provider, model) => {
    const entry = providers[provider]?.models?.[model]
    const price = priceOf(entry)
    return price ? { price, provider, model, via: "exact" } : null
  }

  const bare = String(modelID ?? "").replace(/#.*$/, "")
  const exact = tryEntry(providerID, bare)
  if (exact) return { ...exact, source: "catalog" }

  const entry = mapping[`${providerID}/${bare}`] ?? mapping[`${providerID}/*`]
  const target = targetOf(entry)
  if (target) {
    const [provider, model] = target.to.split("/")
    const mapped = tryEntry(provider, model)
    if (mapped) return { ...mapped, via: "mapping", mapping: { asOf: target.asOf, why: target.why } }
  }

  let match = null
  let count = 0
  for (const [provider, value] of Object.entries(providers)) {
    const price = priceOf(value?.models?.[bare])
    if (!price) continue
    count++
    match = { price, provider, model: bare, via: "model-id" }
  }
  if (count === 1) return { ...match, source: "catalog" }
  return {
    price: null,
    source: "missing",
    why: count > 1 ? `${providerID}/${bare} is ambiguous across ${count} providers` : `no catalogue entry for ${providerID}/${bare}`,
  }
}

/**
 * The mapping file: an alias naming the catalogue id it stands for, never a price. It lives in the
 * repository (`cost/model-map.json`) and `EVALS_MODEL_MAP` can point elsewhere.
 *
 *   { "<provider>/<model>": { "to": "<catalogue provider>/<catalogue model>", "asOf": "YYYY-MM-DD", "why": "…" } }
 */
export function mappingPath(env = process.env) {
  if (env.EVALS_MODEL_MAP) return env.EVALS_MODEL_MAP
  return join(import.meta.dirname, "..", "..", "cost", "model-map.json")
}

export function loadMapping(env = process.env) {
  const path = mappingPath(env)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return {}
  }
}

const targetOf = (entry) => {
  if (typeof entry === "string") return { to: entry, asOf: null, why: null }
  if (entry && typeof entry === "object" && typeof entry.to === "string") return { to: entry.to, asOf: entry.asOf ?? null, why: entry.why ?? null }
  return null
}

/**
 * Alias drift: a mapping is a claim about *which* model an alias meant, made on a date. If the catalogue
 * has released a newer model in the same family since then, the claim is stale — reported, never silently
 * re-priced.
 */
export function drift(catalog, mapping, { provider = "anthropic", family = /opus/i, familyName = "Opus" } = {}) {
  const models = catalog.providers?.[provider]?.models ?? {}
  const released = Object.entries(models)
    .filter(([id, model]) => family.test(id) && model?.release_date)
    .map(([id, model]) => ({ id, release_date: model.release_date }))
    .sort((a, b) => a.release_date.localeCompare(b.release_date))
  const newest = released[released.length - 1] ?? null
  const out = []
  for (const [alias, entry] of Object.entries(mapping ?? {})) {
    const target = targetOf(entry)
    if (!target) continue
    const stale = Boolean(newest && target.asOf && newest.release_date > target.asOf)
    out.push({
      alias,
      to: target.to,
      asOf: target.asOf,
      why: target.why,
      newest: newest ? `${provider}/${newest.id}` : null,
      newest_release: newest?.release_date ?? null,
      stale,
      note: stale ? `the mapping is dated ${target.asOf} but ${provider}/${newest.id} was released ${newest.release_date}: the alias may mean a newer ${familyName}. Re-confirm the mapping; nothing was re-priced.` : null,
    })
  }
  return out
}

/** What one model call cost at list price: the split counters against the catalogue's rate card. */
export function listPrice(tokens, price) {
  if (!price) return null
  const amount =
    (tokens.input ?? 0) * price.input +
    (tokens.output ?? 0) * price.output +
    (tokens.cacheRead ?? 0) * price.cache_read +
    (tokens.cacheWrite ?? 0) * price.cache_write
  return amount / 1_000_000
}
