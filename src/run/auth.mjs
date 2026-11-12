// Where a live run's model credential comes from. Always named on the command line (`--auth`, or EVALS_AUTH): a run
// never picks one up by accident, and nothing here is ever written into the repository or the store.
//
//   none            nothing: a mock model, or a provider that needs no sign-in
//   env:A,B         these variables of the caller's environment, passed to the run as they are (an API key)
//   claude-agent    OpenCode's Claude Agent provider, the way the History lab ran it:
//                   - the credential OpenCode stores as "Claude Agent" (EVALS_AUTH_CREDENTIAL to name another) is
//                     exported from the caller's own OpenCode once, held in memory, and piped into each sandbox's
//                     `opencode auth import --standalone`; it lands in the sandbox's database and is deleted with it.
//                     The export is the one command run with the caller's own environment: it must read the caller's
//                     stored credential from the caller's own OpenCode, and its output goes to the sandbox, never to disk;
//                   - the provider spawns `claude`, which reads its own sign-in. Each sandbox has its own ~/.claude
//                     holding one thing: a copy of the caller's ~/.claude/.credentials.json (a regular file, mode 0600),
//                     read once per batch with O_NOFOLLOW, size-capped and checked for its shape, and never logged.
//                     Nothing else of the caller's ~/.claude (settings, hooks, CLAUDE.md, MCP servers, agents,
//                     plugins) is visible to the run, there is no ~/.claude.json, and everything `claude` writes
//                     (projects/, history.jsonl, todos/, shell-snapshots/, file-history/, a refreshed token) lands
//                     in the sandbox and is deleted with it. A sandboxed run never writes to the caller's ~/.claude;
//                   - so a batch must not outlive the token: it is refused when the access token expires within the
//                     batch's worst case (the run timeout times the rounds of runs, plus ten minutes);
//                   - the copy is readable by the agent under test: the filesystem isolation design covers what a
//                     run can send out. The copy is deleted on every exit path, and --keep keeps it only with
//                     --keep-credentials;
//                   - CLAUDE_AGENT_SDK_VERSION must be set, and is passed on; claude's auto-updater is off.

import { closeSync, constants, existsSync, fstatSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runToEnd } from "./sandbox.mjs"

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
    let data
    try {
      data = JSON.parse(bytes.subarray(0, read).toString("utf8"))
    } catch {
      throw new Error(`${file} is not JSON`)
    }
    const oauth = data?.claudeAiOauth
    if (!oauth || typeof oauth !== "object" || typeof oauth.accessToken !== "string" || !oauth.accessToken || typeof oauth.expiresAt !== "number") {
      throw new Error(`${file} does not hold a Claude sign-in (claudeAiOauth with an access token and its expiry)`)
    }
    return { bytes: bytes.subarray(0, read), expiresAt: oauth.expiresAt }
  } finally {
    closeSync(fd)
  }
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
export async function prepareAuth(profile, { binary, caller = process.env, horizonMs = 0 }) {
  if (profile.kind === "none") return { profile: "none", env: {}, async apply() {}, cleanup() {} }
  if (profile.kind === "env") {
    const missing = profile.names.filter((name) => !caller[name])
    if (missing.length) throw new Error(`--auth env: ${missing.join(", ")} not set`)
    const env = Object.fromEntries(profile.names.map((name) => [name, caller[name]]))
    return { profile: `env:${profile.names.join(",")}`, env, async apply() {}, cleanup() {} }
  }
  // claude-agent
  const realHome = caller.HOME
  if (!realHome || !existsSync(join(realHome, ".claude"))) throw new Error("--auth claude-agent: no ~/.claude; sign in with `claude` first")
  if (!caller.CLAUDE_AGENT_SDK_VERSION) throw new Error("--auth claude-agent: set CLAUDE_AGENT_SDK_VERSION (the version the Claude Agent provider runs with)")
  const name = caller.EVALS_AUTH_CREDENTIAL ?? "Claude Agent"
  const exported = await runToEnd(binary, ["auth", "export", name], { env: caller, timeoutMs: 30_000 })
  if (exported.code !== 0 || !exported.stdout.trim()) throw new Error(`--auth claude-agent: \`opencode auth export ${JSON.stringify(name)}\` failed (exit ${exported.code}); is the credential stored?`)
  const credential = exported.stdout
  // The sign-in, read once and held in memory: each sandbox gets its own copy, and the caller's file is never written.
  const signIn = readCredential(join(realHome, ".claude", ".credentials.json"))
  assertTokenLasts(signIn.expiresAt, horizonMs)
  return {
    profile: "claude-agent",
    env: { CLAUDE_AGENT_SDK_VERSION: caller.CLAUDE_AGENT_SDK_VERSION, DISABLE_AUTOUPDATER: "1" },
    holdsCredential: true,
    async apply({ sandbox, env, exec = (args, options) => runToEnd(binary, args, { cwd: sandbox.home, env, ...options }) }) {
      // The sandbox's own ~/.claude, with the sign-in and nothing else: whatever a world's home brought is replaced.
      const dir = join(sandbox.home, ".claude")
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(sandbox.home, ".claude.json"), { force: true })
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      writeFileSync(join(dir, ".credentials.json"), signIn.bytes, { mode: 0o600, flag: "wx" })
      env.CLAUDE_CONFIG_DIR = dir
      const imported = await exec(["auth", "import", "--standalone"], { cwd: sandbox.home, input: credential, timeoutMs: 60_000 })
      if (imported.code !== 0) throw new Error(`the credential import into the sandbox failed (exit ${imported.code})`)
    },
    /** The sandbox's copy goes, whatever the run did to it; nothing of it reaches the caller's ~/.claude. */
    cleanup({ sandbox }) {
      rmSync(join(sandbox.home, ".claude", ".credentials.json"), { force: true })
      return "removed"
    },
  }
}
