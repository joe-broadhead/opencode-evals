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
//                     holding one thing: a symlink to the caller's ~/.claude/.credentials.json. Nothing else of the
//                     caller's ~/.claude (settings, hooks, CLAUDE.md, MCP servers, agents, plugins) is visible to the
//                     run, there is no ~/.claude.json, and everything `claude` writes (projects/, history.jsonl, todos/,
//                     shell-snapshots/, file-history/) lands in the sandbox and is deleted with it;
//                   - a token refresh inside the run: `claude` writes credentials by replacing the file, which
//                     replaces the symlink with a file of its own in the sandbox. When that file holds a later token
//                     than the caller's, it is written back over the caller's (atomically, mode 0600), so a rotated
//                     refresh token never leaves the caller signed out. That is the only write to the caller's ~/.claude;
//                   - CLAUDE_AGENT_SDK_VERSION must be set, and is passed on; claude's auto-updater is off.

import { existsSync, lstatSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { runToEnd } from "./sandbox.mjs"

/** The OAuth expiry a credentials file holds, or null; the file's content is never shown. */
const expiryOf = (file) => {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"))
    const value = data?.claudeAiOauth?.expiresAt
    return typeof value === "number" ? value : null
  } catch {
    return null
  }
}

/** Writes a refreshed sandbox credential back over the caller's, when it is the newer one. */
export function writeBackCredential(sandboxFile, realFile) {
  let stat
  try {
    stat = lstatSync(sandboxFile)
  } catch {
    return "absent"
  }
  if (stat.isSymbolicLink()) return "unchanged"
  const refreshed = expiryOf(sandboxFile)
  const current = expiryOf(realFile)
  if (refreshed === null) return "unreadable"
  if (current !== null && refreshed <= current) return "older"
  const tmp = `${realFile}.evals-${randomBytes(4).toString("hex")}`
  writeFileSync(tmp, readFileSync(sandboxFile), { mode: 0o600 })
  renameSync(tmp, realFile)
  return "written"
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
export async function prepareAuth(profile, { binary, caller = process.env }) {
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
  const realCredentials = join(realHome, ".claude", ".credentials.json")
  if (!existsSync(realCredentials)) throw new Error("--auth claude-agent: no ~/.claude/.credentials.json; sign in with `claude` first")
  return {
    profile: "claude-agent",
    env: { CLAUDE_AGENT_SDK_VERSION: caller.CLAUDE_AGENT_SDK_VERSION, DISABLE_AUTOUPDATER: "1" },
    holdsCredential: true,
    async apply({ sandbox, env }) {
      // The sandbox's own ~/.claude, with the sign-in and nothing else: whatever a world's home brought is replaced.
      const dir = join(sandbox.home, ".claude")
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(sandbox.home, ".claude.json"), { force: true })
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      symlinkSync(realCredentials, join(dir, ".credentials.json"))
      env.CLAUDE_CONFIG_DIR = dir
      const imported = await runToEnd(binary, ["auth", "import", "--standalone"], { cwd: sandbox.home, env, input: credential, timeoutMs: 60_000 })
      if (imported.code !== 0) throw new Error(`the credential import into the sandbox failed (exit ${imported.code})`)
    },
    /** A token the run refreshed goes back to the caller's file; nothing else of the sandbox leaves it. */
    cleanup({ sandbox }) {
      return writeBackCredential(join(sandbox.home, ".claude", ".credentials.json"), realCredentials)
    },
  }
}
