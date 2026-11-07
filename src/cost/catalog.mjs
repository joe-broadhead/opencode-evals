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

  const alias = mapping[`${providerID}/${bare}`] ?? mapping[`${providerID}/*`]
  if (alias) {
    const [provider, model] = String(alias).split("/")
    const mapped = tryEntry(provider, model)
    if (mapped) return { ...mapped, via: "mapping" }
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

/** The mapping file: an alias to a catalogue id, never a price. Empty when absent. */
export function loadMapping(env = process.env) {
  const path = env.EVALS_MODEL_MAP
  if (!path || !existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return {}
  }
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
