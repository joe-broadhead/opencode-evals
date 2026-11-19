// `--auth <source>+profile` (R2, EVALS-232 §1.2.5): the vendor credentials of the evals profile, given to a trial as an
// ALLOW-LIST of fields and nothing else.
//
// The profile is exported once per batch with the evals profile's own environment (never the owner's real profile), each
// credential cut down to the fields below, and imported into every trial's own private server. The minimum was found by probe
// P0-5 on OpenCode 2.3.2: an oauth credential needs `type`, `methodID`, `access`, `expires` AND a `refresh` (the import refuses
// one without), so the refresh token is replaced by a constant placeholder: a trial can use its access token, and cannot
// refresh the real chain. An API key is `{ type: "key", key }`. Import merges: it adds to what the trial already holds.
//
// Dropped: the refresh token, client secrets, `metadata.login`, account labels, and every field not named here. `label` becomes
// the constant `evals`, and `id` is regenerated.

import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { runToEnd } from "./sandbox.mjs"
import { ensureServicePort, assertDistinctPort } from "./service-port.mjs"

/** What a trial gets in place of a refresh token: import insists on one, and no vendor accepts this. */
export const REFRESH_PLACEHOLDER = "evals-no-refresh"

const METADATA_KEYS = ["serverUrl", "tokenType", "scope", "issuer"]

/** The environment of the evals profile: its own HOME and XDG tree, an empty `.claude`, Claude Code off, nothing of the caller's. */
export function profileEnv(dir, base = process.env) {
  const env = {}
  for (const key of ["PATH", "LANG", "TZ", "TERM"]) if (base[key]) env[key] = base[key]
  Object.assign(env, {
    HOME: dir,
    OPENCODE_TEST_HOME: dir,
    XDG_CONFIG_HOME: join(dir, ".config"),
    XDG_DATA_HOME: join(dir, ".local", "share"),
    XDG_CACHE_HOME: join(dir, ".cache"),
    XDG_STATE_HOME: join(dir, ".local", "state"),
    CLAUDE_CONFIG_DIR: join(dir, ".claude"),
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
  })
  return env
}

/** One exported credential cut to the allow-list, or null when its type is not one a trial may hold. */
export function allowListed(credential) {
  const value = credential?.value
  if (!credential || typeof credential.integrationID !== "string" || !value || typeof value !== "object") return null
  const out = { id: `cred_${randomBytes(12).toString("hex")}`, integrationID: credential.integrationID, label: "evals", active: credential.active !== false }
  if (value.type === "oauth") {
    if (typeof value.access !== "string" || !value.access) return null
    const metadata = {}
    for (const key of METADATA_KEYS) if (typeof value.metadata?.[key] === "string") metadata[key] = value.metadata[key]
    if (typeof value.metadata?.client?.client_id === "string") metadata.client = { client_id: value.metadata.client.client_id }
    out.value = { type: "oauth", methodID: String(value.methodID ?? "mcp-oauth"), access: value.access, refresh: REFRESH_PLACEHOLDER, expires: typeof value.expires === "number" ? value.expires : null, ...(Object.keys(metadata).length ? { metadata } : {}) }
    if (out.value.expires === null) delete out.value.expires
    return out
  }
  if (value.type === "key") {
    if (typeof value.key !== "string" || !value.key) return null
    out.value = { type: "key", key: value.key }
    return out
  }
  if (value.type === "external") {
    out.value = { type: "external", methodID: String(value.methodID ?? "") }
    return out
  }
  return null
}

/** The secrets of an allow-listed credential: its access token or key. */
export const secretsOf = (credential) => [credential?.value?.access, credential?.value?.key].filter((v) => typeof v === "string" && v.length >= 8)

/**
 * The credentials a batch may hold: the evals profile's export, allow-listed, for the integrations `needed` names (the arm's and the
 * seeded plugins'). Throws for a needed integration the profile lacks, and for one whose access token expires inside the batch.
 * Returns { list, secrets, expiries: { <integration>: ms|null }, dropped: [integration] }.
 */
export function vendorCredentials(exportedJson, { needed, now = Date.now(), horizonMs = 0, acceptUnknownExpiry = false }) {
  let all
  try {
    all = JSON.parse(exportedJson)
  } catch {
    throw new Error("the evals profile's export is not JSON")
  }
  if (!Array.isArray(all)) all = all?.credentials ?? []
  const want = new Set(needed)
  const list = []
  const expiries = {}
  const dropped = []
  for (const credential of all) {
    if (!want.has(credential?.integrationID)) {
      if (credential?.integrationID) dropped.push(credential.integrationID)
      continue
    }
    const cut = allowListed(credential)
    if (!cut) {
      dropped.push(credential.integrationID)
      continue
    }
    list.push(cut)
    // Only an oauth token expires: an API key has no expiry to check the batch against.
    if (cut.value.type === "oauth") expiries[cut.integrationID] = cut.value.expires ?? null
  }
  const missing = [...want].filter((id) => !list.some((c) => c.integrationID === id))
  if (missing.length) throw new Error(`--auth +profile: the evals profile holds no usable credential for ${missing.join(", ")} (it holds ${[...new Set(all.map((c) => c?.integrationID).filter(Boolean))].join(", ") || "none"}); sign it in, or leave the plugin out of the batch`)
  const margin = 10 * 60_000
  for (const [integration, expires] of Object.entries(expiries)) {
    if (expires === null) {
      if (!acceptUnknownExpiry) throw new Error(`--auth +profile: the ${integration} credential has no expiry, so the batch cannot be checked against it; pass --accept-unknown-token-expiry if something keeps it fresh (the keeper does)`)
    } else if (expires - now < horizonMs + margin) {
      throw new Error(`--auth +profile: the ${integration} token expires at ${new Date(expires).toISOString()}, within the ${Math.ceil((horizonMs + margin) / 60_000)} minutes this batch may need: run the keeper (keeper.mjs --once) first, or slice the batch`)
    }
  }
  return { list, secrets: list.flatMap(secretsOf), expiries, dropped: [...new Set(dropped)] }
}

/** Exports the evals profile with its own environment (every integration: the allow-list cuts it down). */
export async function exportProfile({ binary, profileDir, caller = process.env }) {
  if (!profileDir) throw new Error("--auth +profile: set EVALS_PROFILE to the evals profile's directory")
  const penv = profileEnv(profileDir, caller)
  // The profile runs its own service, on its own port, never the real service's (G0 review 4.1).
  const realHomeEnv = { ...caller, HOME: caller.EVALS_REAL_HOME ?? caller.HOME }
  for (const key of Object.keys(realHomeEnv)) if (/^(OPENCODE_|XDG_)/.test(key)) delete realHomeEnv[key]
  ensureServicePort({ opencode: binary, profileEnv: penv, realEnv: realHomeEnv, env: caller })
  assertDistinctPort({ opencode: binary, profileEnv: penv, realEnv: realHomeEnv, env: caller })
  // EVALS_AUTH_STANDALONE=1 reads the profile from a private server instead of its background service (a probe's scratch profile).
  const out = await runToEnd(binary, ["auth", "export", ...(caller.EVALS_AUTH_STANDALONE ? ["--standalone"] : [])], { env: penv, timeoutMs: 60_000 })
  if (out.code !== 0 || !out.stdout.trim()) throw new Error(`--auth +profile: \`opencode auth export\` of the evals profile failed (exit ${out.code}); is ${profileDir} signed in?`)
  return out.stdout
}

/**
 * The integrations a `+profile` batch holds: the arm's plugin and every plugin its cases name in `Seed: plugins=`, by the ids each
 * pack gives its integration (its own id unless the pack says otherwise: OpenRouter's one key serves two entries, the MCP server's
 * and `inference-openrouter`, so both of its packs name both).
 */
export function integrationsFor(plugin, cases, packs, parse, noAccount = null) {
  // A plugin that runs with no account is never signed in, so nothing is asked of the profile for it.
  const named = [...new Set([plugin, ...cases.flatMap((c) => parse(c.seed))])].filter((id) => !noAccount?.has(id))
  return [...new Set(named.flatMap((id) => [].concat(packs.find((p) => p.id === id)?.integration ?? id)))].sort()
}
