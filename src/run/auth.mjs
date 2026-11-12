// Where a live run's model credential comes from. Always named on the command line (`--auth`, or EVALS_AUTH): a run
// never picks one up by accident, and nothing here is ever written into the repository or the store.
//
//   none            nothing: a mock model, or a provider that needs no sign-in
//   env:A,B         these variables of the caller's environment, passed to the run as they are (an API key)
//   claude-agent    OpenCode's Claude Agent provider, the way the History lab ran it:
//                   - the credential OpenCode stores as "Claude Agent" (EVALS_AUTH_CREDENTIAL to name another) is a
//                     marker, with no secret in it. It is exported from the caller's own OpenCode once, held in memory,
//                     and piped into each sandbox's `opencode auth import --standalone`, and is deleted with the sandbox.
//                     The export is the one command run with the caller's own environment: it must read the caller's
//                     stored credential from the caller's own OpenCode, and its output goes to the sandbox, never to disk;
//                   - the secret is `claude`'s own sign-in, ~/.claude/.credentials.json: an access token and a long-lived
//                     refresh token. The runner reads it at the batch's start and again before each trial (O_NOFOLLOW, a regular
//                     file, at most 64 KB, the shape `claude` writes: the sign-in is rotated outside the run) and keeps only
//                     the access token and its expiry, in memory; every value it saw is scrubbed. No file of it is
//                     copied anywhere, and the refresh token is never passed on: each run's processes get the access
//                     token alone, as CLAUDE_CODE_OAUTH_TOKEN, which `claude` uses for the whole session and never
//                     refreshes or writes. The caller's ~/.claude is never written;
//                   - so a batch must not outlive the token: it is refused when the access token expires within the
//                     batch's worst case (the run timeout times the rounds of runs, plus ten minutes);
//                   - each sandbox has an empty private ~/.claude (CLAUDE_CONFIG_DIR): no .credentials.json, no
//                     ~/.claude.json, nothing of the caller's settings, hooks, CLAUDE.md or MCP servers; prompt history
//                     and nonessential traffic are off (CLAUDE_CODE_SKIP_PROMPT_HISTORY, ..._DISABLE_NONESSENTIAL_TRAFFIC);
//                   - the token is a secret the agent under test can read from its environment; the runner scrubs it,
//                     by exact value, from every recording, summary, files record, batch record and log line it
//                     writes, and from a kept sandbox. Keeping it from leaving a run is the isolation design's job;
//                   - CLAUDE_AGENT_SDK_VERSION must be set, and is passed on; claude's auto-updater is off.

import { closeSync, constants, existsSync, fstatSync, mkdirSync, openSync, readSync, rmSync } from "node:fs"
import { join } from "node:path"
import { runToEnd, removeInside } from "./sandbox.mjs"

export const CREDENTIAL_LIMIT = 64 * 1024

/**
 * Reads the caller's credentials file without following a link, without blocking on a FIFO, and without reading more
 * than the limit; checks it is the shape `claude` writes. Errors name the problem, never the content.
 */
export function readCredential(file) {
  let fd
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    if (error.code === "ELOOP") throw new Error(`${file} is a symbolic link: refusing to read the sign-in through it`)
    if (error.code === "ENOENT") throw new Error(`no ${file}: sign in with \`claude\` first`)
    throw new Error(`${file} could not be opened (${error.code})`)
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error(`${file} is not a regular file`)
    if (stat.size > CREDENTIAL_LIMIT) throw new Error(`${file} is ${stat.size} bytes, more than a sign-in (${CREDENTIAL_LIMIT})`)
    const bytes = Buffer.alloc(stat.size)
    let read = 0
    while (read < stat.size) {
      const n = readSync(fd, bytes, read, stat.size - read, read)
      if (n === 0) break
      read += n
    }
    // The whole file is parsed (JSON has no partial parse), so the refresh token passes through memory while it is: the
    // reviver drops it from the parsed object, only the access token and its expiry are returned, and the bytes read are
    // zeroed.
    let data
    try {
      data = JSON.parse(bytes.subarray(0, read).toString("utf8"), (key, value) => (key === "refreshToken" ? undefined : value))
    } catch {
      throw new Error(`${file} is not JSON`)
    } finally {
      bytes.fill(0)
    }
    const oauth = data?.claudeAiOauth
    // An expiry that is null or absent is unknown (a sign-in something outside keeps fresh, as boxd does); any other
    // non-number is not a sign-in. The refresh token is parsed with the file but never kept, returned or passed on.
    const expiry = oauth?.expiresAt
    if (!oauth || typeof oauth !== "object" || typeof oauth.accessToken !== "string" || !oauth.accessToken || (expiry !== null && expiry !== undefined && typeof expiry !== "number")) {
      throw new Error(`${file} does not hold a Claude sign-in (claudeAiOauth with an access token and its expiry)`)
    }
    return { accessToken: oauth.accessToken, expiresAt: typeof expiry === "number" ? expiry : null }
  } finally {
    closeSync(fd)
  }
}

/** The sign-in could not be re-read before a trial: the trial is infra: auth and the batch stops launching. */
export class AuthRefreshError extends Error {
  constructor(message) {
    super(`the sign-in could not be re-read before the trial: ${message}`)
    this.name = "AuthRefreshError"
  }
}

/** What to do with a sign-in whose expiry is unknown: refuse, unless --accept-unknown-token-expiry. */
export function unknownExpiry(accept) {
  if (accept) return { expires: "unknown", accepted_by_flag: true }
  throw new Error(
    "--auth claude-agent: the Claude sign-in has no expiry (expiresAt is null or absent), so this batch cannot be checked against it. If something outside keeps the sign-in fresh (boxd does), pass --accept-unknown-token-expiry: a trial whose token is then refused is recorded as infra: auth, and the batch stops launching",
  )
}

/** Refuses a batch that could outlive the token it would run on. */
export function assertTokenLasts(expiresAt, horizonMs, now = Date.now()) {
  const marginMs = 10 * 60_000
  if (expiresAt - now < horizonMs + marginMs) {
    const minutes = Math.ceil((horizonMs + marginMs) / 60_000)
    throw new Error(
      `--auth claude-agent: the Claude sign-in expires at ${new Date(expiresAt).toISOString()}, within the ${minutes} minutes this batch may need. A sandboxed run never refreshes the caller's sign-in, so refresh it first (start \`claude\` once interactively, then quit) and retry`,
    )
  }
}

export function parseAuth(spec) {
  const text = String(spec ?? "").trim()
  if (!text) throw new Error("--auth is required: none, env:<VAR>[,<VAR>...] or claude-agent (see docs/running.md)")
  if (text === "none") return { kind: "none" }
  if (text === "claude-agent") return { kind: "claude-agent" }
  if (text.startsWith("env:")) {
    const names = text.slice(4).split(",").map((name) => name.trim()).filter(Boolean)
    if (!names.length || names.some((name) => !/^[A-Z_][A-Z0-9_]*$/.test(name))) throw new Error(`--auth env: needs variable names, not ${JSON.stringify(text)}`)
    return { kind: "env", names }
  }
  throw new Error(`unknown --auth ${JSON.stringify(text)}: use none, env:<VAR>[,<VAR>...] or claude-agent`)
}

/**
 * Checks the profile once per batch and returns what each run needs. `binary` is the host the credential is exported
 * with; `caller` is the caller's environment.
 */
export async function prepareAuth(profile, { binary, caller = process.env, horizonMs = 0, acceptUnknownExpiry = false }) {
  if (profile.kind === "none") return { profile: "none", env: {}, secrets: [], forTrial() { return { env: {}, rotated: false } }, async apply() {}, cleanup() {} }
  if (profile.kind === "env") {
    const missing = profile.names.filter((name) => !caller[name])
    if (missing.length) throw new Error(`--auth env: ${missing.join(", ")} not set`)
    const env = Object.fromEntries(profile.names.map((name) => [name, caller[name]]))
    // A key passed through is a secret too: scrubbed from everything the runner writes.
    return { profile: `env:${profile.names.join(",")}`, env, secrets: Object.values(env), forTrial() { return { env, rotated: false } }, async apply() {}, cleanup() {} }
  }
  // claude-agent
  const realHome = caller.HOME
  if (!realHome || !existsSync(join(realHome, ".claude"))) throw new Error("--auth claude-agent: no ~/.claude; sign in with `claude` first")
  if (!caller.CLAUDE_AGENT_SDK_VERSION) throw new Error("--auth claude-agent: set CLAUDE_AGENT_SDK_VERSION (the version the Claude Agent provider runs with)")
  const name = caller.EVALS_AUTH_CREDENTIAL ?? "Claude Agent"
  const exported = await runToEnd(binary, ["auth", "export", name], { env: caller, timeoutMs: 30_000 })
  if (exported.code !== 0 || !exported.stdout.trim()) throw new Error(`--auth claude-agent: \`opencode auth export ${JSON.stringify(name)}\` failed (exit ${exported.code}); is the credential stored?`)
  const credential = exported.stdout
  // The access token alone, held in memory; the caller's file is never written, and nothing of it copied. It is read
  // here for the batch's checks, and again before each trial (forTrial): the sign-in can be rotated by something
  // outside (boxd keeps it fresh), which revokes the value read earlier.
  const credentialFile = join(realHome, ".claude", ".credentials.json")
  const signIn = readCredential(credentialFile)
  const seen = [signIn.accessToken]
  // A known expiry is checked against the batch's horizon; an unknown one is refused unless the caller accepts it.
  const expiry = signIn.expiresAt === null ? unknownExpiry(acceptUnknownExpiry) : (assertTokenLasts(signIn.expiresAt, horizonMs), null)
  return {
    profile: "claude-agent",
    ...(expiry ? { expiry } : {}),
    env: {
      CLAUDE_AGENT_SDK_VERSION: caller.CLAUDE_AGENT_SDK_VERSION,
      CLAUDE_CODE_OAUTH_TOKEN: signIn.accessToken,
      CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_AUTOUPDATER: "1",
    },
    /** Every access-token value this batch has read: each is scrubbed from everything the runner writes. */
    get secrets() {
      return [...seen]
    },
    /**
     * The token for the next trial, read again with the same guarded read. Throws AuthRefreshError when the file can
     * no longer be read or holds no access token; the error names the problem, never the content.
     */
    forTrial() {
      let token
      try {
        token = readCredential(credentialFile).accessToken
      } catch (error) {
        throw new AuthRefreshError(error.message)
      }
      if (!token) throw new AuthRefreshError(`${credentialFile} holds an empty access token`)
      const fresh = !seen.includes(token)
      if (fresh) seen.push(token)
      return { env: { ...this.env, CLAUDE_CODE_OAUTH_TOKEN: token }, rotated: fresh, secret: token }
    },
    holdsCredential: true,
    async apply({ sandbox, env, exec = (args, options) => runToEnd(binary, args, { cwd: sandbox.home, env, ...options }) }) {
      // The sandbox's own ~/.claude, empty: whatever a world's home brought is replaced, and no sign-in file is made.
      const dir = join(sandbox.home, ".claude")
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(sandbox.home, ".claude.json"), { force: true })
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      env.CLAUDE_CONFIG_DIR = dir
      const imported = await exec(["auth", "import", "--standalone"], { cwd: sandbox.home, input: credential, timeoutMs: 60_000 })
      if (imported.code !== 0) throw new Error(`the credential import into the sandbox failed (exit ${imported.code})`)
    },
    /** Nothing of the sign-in is on disk; a credentials file a run made for itself goes anyway. */
    cleanup({ sandbox, gone = false }) {
      // Through no link: a run that made home/.claude a link out of the sandbox cannot aim this removal elsewhere.
      return removeInside(sandbox.root, join(sandbox.home, ".claude", ".credentials.json"), { gone }) ? "removed" : "kept: the run may still be running"
    },
  }
}
