// The evals profile (EVALS-232 §1.2): the helpers `check-real`, `keeper` and the tests share. Nothing here prints a credential.

import { createHash, randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, chmodSync, renameSync, writeFileSync, openSync, closeSync, unlinkSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir, userInfo } from "node:os"
import { fileURLToPath } from "node:url"

export const sha256 = (text) => createHash("sha256").update(String(text)).digest("hex")

// ---- Where the walk's paths come from (EVALS-232 §1.2) ---------------------------------------------------------------------------------------
// Every one is an environment variable with today's value as its default; the scripts take a flag for it too where a flag makes sense. The private
// side (the profile, the store, the owner's web server) is never in this repository: EVALS_REAL_HOME moves all four off the owner's home in one go.
/** The owner's web server: every real-profile call goes to it, with `--server` (EVALS_REAL_SERVER overrides). */
export const DEFAULT_REAL_SERVER = "http://127.0.0.1:4096"
/** The evals profile: its own HOME, XDG tree, service and credentials (EVALS_PROFILE overrides). */
export const defaultProfileDir = (env = process.env) => env.EVALS_PROFILE ?? join(env.EVALS_REAL_HOME ?? homedir(), "evals-232", "profile")
/** The private store: the plugin pins, the copied app client, the round log and the walk's progress (EVALS_STORE overrides). */
export const defaultStoreDir = (env = process.env) => env.EVALS_STORE ?? join(env.EVALS_REAL_HOME ?? homedir(), "evals-232", "store")
/** The env file that holds the web server's password, read per call and never kept or printed (EVALS_REAL_SERVER_ENV overrides). */
export const defaultServerEnvFile = (env = process.env) => env.EVALS_REAL_SERVER_ENV ?? join(env.EVALS_REAL_HOME ?? homedir(), ".config", "opencode-web", "server.env")
/** The real background service's own record, read for its port only: reading it runs no opencode command (EVALS_SERVICE_FILE overrides). */
export const defaultServiceFile = (env = process.env) => env.EVALS_SERVICE_FILE ?? join(env.EVALS_REAL_HOME ?? homedir(), ".config", "opencode", "service.json")

// ---- The identity reads (EVALS-232 §1.2.6) ---------------------------------------------------------------------------------------------------
// One cheap, read-only call per signed-in integration that REALLY REACHES THE VENDOR, through the plugin's tools RPC. The method, input, permission action
// and the expected shape of a real answer live in identity-methods.json (beside this file), from each plugin's own `describe` at the pinned release. The
// ashby, elevenlabs, wisprflow and gws `probe` methods only read whether OpenCode holds a credential ("It calls Ashby for nothing"), so they are not used:
// a probe would pass even after the evals sign-in replaced the owner's real token.
const TABLE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "identity-methods.json"), "utf8")).vendors
/** Routes `<rpc id>/<method>` by walk vendor. */
export const IDENTITY = Object.freeze(Object.fromEntries(Object.entries(TABLE).map(([v, e]) => [v, e.route])))
/** The method's input where it is not `{}`. */
export const IDENTITY_INPUT = Object.freeze(Object.fromEntries(Object.entries(TABLE).map(([v, e]) => [v, e.input ?? {}])))
/** The permission action the method asks for: the check session allows this one and nothing else. */
export const IDENTITY_ACTION = Object.freeze(Object.fromEntries(Object.entries(TABLE).map(([v, e]) => [v, e.action])))
/** The expected shape of a real answer: all groups hold, each group any-of: `path:type`. */
export const IDENTITY_EXPECT = Object.freeze(Object.fromEntries(Object.entries(TABLE).map(([v, e]) => [v, e.expect])))
/** The tool actions a probe reads through the host, allowed in the check session beside the probe's own action. */
export const IDENTITY_INNER = Object.freeze(Object.fromEntries(Object.entries(TABLE).map(([v, e]) => [v, e.inner ?? []])))
/** What each call reaches, for the PASS line. */
export const IDENTITY_CALLS = Object.freeze(Object.fromEntries(Object.entries(TABLE).map(([v, e]) => [v, e.calls])))

/** The agent a check session names (every tools-RPC call runs as a session with an agent). */
export const CHECK_AGENT = "build"
export const CHECK_TITLE = "evals walk check"

const clip = (m) => String(m ?? "").replace(/[A-Za-z0-9_.~+/=-]{24,}/g, "***").replace(/\s+/g, " ").trim().slice(0, 120)

/** Why a tools-RPC call failed at the transport, or null: an RpcError, a non-zero exit, or no JSON object. Never echoes more than a short, masked message. */
export function rpcFailure(out) {
  const text = String(out?.stdout ?? "")
  let parsed = null
  try { parsed = JSON.parse(text) } catch {}
  if (parsed?._tag === "RpcError") return `${parsed.type ?? "rpc error"}: ${clip(parsed.message)}`
  // The body is judged on its content, whatever the exit code: a valid answer with a non-zero exit is the answer (its shape decides), and an
  // auth error belongs to its normal class. Only a call with no body at all is judged by its exit code.
  if (parsed && typeof parsed === "object") return null
  if (out?.code !== 0) return `exit ${out?.code}${clip(out?.stderr) ? `: ${clip(out.stderr)}` : ""}`
  return "no JSON object answer"
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const ERROR_WORD = /UNAVAILABLE|UNREADABLE|UPSTREAM|AUTH_REQUIRED|AUTH_SCOPE_MISSING|UNAUTHORI[SZ]ED|FORBIDDEN|FAILED|ERROR/i

/** Exit codes a CLI may report when it is killed by its own timeout (124 is GNU timeout, 137/143 SIGKILL/SIGTERM). `run()`'s own spawnSync
 *  timeout is NOT one of these: it reports `status: null` with an ETIMEDOUT error. A non-null code is the CLI's own, so only a body-less one
 *  is treated as a timeout. */
export const TIMEOUT_EXIT_CODES = Object.freeze([124, 137, 143])

/** Does stdout carry a parseable JSON body (an answer of some kind)? An empty, truncated or non-JSON stdout does not. */
export function hasBody(result) {
  const text = String(result?.stdout ?? "").trim()
  if (!text) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** Was this call killed by its own timeout? Only when it carries NO parseable body: a body is judged on its content, whatever the code. */
export function timedOut(result) {
  if (hasBody(result)) return false
  if (TIMEOUT_EXIT_CODES.includes(Number(result?.code))) return true
  return Boolean(result?.error && /ETIMEDOUT|timed?\s*out|timeout/i.test(String(result.error)))
}

/** How long the check waits for the evals service's route to answer when it is still starting (EVALS_RPC_WAIT_MS overrides, for tests). */
export const RPC_WAIT_MS = 60_000
export const rpcWaitMs = (env = process.env) => {
  const n = Number(env.EVALS_RPC_WAIT_MS)
  return Number.isFinite(n) && n >= 0 ? n : RPC_WAIT_MS
}

/**
 * Waits until the evals service answers this vendor's `describe`. A service that has just started answers `rpc.unavailable` for a while (its
 * plugins are still loading); that is "not ready", not a failure of the evals sign-in. Polls up to `waitMs`. Any other answer — including a
 * describe that fails for another reason — counts as answered, and the read itself reports it.
 */
export function waitForEvalsRoute(call, vendor, directory, { waitMs = RPC_WAIT_MS, sleep = sleepBriefly } = {}) {
  const route = IDENTITY[vendor]
  if (!route) return { ok: true, skipped: true }
  const ns = route.split("/")[0]
  const deadline = Date.now() + waitMs
  let last = "no answer"
  while (true) {
    const out = call(["api", "post", `/api/rpc/${ns}/describe`, "-H", `x-opencode-directory:${directory}`, "-d", JSON.stringify({ input: {} })])
    const why = rpcFailure(out)
    if (!why) return { ok: true }
    last = why
    if (!/^rpc\.unavailable\b/i.test(why) || Date.now() >= deadline) return /^rpc\.unavailable\b/i.test(why) ? { ok: false, why } : { ok: true }
    sleep(50)
  }
}

/** An error signal in the answer's top levels (root, `output`, `output.output`): an RpcError (also under `data`), an error/isError/failed/refused key, an error-like code or status. Data deeper down is not scanned: it is other people's content. */
export function errorSignal(answer) {
  if (answer?._tag === "RpcError" || answer?.data?._tag === "RpcError") return "an RpcError"
  for (const level of [answer, answer?.output, answer?.output?.output]) {
    if (!isObject(level)) continue
    for (const key of ["error", "errors", "isError", "failed", "refused"]) {
      const v = level[key]
      if (v !== undefined && v !== null && v !== false && v !== "" && !(Array.isArray(v) && !v.length)) return `a "${key}" field`
    }
    for (const key of ["code", "status", "state"]) if (typeof level[key] === "string" && ERROR_WORD.test(level[key])) return `${key} ${clip(level[key])}`
  }
  return null
}

/** The value at `a.b~json.c`: `~json` parses that string as JSON first (`@` would read as an email address to a privacy scan). */
function at(root, path) {
  let v = root
  for (const seg of path.split(".")) {
    const json = seg.endsWith("~json")
    v = v?.[json ? seg.slice(0, -5) : seg]
    if (json) { try { v = JSON.parse(v) } catch { v = undefined } }
  }
  return v
}
const holds = (v, type) => (type === "string" ? typeof v === "string" && v.length > 0 : type === "array" ? Array.isArray(v) : type === "number" ? typeof v === "number" && Number.isFinite(v) : type === "object" ? isObject(v) : type === "true" ? v === true : type === "email" ? emailLine(v) : type === "profile" ? profileText(v) : false)
/** An address on a line of its own, or an `email: <address>` line: free text that merely contains one does not count (an error message can quote one). */
const emailLine = (v) => typeof v === "string" && v.split(/\r?\n/).some((line) => { const t = line.trim(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) || /^email\s*:\s*[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(t) })
/** A profile text: not an error message (no leading error word), which would otherwise pass by quoting an address. */
const profileText = (v) => typeof v === "string" && v.trim().length > 0 && !/^(?:error|errors|failed|failure|denied|refused|forbidden|unauthori[sz]ed|unavailable|upstream|invalid|not found|unable|exception)\b/i.test(v.trim())

/** The expected-shape check of an answer: null when every group has a path that holds, else the first group's description (paths only, never values). */
export function shapeProblem(answer, expect) {
  for (const group of expect ?? []) {
    if (!group.some((spec) => { const k = spec.lastIndexOf(":"); return holds(at(answer, spec.slice(0, k)), spec.slice(k + 1)) })) return `the answer carries none of: ${group.join(" | ")}`
  }
  return null
}

/** Judges one vendor's identity answer strictly: no transport failure, no error signal, AND the shape of a real answer. Returns the reason, or null. */
export function judgeAnswer(out, vendor) {
  const why = rpcFailure(out)
  if (why) return why
  const answer = JSON.parse(out.stdout)
  const signal = errorSignal(answer)
  if (signal) return `the answer carries ${signal}`
  return shapeProblem(answer, IDENTITY_EXPECT[vendor])
}

/**
 * Runs `fn(sessionID)` inside a session made for the check and ALWAYS deleted afterwards, on every path. The session names an agent and, when `actions` is given,
 * can do nothing but those actions (deny everything, allow them): a leftover or a reused session can run nothing else. `call(args)` runs `opencode <args>`
 * against one profile: the evals profile's own service, or the real one through `--server` only. Returns fn's result, or { ok: false, why } when no session
 * could be made; `leftover` names a session that could not be deleted.
 */
export function withCheckSession(call, directory, fn, agent = CHECK_AGENT, actions = null) {
  const permissions = actions ? [{ action: "*", resource: "*", effect: "deny" }, ...actions.map((action) => ({ action, resource: "*", effect: "allow" }))] : undefined
  const made = call(["api", "post", "/api/session", "-d", JSON.stringify({ title: CHECK_TITLE, agent, location: { directory }, ...(permissions ? { permissions } : {}) })])
  let id = null
  try { id = JSON.parse(made.stdout)?.data?.id } catch {}
  if (made.code !== 0 || !/^ses_[A-Za-z0-9]+$/.test(String(id ?? ""))) return { ok: false, why: `could not create a check session (exit ${made.code})` }
  let result
  try {
    result = fn(id)
  } finally {
    const gone = call(["api", "delete", `/api/session/${id}`])
    if (gone.code !== 0 && result) result.leftover = id
    if (gone.code !== 0 && !result) throw new Error(`the check session ${id} could not be deleted: delete the session titled "${CHECK_TITLE}" yourself`)
  }
  return result
}

/** The tool action a PERMISSION_DENIED answer says the call needs (`x_probe needs x_get_users_me, which a deny rule refuses ...`), or null. */
export const neededAction = (why) => /needs ([A-Za-z0-9_.:-]+),? which/.exec(String(why ?? ""))?.[1] ?? null

/** The identity read of one vendor, as the envelope the tools RPC takes: { input: { sessionID, input } }, judged strictly. */
export function identityRead(call, { vendor, directory, sessionID }) {
  const route = IDENTITY[vendor]
  const body = JSON.stringify({ input: { sessionID, input: IDENTITY_INPUT[vendor] } })
  const out = call(["api", "post", `/api/rpc/${route}`, "-H", `x-opencode-directory:${directory}`, "-d", body])
  const why = judgeAnswer(out, vendor)
  let raw = ""
  try { raw = String(JSON.parse(out.stdout).message ?? "") } catch {}
  const notInstalled = /GWS_UNAVAILABLE: gws is not installed/.test(raw)
  return why ? { ok: false, why, notInstalled, timeout: timedOut(out), code: out.code, method: route.split("/")[1], needs: /PERMISSION_DENIED|deny rule/.test(raw) ? neededAction(raw) : null } : { ok: true, method: route.split("/")[1] }
}

/** The `read`-class actions one plugin lists (describe is free and calls no vendor). */
function readActionsOf(call, directory, vendor) {
  const out = call(["api", "post", `/api/rpc/${IDENTITY[vendor].split("/")[0]}/describe`, "-H", `x-opencode-directory:${directory}`, "-d", JSON.stringify({ input: {} })])
  try { return new Set(JSON.parse(out.stdout).output.methods.filter((m) => m.class === "read").map((m) => m.action)) } catch { return new Set() }
}

/**
 * The vendor's identity read in a session that may run only that read: its own action plus the reads a probe makes through the host (IDENTITY_INNER), the
 * session deleted afterwards. The check must never fail because of the session's own rules and must never gain more than that one read: should the host
 * name one more read the call needs (PERMISSION_DENIED ... needs <action>), it is added to a NEW session only when describe lists it as a read of the same
 * plugin; anything else is refused and said so. A refused attempt made no vendor call.
 */
export function identityCheck(call, { vendor, directory, agent }) {
  const allowed = [IDENTITY_ACTION[vendor], ...IDENTITY_INNER[vendor]]
  const prefix = IDENTITY_ACTION[vendor].replace(/[_.].*$/, "")
  let result
  for (let attempt = 0; attempt < 4; attempt++) {
    result = withCheckSession(call, directory, (sessionID) => identityRead(call, { vendor, directory, sessionID }), agent, allowed)
    if (result.ok || !result.needs || allowed.includes(result.needs)) return result
    const reads = readActionsOf(call, directory, vendor)
    if (!result.needs.startsWith(`${prefix}_`) || !reads.has(result.needs)) return { ...result, why: `${result.why} (not allowed: ${result.needs} is not a read of this plugin)` }
    allowed.push(result.needs)
  }
  return result
}

/**
 * The order the evals profile is signed in, one vendor at a time, each followed by check-real (the plan's section 1.2.3, less the two the
 * owner decided not to sign in: GitHub and Jira run with no account, `accounts: none`). Slack, X and Google use the apps already configured:
 * no second app or client. The first two are not in the real profile at all.
 */
export const SIGNIN_ORDER = Object.freeze(["openrouter", "affinity", "ashby", "plaud", "gws", "slack", "x", "elevenlabs", "wisprflow", "metaview", "granola", "notion", "linear"])

/**
 * Vendors that may be absent from the real profile: when its export succeeds and holds no credential, there is nothing of the owner's to sign out of
 * and check-real checks only the evals sign-in. (The real profile now holds an "OpenRouter tools" MCP credential, so absent is not assumed: a FAILED
 * real export is never "absent".) Affinity is not in the real profile as of 20 Nov.
 */
export const NOT_IN_REAL = Object.freeze(["openrouter", "affinity"])

/** The name `auth export` and `auth login` know a walk vendor by, where it is not the vendor's own (real shapes: gws is `gws-default` labelled "default"; Wispr Flow is `mcp_<hash>` labelled "Wispr Flow"). */
export const LOGIN_TARGET = Object.freeze({ gws: "gws-default", wisprflow: "Wispr Flow" })
export const exportTarget = (integration) => LOGIN_TARGET[integration] ?? integration

/** A name compared by its letters: lowercase, whitespace removed. */
export const normName = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, "")

/** How soon after a sign-in the real profile's own refresh must be seen to work again, by vendor (§1.2.3 rule 3), in hours. */
export const RECHECK_HOURS = Object.freeze({ gws: 1, jira: 1, notion: 1, slack: 12, linear: 24 })

/** The environment of the owner's real profile: their home, and none of the variables that move OpenCode's data. */
export function realEnv(base = process.env) {
  const env = { ...base }
  for (const key of Object.keys(env)) if (/^(OPENCODE_|XDG_)/.test(key)) delete env[key]
  env.HOME = base.EVALS_REAL_HOME ?? userInfo().homedir
  return env
}

/**
 * The environment of the evals profile: HOME, OPENCODE_TEST_HOME and XDG_* inside it, an EMPTY `.claude` for Claude's own
 * config, the Claude Code integration off, and nothing linked out (the lab's helper symlinked the real ~/.claude).
 */
export function profileEnv(dir, base = process.env) {
  const env = { ...base }
  for (const key of Object.keys(env)) if (/^(OPENCODE_|XDG_|CLAUDE_)/.test(key)) delete env[key]
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

/** The profile's config: the Claude Agent provider is denied (it never spawns `claude`), and the plugins the walk needs are listed, pinned. */
export const profileConfig = (plugins = []) => ({ ...(plugins.length ? { plugins } : {}), policies: [{ action: "provider.use", resource: "claude-agent", effect: "deny" }] })

/** The pins the evals profile loads (plus the gws plugin's oauthClient option when evals-gws-client.json exists), one per vendor, from one file (EVALS_PLUGINS, default $EVALS_STORE/evals-plugins.json): { vendor: "github:owner/repo#tag" }. Throws when it is missing. */
export function loadPins(env = process.env) {
  const store = defaultStoreDir(env)
  const file = env.EVALS_PLUGINS ?? join(store, "evals-plugins.json")
  if (!existsSync(file)) throw new Error(`${file} is missing: it lists the walk's plugin pins (vendor -> github:owner/repo#tag)`)
  const pins = JSON.parse(readFileSync(file, "utf8"))
  const list = Object.values(pins)
  if (!list.length || list.some((p) => typeof p !== "string" || !p)) throw new Error(`${file} must map each vendor to a plugin source string`)
  let out = list
  const file2 = env.EVALS_GWS_CLIENT ?? join(store, "evals-gws-client.json")
  if (existsSync(file2)) {
    const client = JSON.parse(readFileSync(file2, "utf8"))
    if (typeof client.clientId !== "string" || typeof client.clientSecret !== "string") throw new Error(`${file2} must hold clientId and clientSecret`)
    out = out.map((p) => (typeof p === "string" && /opencode-gws#/.test(p) ? { package: p, options: { oauthClient: { clientId: client.clientId, clientSecret: client.clientSecret } } } : p))
  }
  // Affinity: the owner's organisation signs in with its own Public OAuth app (the plugin's `clientId` option, README "Route 2"), not
  // OpenCode's client URL, which Affinity answers `Unknown client_id` (SERVER-OAUTH-003) until an admin adds it. A client ID is not a secret.
  const file3 = env.EVALS_AFFINITY_CLIENT ?? join(store, "evals-affinity-client.json")
  if (existsSync(file3)) {
    const client = JSON.parse(readFileSync(file3, "utf8"))
    if (typeof client.clientId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client.clientId)) throw new Error(`${file3} must hold clientId, a UUID (Affinity: Settings > Manage Apps > the OAuth app)`)
    out = out.map((p) => (typeof p === "string" && /opencode-affinity#/.test(p) ? { package: p, options: { clientId: client.clientId } } : p))
  }
  return out
}

// ---- The real profile is reached ONLY through the owner's web server -------------------------------------------------------------------
// Without --server the CLI connects to the real BACKGROUND SERVICE and starts it when it is down (20 Nov 12:26: it took over the sessions and
// refreshed vendor tokens next to the web server). So every opencode call made with realEnv() goes through `--server <the web server>`, with its
// password in that call's environment only.

/** The hosts the real web server may have. runReal sends the server's password there, so nothing else is allowed. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

/** Is this URL a loopback HTTP(S) URL (the only host the real web server's password may go to)? */
export function loopbackUrl(url) {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    return false
  }
  return (parsed.protocol === "http:" || parsed.protocol === "https:") && LOOPBACK_HOSTS.has(parsed.hostname)
}

/** The web server's URL (EVALS_REAL_SERVER overrides). A non-loopback host is refused: the password would go with it. The origin is
 *  returned, so no userinfo, path, query or fragment from the raw string reaches the CLI (parser differentials stay out of argv). */
export function realServerUrl(env = process.env) {
  const url = env.EVALS_REAL_SERVER ?? DEFAULT_REAL_SERVER
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    parsed = null
  }
  if (!parsed || !loopbackUrl(parsed)) throw new Error(`EVALS_REAL_SERVER (or --real-server) must be a loopback URL (127.0.0.1, localhost or [::1]), not ${url}: the real web server's password would be sent there`)
  return parsed.origin
}

/** The web server's password from its env file (EVALS_REAL_SERVER_ENV overrides the file), read per call: never kept, printed or put in argv. Null when there is none. */
export function realServerPassword(env = process.env) {
  const file = defaultServerEnvFile(env)
  let text
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return null
  }
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?OPENCODE_(?:SERVER_)?PASSWORD\s*=\s*(.*?)\s*$/.exec(line)
    if (m) return m[1].replace(/^(["'])(.*)\1$/, "$2")
  }
  return null
}

/**
 * Runs an opencode command against the REAL profile: `--server <web server>` is appended, the password goes in OPENCODE_SERVER_PASSWORD of this
 * one call. Callers check realServiceProblem() first (check-real does; signin.sh runs guard-real.mjs).
 */
export function runReal(exec, opencode, args, { base = process.env, ...options } = {}) {
  const env = { ...realEnv(base), ...(options.env ?? {}) }
  const password = realServerPassword(base)
  if (password) env.OPENCODE_SERVER_PASSWORD = password
  return exec(opencode, [...args, "--server", realServerUrl(base)], { ...options, env })
}

/** The real background service's port: EVALS_REAL_SERVICE_PORT, else `port` in the owner's service file, else the one the host reports. Read from the file: no opencode command. */
export function realServicePortOf(env = process.env) {
  const given = Number(env.EVALS_REAL_SERVICE_PORT)
  if (Number.isInteger(given) && given > 0) return given
  try {
    const n = Number(JSON.parse(readFileSync(defaultServiceFile(env), "utf8")).port)
    if (Number.isInteger(n) && n > 0 && n < 65536) return n
  } catch {}
  return 49374
}

/** Local TCP ports in LISTEN state, from /proc/net/tcp and tcp6 (no command is run). */
export function listeningPorts(procRoot = "/proc") {
  const ports = new Set()
  for (const name of ["tcp", "tcp6"]) {
    let text
    try {
      text = readFileSync(join(procRoot, "net", name), "utf8")
    } catch {
      continue
    }
    for (const line of text.split("\n").slice(1)) {
      const f = line.trim().split(/\s+/)
      if (f[3] === "0A" && f[1]) ports.add(parseInt(f[1].split(":").pop(), 16))
    }
  }
  return ports
}

/**
 * Why the real profile must not be touched right now, or null. A real background service is an `opencode serve --service` whose HOME is the
 * owner's (the evals profile's own service has the profile as HOME and is not one), or anything listening on the real service's port. Read from
 * /proc: it runs no opencode command, which could start one.
 */
export function realServiceProblem(env = process.env, { procRoot = "/proc" } = {}) {
  const home = env.EVALS_REAL_HOME ?? userInfo().homedir
  const port = realServicePortOf(env)
  const found = []
  let pids = []
  try {
    pids = readdirSync(procRoot).filter((n) => /^\d+$/.test(n))
  } catch {}
  for (const pid of pids) {
    try {
      const argv = readFileSync(join(procRoot, pid, "cmdline"), "utf8").split("\0")
      if (!(argv.includes("serve") && argv.includes("--service") && /(^|\/)opencode$/.test(argv[0] ?? ""))) continue
      const owner = readFileSync(join(procRoot, pid, "environ"), "utf8").split("\0").find((e) => e.startsWith("HOME="))
      if (owner === `HOME=${home}`) found.push(`a real background service (pid ${pid})`)
    } catch {}
  }
  if (listeningPorts(procRoot).has(port)) found.push(`a listener on the real service's port ${port}`)
  if (!found.length) return null
  return `${found.join(" and ")}: it shares the owner's data and has no OPENCODE_API_KEY, so it must not run. Stop it with \`HOME=${home} opencode service stop\`, then resume the walk with signin.sh --from <vendor>`
}

/** Symbolic links anywhere under the profile (there must be none: a link could reach the real profile). */
export function linksIn(dir) {
  const found = []
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (lstatSync(path).isSymbolicLink()) found.push(path)
      else if (entry.isDirectory()) walk(path)
    }
  }
  if (existsSync(dir)) walk(dir)
  return found
}

/**
 * Runs a command and returns { code, stdout, stderr }; never throws, never echoes. spawnSync reports ITS OWN timeout as `code: null` with an
 * ETIMEDOUT error (the kill signal is SIGTERM), never as 137 or 143: a non-null 124/137/143 below is the CLI's own exit code.
 */
export function run(command, args, { env, input, timeoutMs = 60_000 } = {}) {
  const out = spawnSync(command, args, { env, input, encoding: "utf8", timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 })
  return { code: out.status, stdout: out.stdout ?? "", stderr: out.stderr ?? "", error: out.error ? String(out.error.message) : null }
}

/** Is this stdout a real `auth export` ANSWER: a JSON array of credentials, or `{credentials:[…]}`, with no RpcError and no `error` key?
 *  Only such a body counts as an export (a failed export's error object is a read failure, never "nothing there"). Returns the list or null. */
export function exportAnswer(out) {
  const text = String(out?.stdout ?? "").trim()
  if (!text) return null
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (parsed?._tag === "RpcError" || parsed?.error) return null
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.credentials)) return parsed.credentials
  return null
}

/** The active credential of an integration from `opencode auth export` output, or null. Returns the parsed object (secrets inside: keep it in memory). */
export function activeCredential(exported, integration) {
  let list
  try {
    list = JSON.parse(exported)
  } catch {
    return null
  }
  if (!Array.isArray(list)) list = list?.credentials ?? []
  const want = normName(integration)
  // The integration id first, then the label; then EVERY entry of that integration (a re-sign-in leaves an inactive `Linear` beside the active
  // `Linear 2`, both with the same id), and only the ACTIVE one is returned: never a stale inactive credential.
  const named = list.filter((c) => normName(c?.integrationID) === want)
  // (a re-sign-in's label gets a number: `Linear 2`, `X app 2`)
  const byLabel = (c) => normName(c?.label) === want || normName(c?.label).replace(/\d+$/, "") === want
  const hits = named.length ? named : list.filter(byLabel)
  const ids = new Set(hits.map((c) => c.integrationID))
  return list.find((c) => ids.has(c?.integrationID) && c?.active) ?? null
}

/**
 * The app-client steps of the walk, before the vendors that need them. Each is the owner's own already-configured app, copied from the real
 * profile (client configuration only, never a user token): slack-app and x-app are credentials of integrations of those names; gws-app is the
 * Desktop OAuth client the gws sign-in reads, kept in the real profile inside gws-default's credential metadata, and put in the evals profile as
 * the gws plugin's `oauthClient` option ($EVALS_STORE/evals-gws-client.json, mode 600).
 */
export const CLIENT_STEPS = Object.freeze({ "gws-app": "gws", "slack-app": "slack", "x-app": "x" })

/** The step order of the walk: each app-client step precedes its vendor. */
export const WALK_ORDER = Object.freeze(SIGNIN_ORDER.flatMap((v) => Object.entries(CLIENT_STEPS).filter(([, vendor]) => vendor === v).map(([step]) => step).concat(v)))

/**
 * The ACTIVE app-client entry of `slack-app` or `x-app` from `auth export` output, cut to the client's configuration: type, client id (`key`) and
 * the optional client secret. Nothing else survives: no user token can ride along. Null when there is none.
 */
export function appClientEntry(exported, integration) {
  const c = activeCredential(exported, integration)
  if (!c || c.integrationID !== integration || c.value?.type !== "key" || typeof c.value.key !== "string" || !c.value.key) return null
  const secret = c.value.metadata?.client_secret
  return { integrationID: integration, label: typeof c.label === "string" ? c.label : integration, active: true, value: { type: "key", key: c.value.key, ...(typeof secret === "string" ? { metadata: { client_secret: secret } } : {}) } }
}

/** The Desktop OAuth client of a real gws sign-in: { clientId, clientSecret } from the credential's own metadata, or null. */
export function gwsClient(exported, integration = "gws-default") {
  const m = activeCredential(exported, integration)?.value?.metadata
  // A Web application client keeps its redirect_uris and a confidential secret: it is not copied (the plugin takes a Web client only through the sign-in form's hidden field).
  if (Array.isArray(m?.clientRedirectUris) && m.clientRedirectUris.length) return null
  return typeof m?.clientId === "string" && m.clientId && typeof m?.clientSecret === "string" && m.clientSecret ? { clientId: m.clientId, clientSecret: m.clientSecret } : null
}

/** The secrets of a credential as digests: { access, refresh } (null when absent). The tokens themselves go no further than this call. */
export const digestsOf = (credential) => ({ access: credential?.value?.access ? sha256(credential.value.access) : null, refresh: credential?.value?.refresh ? sha256(credential.value.refresh) : null })

// ---- The refresh chain (EVALS-232 §1.2.3 rule 3): a baseline, then a later refresh. Times only ----------------------------------------------
// The evals sign-in must not have broken the real profile's refresh. A token's lifetime is NOT knowable from here (RECHECK_HOURS is a recheck
// interval, and Notion and Jira tokens really last 8 h), so nothing infers a mint time. Instead the real credential's `expires` is recorded as a
// baseline — a time, never a token or a digest of one — when the vendor is signed in, or at the first check-real after the baseline existed.
// The chain is verified only when a later check reads a LATER `expires` (a refresh happened after the baseline) and the identity read passes.

/** Where the baselines live in the private store: one time per vendor. */
export const BASELINE_FILE = "refresh-baseline.json"
/** A value more than this far from now is not trusted as an expiry (seconds/ms mistakes, a broken export). */
export const EXPIRY_TRUST_MS = 30 * 24 * 3_600_000
/** Is `expires` a time that can be trusted as an access token's expiry now? */
export const trustedExpiry = (expires, now = Date.now()) => Number.isFinite(expires) && Math.abs(expires - now) <= EXPIRY_TRUST_MS

/** Epoch ms from an exported time: a number in ms (in seconds when below 1e12), a numeric string, or an ISO date. Null when it is not a time. */
export function timeValue(v) {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return null
    return Math.round(v < 1e12 ? v * 1000 : v)
  }
  if (typeof v === "string" && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return Math.round(n < 1e12 ? n * 1000 : n)
    const at = Date.parse(v)
    return Number.isNaN(at) ? null : at
  }
  return null
}

/** The credential's access-token expiry (epoch ms), or null. Only the time is read, never the token. */
export const credentialExpires = (credential) => timeValue(credential?.value?.expires ?? credential?.expires)

/** The vendor's baseline from the store: { expires, at, source }, or null. A time only: no token, no digest. */
export function readBaseline(store, integration, { now = Date.now(), warn = (message) => console.error(message) } = {}) {
  if (!store) return null
  const { all, file } = readBaselineFile(store)
  if (!all || all[integration] === undefined) return null
  const why = baselineProblem(all[integration], now)
  if (why) {
    warn(`refresh baseline for ${integration}: ${why}; ignoring it and taking a new one (${file})`)
    return null
  }
  return normaliseBaseline(all[integration])
}

/** Is a stored baseline entry trustworthy? Null when it is, else why not. */
function baselineProblem(entry, now) {
  const expires = timeValue(entry?.expires)
  if (!expires) return "its expiry is not a time"
  const at = typeof entry?.at === "string" ? Date.parse(entry.at) : NaN
  if (Number.isNaN(at)) return "its time is not a date"
  if (at > now) return "it was taken in the future"
  if (Math.abs(expires - at) > EXPIRY_TRUST_MS) return "its expiry is more than 30 days from when it was taken"
  if (Math.abs(expires - now) > EXPIRY_TRUST_MS) return "its expiry is more than 30 days from now"
  return null
}

const normaliseBaseline = (entry) => ({ expires: timeValue(entry.expires), at: entry.at, source: typeof entry.source === "string" ? entry.source : "check-real", evalsId: typeof entry.evalsId === "string" && entry.evalsId ? entry.evalsId : null })

/** The baseline file's JSON object, or null; `corrupt` when the file exists but is not one. */
function readBaselineFile(store) {
  const file = join(store, BASELINE_FILE)
  let text
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return { file, all: null, corrupt: false }
  }
  try {
    const all = JSON.parse(text)
    if (all && typeof all === "object" && !Array.isArray(all)) return { file, all, corrupt: false }
  } catch {}
  return { file, all: null, corrupt: true }
}

const utcStamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")

/** Writes the file under a unique temp name and renames it: a reader sees the old file or the new one, never half of either. */
function writeBaselineFile(file, all) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, file)
  } finally {
    try {
      unlinkSync(tmp)
    } catch {}
  }
}

const sleepBriefly = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * Runs `fn` while holding the baseline lock, so two rechecks cannot lose each other's vendor (a unique temp name alone does not stop a
 * lost update). A lock older than 30 s is stale and is removed; if the lock still cannot be taken after two seconds the work runs anyway —
 * a recheck must never throw for it, and the entry it writes is still a time it read itself.
 */
function withBaselineLock(store, fn) {
  const lock = join(store, `${BASELINE_FILE}.lock`)
  const deadline = Date.now() + 2_000
  let held = false
  while (!held) {
    try {
      closeSync(openSync(lock, "wx", 0o600))
      held = true
    } catch (error) {
      if (error.code !== "EEXIST") break
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) {
          unlinkSync(lock)
          continue
        }
      } catch {}
      if (Date.now() > deadline) break
      sleepBriefly(10)
    }
  }
  try {
    return fn()
  } finally {
    if (held) {
      try {
        unlinkSync(lock)
      } catch {}
    }
  }
}

/**
 * Records a vendor's baseline and returns it. `replace: true` is a sign-in: the vendor's baseline becomes the new fixed point (an untrusted
 * or missing expiry clears it rather than keeping an older one). `replace: false` is check-real: it keeps the first baseline, for the SAME
 * evals credential (`evalsId`): a baseline from another credential is stale and is replaced. A corrupt file is moved aside as
 * `<file>.corrupt-<UTC date-time>` and a new one started; other vendors' valid entries are kept. Times only.
 */
export function recordBaseline(store, integration, expires, { at = new Date().toISOString(), source = "check-real", now = Date.now(), replace = false, evalsId = null, warn = (message) => console.error(message) } = {}) {
  if (!store) return null
  mkdirSync(store, { recursive: true, mode: 0o700 })
  const id = typeof evalsId === "string" && evalsId ? evalsId : null
  const existing = readBaseline(store, integration, { now, warn: () => {} })
  if (existing && !replace && existing.evalsId === id) return existing
  return withBaselineLock(store, () => {
    const { file, all, corrupt } = readBaselineFile(store)
    let base = all ?? {}
    if (corrupt) {
      // Unreadable JSON cannot contribute other vendors' entries: keep it as evidence and start a fresh file.
      try {
        renameSync(file, `${file}.corrupt-${utcStamp()}`)
        warn(`refresh baselines: ${file} was not readable JSON; moved it aside and started a new file`)
      } catch {}
      base = {}
    }
    const current = base[integration]
    if (!replace && current && current.evalsId === id && !baselineProblem(current, now)) return normaliseBaseline(current)
    if (!trustedExpiry(expires, now)) {
      // A sign-in whose real expiry cannot be trusted must not leave an older fixed point behind.
      if (replace && current !== undefined) {
        delete base[integration]
        writeBaselineFile(file, base)
      }
      return null
    }
    base[integration] = { expires: Math.round(expires), at, source, ...(id ? { evalsId: id } : {}) }
    mkdirSync(store, { recursive: true, mode: 0o700 })
    writeBaselineFile(file, base)
    return base[integration]
  })
}

/**
 * Removes a vendor's baseline (a sign-in is about to replace it), or the whole file when no vendor is given. Store only: no profile and no
 * real read. Returns whether it removed something.
 */
export function forgetBaseline(store, integration = null) {
  if (!store) return false
  mkdirSync(store, { recursive: true, mode: 0o700 })
  const file = join(store, BASELINE_FILE)
  if (!integration) {
    try {
      unlinkSync(file)
      return true
    } catch {
      return false
    }
  }
  return withBaselineLock(store, () => {
    const { all } = readBaselineFile(store)
    if (!all || all[integration] === undefined) return false
    delete all[integration]
    writeBaselineFile(file, all)
    return true
  })
}

/**
 * The refresh-chain verdict of one PASS. `verified` only when the current real expiry is LATER than the baseline (a refresh after it) and
 * `identityOk` (the identity read passed); `provisional` with a fixed `recheckAt` = the baseline's expiry + 5 min otherwise, or with
 * `known: false` when the current expiry is missing, unparsable or not trusted. No lifetime is inferred, and no time is taken from a token.
 */
export function refreshChain({ expires, baseline, identityOk = true, now = Date.now() }) {
  const known = trustedExpiry(expires, now)
  const fixed = baseline ? new Date(baseline.expires + 5 * 60_000).toISOString() : null
  if (!known) return { verified: false, provisional: true, known: false, recheckAt: fixed }
  if (!baseline) return { verified: false, provisional: true, known: true, recheckAt: new Date(expires + 5 * 60_000).toISOString() }
  if (identityOk && expires > baseline.expires) return { verified: true, provisional: false, known: true, recheckAt: null }
  return { verified: false, provisional: true, known: true, recheckAt: fixed }
}

/** Appends one JSON line to the round log (a file in the private store). */
export function logRound(store, entry) {
  mkdirSync(store, { recursive: true, mode: 0o700 })
  appendFileSync(join(store, "round-232.log"), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 })
}

/** How many check timeouts for this integration are consecutive at the end of its round-log entries (a finished check ends the streak). */
export function checkTimeoutStreak(store, integration) {
  if (!store) return 0
  let text
  try {
    text = readFileSync(join(store, "round-232.log"), "utf8")
  } catch {
    return 0
  }
  let streak = 0
  for (const line of text.split("\n").reverse()) {
    if (!line.trim()) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry?.integration !== integration) continue
    if (entry.event === "check-timeout") streak++
    else if (entry.event === "check-real") break
  }
  return streak
}

export { readFileSync }
