// Where a live run's model credential comes from. Always named on the command line (`--auth`, or EVALS_AUTH): a run
// never picks one up by accident, and nothing here is ever written into the repository or the store.
//
//   none            nothing: a mock model, or a provider that needs no sign-in
//   env:A,B         these variables of the caller's environment, passed to the run as they are (an API key)
//   claude-agent    OpenCode's Claude Agent provider, the way the History lab ran it:
//                   - the credential OpenCode stores as "Claude Agent" (EVALS_AUTH_CREDENTIAL to name another) is
//                     exported from the caller's own OpenCode once, held in memory, and piped into each sandbox's
//                     `opencode auth import --standalone`; it lands in the sandbox's database and is deleted with it;
//                   - the provider spawns `claude`, which reads its own sign-in: ~/.claude and ~/.local/bin are linked
//                     into the sandbox home (shared, never copied), and the sandbox gets a ~/.claude.json holding
//                     only the onboarding flags and the account id fields;
//                   - CLAUDE_AGENT_SDK_VERSION must be set, and is passed on;
//                   - `claude` writes a transcript per working directory under ~/.claude/projects/; after each run the
//                     directory for that run's sandbox path is removed, and nothing else.

import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync, realpathSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import { runToEnd } from "./sandbox.mjs"

const CLAUDE_KEYS = ["hasCompletedOnboarding", "lastOnboardingVersion", "oauthAccount", "userID"]

/** The directory `claude` keeps a working directory's transcripts in. */
export const claudeProjectDir = (realHome, cwd) => join(realHome, ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"))

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
  const account = (() => {
    try {
      const all = JSON.parse(readFileSync(join(realHome, ".claude.json"), "utf8"))
      return Object.fromEntries(CLAUDE_KEYS.filter((key) => key in all).map((key) => [key, all[key]]))
    } catch {
      return {}
    }
  })()
  return {
    profile: "claude-agent",
    env: { CLAUDE_AGENT_SDK_VERSION: caller.CLAUDE_AGENT_SDK_VERSION },
    async apply({ sandbox, env }) {
      for (const link of [".claude", join(".local", "bin")]) {
        const target = join(realHome, link)
        const at = join(sandbox.home, link)
        if (!existsSync(target) || existsSync(at)) continue
        mkdirSync(dirname(at), { recursive: true })
        symlinkSync(target, at)
      }
      writeFileSync(join(sandbox.home, ".claude.json"), JSON.stringify(account), { mode: 0o600 })
      const imported = await runToEnd(binary, ["auth", "import", "--standalone"], { cwd: sandbox.home, env, input: credential, timeoutMs: 60_000 })
      if (imported.code !== 0) throw new Error(`the credential import into the sandbox failed (exit ${imported.code})`)
    },
    /** Removes the transcripts `claude` wrote for this run's working directory: that directory only. */
    cleanup({ cwd }) {
      const paths = new Set([cwd])
      try {
        paths.add(realpathSync(cwd))
      } catch {
        // the sandbox is already gone
      }
      const projects = join(realHome, ".claude", "projects")
      for (const path of paths) {
        const dir = claudeProjectDir(realHome, path)
        // Only a directory directly under ~/.claude/projects, named for a path inside this batch.
        if (dirname(dir) === projects && basename(dir).length > 1) rmSync(dir, { recursive: true, force: true })
      }
    },
  }
}
