// `--auth <source>+profile` (R2, EVALS-232 §1.2.5): the vendor credentials of the evals profile, given to a trial as an
// ALLOW-LIST of fields and nothing else.
//
// The profile is exported per vendor per batch, one `auth export <target>` for each needed plugin (the target is the name
// the host knows the credential by: gws-default, an MCP server's name), each credential cut down to the fields below, and
// imported into every trial's own private server. The minimum was found by probe
// P0-5 on OpenCode 2.3.2: an oauth credential needs `type`, `methodID`, `access`, `expires` AND a `refresh` (the import refuses
// one without), so the refresh token is replaced by a constant placeholder: a trial can use its access token, and cannot
// refresh the real chain. An API key is `{ type: "key", key }`. Import merges: it adds to what the trial already holds.
//
// Dropped: the refresh token, client secrets, `metadata.login`, account labels, and every field not named here. `label` becomes
// the constant `evals`, and `id` is regenerated.

import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { runToEnd } from "./sandbox.mjs"
import { APP_CLIENT, exportTarget } from "../../scripts/profile/auth-targets.mjs"
import { activeCredential } from "../../scripts/profile/credential-select.mjs"
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

/** The names the evals profile is asked for: one per needed integration, plus the app client for slack and x, deduped. */
export const exportTargetsFor = (needed) => {
  const targets = []
  for (const integration of needed ?? []) {
    targets.push(exportTarget(integration))
    const app = APP_CLIENT[integration]
    if (app) targets.push(app)
  }
  return [...new Set(targets)]
}

/**
 * The credentials a batch may hold, from `exportProfile`'s per-target answers `{ <target>: <auth export stdout> }`. Each
 * needed integration's own `auth export <exportTarget>` answer is read with the walk's `activeCredential` (the integration
 * id first, then its name), so an MCP vendor keeps its real `mcp_<hash>` id (Slack's and X's user token), gws's is
 * `gws-default` — never the plugin id. Slack and X also get their app client (`slack-app`/`x-app`, a `key` holding the
 * client id; the allow-list drops the secret in its metadata), because their plugins register their MCP server only with
 * one. Only what was exported for the batch is considered. Throws for a needed integration or app client whose answer
 * holds no active, usable credential (naming the integration and the targets asked for); the expiry check is unchanged.
 * Returns { list, secrets, expiries: { <integrationID>: ms|null }, dropped: [integrationID], plugins: { <integrationID>:
 * <integration> } }.
 */
export function vendorCredentials(exported, { needed, now = Date.now(), horizonMs = 0, acceptUnknownExpiry = false }) {
  if (!exported || typeof exported !== "object" || Array.isArray(exported)) throw new Error("--auth +profile: the evals profile's exports are not a map of `auth export <target>` answers")
  const list = []
  const expiries = {}
  const dropped = []
  const plugins = {}
  const failed = new Map() // integration -> the targets that held nothing usable
  const seen = new Set()
  for (const integration of needed ?? []) {
    const targets = [exportTarget(integration), ...(APP_CLIENT[integration] ? [APP_CLIENT[integration]] : [])]
    for (const target of targets) {
      if (seen.has(target)) continue
      seen.add(target)
      const fail = () => failed.set(integration, [...(failed.get(integration) ?? []), target])
      const text = typeof exported[target] === "string" ? exported[target] : ""
      if (!text.trim()) {
        fail()
        continue
      }
      let all
      try {
        all = JSON.parse(text)
      } catch {
        throw new Error(`--auth +profile: the evals profile's \`auth export ${target}\` is not JSON`)
      }
      if (!Array.isArray(all)) all = all?.credentials ?? []
      const chosen = activeCredential(text, target)
      if (!chosen) {
        for (const c of all) if (c?.integrationID) dropped.push(c.integrationID)
        fail()
        continue
      }
      const cut = allowListed(chosen)
      if (!cut) {
        dropped.push(chosen.integrationID)
        fail()
        continue
      }
      // Two integrations may resolve to one credential (OpenRouter's two entries): one row, one import.
      if (list.some((entry) => entry.integrationID === cut.integrationID)) continue
      list.push(cut)
      plugins[cut.integrationID] = integration
      // Only an oauth token expires: an API key (the app client included) has no expiry to check the batch against.
      if (cut.value.type === "oauth") expiries[cut.integrationID] = cut.value.expires ?? null
    }
  }
  if (failed.size) {
    const parts = [...failed].map(([integration, targets]) => `${integration} (its ${targets.map((target) => `\`auth export ${target}\``).join(" or ")} held no active credential)`)
    throw new Error(`--auth +profile: the evals profile holds no usable credential for ${parts.join("; ")}; sign it in, or leave the plugin out of the batch`)
  }
  const margin = 10 * 60_000
  for (const [integration, expires] of Object.entries(expiries)) {
    if (expires === null) {
      if (!acceptUnknownExpiry) throw new Error(`--auth +profile: the ${integration} credential has no expiry, so the batch cannot be checked against it; pass --accept-unknown-token-expiry if something keeps it fresh (the keeper does)`)
    } else if (expires - now < horizonMs + margin) {
      throw new Error(`--auth +profile: the ${integration} token expires at ${new Date(expires).toISOString()}, within the ${Math.ceil((horizonMs + margin) / 60_000)} minutes this batch may need: run the keeper (keeper.mjs --once) first, or slice the batch`)
    }
  }
  return { list, secrets: list.flatMap(secretsOf), expiries, dropped: [...new Set(dropped)], plugins }
}

/**
 * Runs `auth export <target>` for each target in the profile's environment, one at a time: the host resolves a target by
 * the server's name (an MCP vendor's name, gws-default for gws, slack and x by their own), so only the batch's vendors
 * leave the profile. Returns { <target>: stdout }, or "" for a target the host did not answer for. `exec` replaces the
 * host in a unit test.
 */
export async function exportTargets({ binary, penv, caller = process.env, targets = [], exec = runToEnd }) {
  const standalone = caller.EVALS_AUTH_STANDALONE ? ["--standalone"] : []
  const out = {}
  for (const target of [...new Set(targets)]) {
    const answer = await exec(binary, ["auth", "export", target, ...standalone], { env: penv, timeoutMs: 60_000 })
    if (answer?.error) throw new Error(`--auth +profile: \`opencode auth export ${target}\` of the evals profile failed: ${answer.error}`)
    out[target] = answer?.code === 0 ? String(answer.stdout ?? "") : ""
  }
  return out
}

/** An apply error the runner must report as an infrastructure auth failure, never as the model's. */
const infraAuth = (message) => Object.assign(new Error(message), { infra: "auth" })

/**
 * After `auth import --standalone` in a trial, prove the trial's host registered every imported integration and holds
 * the imported credential active: `auth list --format json` (registration) and `auth export <integrationID>` (the
 * active row). Import accepts any id, so without this an id the trial's host never derives (a plugin that changed its
 * server name or URL, or registered nothing) leaves the trial unsigned while looking signed, and its failures would be
 * graded as the model's. The error carries `infra: "auth"`, which the runner records as an infrastructure failure.
 */
export async function verifyVendorImport({ exec, cwd, env, list, plugins = {}, standalone = false, timeoutMs = 60_000, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const flags = standalone ? ["--standalone"] : []
  const listed = await exec(["auth", "list", "--format", "json", ...flags], { cwd, env, timeoutMs })
  if (listed?.error) throw infraAuth(`--auth +profile: \`opencode auth list\` in the trial failed: ${listed.error}`)
  if (listed?.code !== 0) throw infraAuth(`--auth +profile: \`opencode auth list\` in the trial failed (exit ${listed?.code ?? "?"})`)
  let integrations
  try {
    integrations = JSON.parse(String(listed.stdout ?? ""))
  } catch {
    throw infraAuth("--auth +profile: `opencode auth list --format json` in the trial is not JSON")
  }
  if (!Array.isArray(integrations)) throw infraAuth("--auth +profile: `opencode auth list --format json` in the trial is not a list")
  for (const credential of list) {
    const plugin = plugins[credential.integrationID] ?? credential.integrationID
    if (!integrations.some((entry) => entry?.id === credential.integrationID)) {
      throw infraAuth(`--auth +profile: the trial's host registers no ${plugin} integration (${credential.integrationID}), so its imported credential is orphaned; the plugin's server name or URL differs from the evals profile's build`)
    }
    const answer = await exec(["auth", "export", credential.integrationID, ...flags], { cwd, env, timeoutMs })
    let rows
    try {
      rows = JSON.parse(String(answer?.stdout ?? ""))
    } catch {
      rows = []
    }
    if (!Array.isArray(rows)) rows = rows?.credentials ?? []
    const active = rows.find((row) => row?.id === credential.id && row.active === true)
    if (answer?.code !== 0 || !active) throw infraAuth(`--auth +profile: the trial's host does not hold ${plugin}'s imported credential (${credential.integrationID}) as active`)
  }
}

/**
 * On the trial's own server, after it starts and before the first prompt: every imported `mcp_` credential's server must
 * settle as connected, and so must a server a plugin registers under a key of its own. A fresh `--standalone` server per
 * call cannot answer this (2.3.2 starts MCP connections asynchronously as `pending`; `mcp.list` returns the current
 * statuses without waiting), so this polls ONE server, `--server <url>`, as the client does. `pending` is retried until
 * `deadlineMs` (2.3.2's 2 s startup grace plus its 30 s MCP startup timeout, with margin); `needs authentication`,
 * `failed` and `disabled` fail at once. Every failure is an infrastructure auth failure, naming the plugin.
 *
 * Tavily is why the second rule exists: its plugin registers `mcp.tavily.com` itself with `oauth: false` and an
 * `Authorization: Bearer <key>` header taken from OpenCode's built-in `tavily` key integration (`src/mcp.ts` of
 * opencode-tavily 0.0.6). No `mcp_` credential names that server, so waiting only on `mcp_` ids left the trial's first
 * turn to race the connection and the read failed as Code Mode's `Unknown tool`, not as the sign-in problem it was; and
 * a key the host rejected showed as a tool-less trial. The server's row is named after the integration the key belongs
 * to, so it is waited for when the host lists one by that name (a key integration with no server row, such as gws's
 * `gws-default`, is untouched).
 */
export async function verifyVendorServers({ exec, cwd, env, url, list, plugins = {}, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now, deadlineMs = 32_000, timeoutMs = 60_000 }) {
  const mcp = list.filter((credential) => credential.integrationID.startsWith("mcp_"))
  const keyed = list.filter((credential) => !credential.integrationID.startsWith("mcp_")).map((credential) => credential.integrationID)
  if (!mcp.length && !keyed.length) return
  const label = (name) => plugins[name] ?? name
  const oauthNames = [...new Set(mcp.map((credential) => credential.integrationID))].map(label)
  const deadline = now() + deadlineMs
  let rows = []
  for (;;) {
    const answer = await exec(["mcp", "list", "--server", url], { cwd, env, timeoutMs })
    if (answer?.error) throw infraAuth(`--auth +profile: \`opencode mcp list --server\` in the trial failed: ${answer.error}`)
    if (answer?.code !== 0) throw infraAuth(`--auth +profile: \`opencode mcp list --server\` in the trial failed (exit ${answer?.code ?? "?"})`)
    rows = mcpRows(answer.stdout)
    // A key integration's server is judged only once the host lists it: an integration that registers no server
    // (gws's, Slack's app client) has nothing to await, and a server the plugin never registered cannot be named here.
    const names = [...new Set([...oauthNames, ...keyed.filter((name) => rows.some((row) => row.name === name))])]
    if (!names.length) return
    const statuses = names.map((name) => rows.find((row) => row.name === name)?.status ?? "")
    if (statuses.every((status) => /^connected$/i.test(status))) return
    const hard = statuses.find((status) => /failed|needs authentication|disabled/i.test(status))
    if (hard) throw infraAuth(`--auth +profile: the trial's host has MCP server "${label(names[statuses.indexOf(hard)])}" ${hard}, not connected: the imported credential is not usable`)
    if (now() >= deadline) {
      const why = names.map((name, index) => `${label(name)} ${statuses[index] || "not listed"}`).join(", ")
      throw infraAuth(`--auth +profile: the trial's host did not connect its MCP server(s) within ${Math.round(deadlineMs / 1000)} s (${why}): the imported credential is not usable`)
    }
    await wait(500)
  }
}

/** `opencode mcp list` lines: an icon, the server name, two spaces, the status (`connected`, `needs authentication`,
 *  `failed: …`, `pending`, `disabled`). */
export function mcpRows(stdout) {
  return String(stdout ?? "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => /^\S\s+(\S+)\s{2,}(.+)$/.exec(line.trim()))
    .filter(Boolean)
    .map((match) => ({ name: match[1], status: match[2].trim() }))
}

/** Exports the evals profile with its own environment, per target: one `auth export <target>` each, so a batch never
 * pulls a vendor it does not need out of the profile. Returns { <target>: stdout }, or "" for a target the host did not
 * answer for. */
export async function exportProfile({ binary, profileDir, caller = process.env, targets = [], exec = runToEnd }) {
  if (!profileDir) throw new Error("--auth +profile: set EVALS_PROFILE to the evals profile's directory")
  const penv = profileEnv(profileDir, caller)
  // The profile runs its own service, on its own port, never the real service's (G0 review 4.1).
  const realHomeEnv = { ...caller, HOME: caller.EVALS_REAL_HOME ?? caller.HOME }
  for (const key of Object.keys(realHomeEnv)) if (/^(OPENCODE_|XDG_)/.test(key)) delete realHomeEnv[key]
  ensureServicePort({ opencode: binary, profileEnv: penv, realEnv: realHomeEnv, env: caller })
  assertDistinctPort({ opencode: binary, profileEnv: penv, realEnv: realHomeEnv, env: caller })
  return exportTargets({ binary, penv, caller, targets, exec })
}

/**
 * The integrations a `+profile` batch holds: the arm's plugin and every plugin its cases name in `Seed: plugins=`, by the ids each
 * pack gives its integration (its own id unless the pack says otherwise). A pack names the integrations ITS OWN tools read: the
 * OpenRouter plugin's only credential is its MCP server's OAuth sign-in (`openrouter`, whose id is `mcp_<hash>`); the Inference
 * plugin has its own key (`inference-openrouter`, "OpenRouter key for Inference"), a different credential with a different owner.
 * They are not alternatives of one key: a pack that needs both names both, and a pack that needs one names one.
 */
export function integrationsFor(plugin, cases, packs, parse, noProfile = null) {
  // A plugin whose credential the evals profile cannot hold is never asked for one: the fake-mode plugins and the
  // local `profile: false` plugins (noProfilePlugins), NOT the `accounts: none` grading mode. `p0` is the P0 probes' own
  // permission plugin: it reads no data and asks no vendor, and a probe's real vendor is named by its seed.
  const named = [...new Set([plugin, ...cases.flatMap((c) => parse(c.seed))])].filter((id) => id !== "p0" && !noProfile?.has(id))
  return [...new Set(named.flatMap((id) => [].concat(packs.find((p) => p.id === id)?.integration ?? id)))].sort()
}
