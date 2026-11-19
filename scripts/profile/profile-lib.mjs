// The evals profile (EVALS-232 §1.2): the helpers `check-real`, `keeper` and the tests share. Nothing here prints a credential.

import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, lstatSync } from "node:fs"
import { join } from "node:path"
import { userInfo } from "node:os"

export const sha256 = (text) => createHash("sha256").update(String(text)).digest("hex")

/** One free, read-only identity call per signed-in integration (§1.2.6): the tools RPC route of its identity tool. */
export const IDENTITY = Object.freeze({
  linear: "linear.workspace.tools/linear_whoami",
  jira: "jira.issues.tools/jira_atlassianUserInfo",
  notion: "notion.workspace.tools/notion_notion-get-self",
  granola: "granola.meetings.tools/granola_get_account_info",
  github: "github.platform.tools/github_get_me",
  metaview: "metaview.workspace.tools/metaview_get_user_context",
  plaud: "plaud.recordings.tools/plaud_get_current_user",
  gws: "google-workspace.gws.tools/gws_status",
  slack: "slack.workspace.tools/slack_slack_read_user_profile",
  wisprflow: "wisprflow.meetings.tools/wisprflow_list_folders",
  elevenlabs: "elevenlabs.tools/elevenlabs_creative_list_voices",
  ashby: "ashby.recruiting.tools/ashby_get_pending_tasks",
  affinity: "affinity.crm.tools/affinity_get_current_user",
  x: "x.posts.tools/x_get_usage_credits",
})

/**
 * The order the evals profile is signed in, one vendor at a time, each followed by check-real (the plan's section 1.2.3, less the two the
 * owner decided not to sign in: GitHub and Jira run with no account, `accounts: none`). Slack, X and Google use the apps already configured:
 * no second app or client. The first two are not in the real profile at all.
 */
export const SIGNIN_ORDER = Object.freeze(["openrouter", "affinity", "ashby", "plaud", "gws", "slack", "x", "elevenlabs", "wisprflow", "metaview", "granola", "notion", "linear"])

/** Vendors the real profile does not hold (new for the round): there is nothing of the owner's to sign out of, so check-real has no real token to compare. */
export const NOT_IN_REAL = Object.freeze(["openrouter", "affinity"])

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

/** The profile's config: the Claude Agent provider is denied, so the profile never spawns `claude`. */
export const profileConfig = () => ({ policies: [{ action: "provider.use", resource: "claude-agent", effect: "deny" }] })

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

/** Runs a command and returns { code, stdout, stderr }; never throws, never echoes. */
export function run(command, args, { env, input, timeoutMs = 60_000 } = {}) {
  const out = spawnSync(command, args, { env, input, encoding: "utf8", timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 })
  return { code: out.status, stdout: out.stdout ?? "", stderr: out.stderr ?? "", error: out.error ? String(out.error.message) : null }
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
  const matches = list.filter((c) => c?.integrationID === integration || String(c?.label ?? "").toLowerCase() === integration)
  return matches.find((c) => c.active) ?? matches[0] ?? null
}

/** The secrets of a credential as digests: { access, refresh } (null when absent). The tokens themselves go no further than this call. */
export const digestsOf = (credential) => ({ access: credential?.value?.access ? sha256(credential.value.access) : null, refresh: credential?.value?.refresh ? sha256(credential.value.refresh) : null })

/** Appends one JSON line to the round log (a file in the private store). */
export function logRound(store, entry) {
  mkdirSync(store, { recursive: true, mode: 0o700 })
  appendFileSync(join(store, "round-232.log"), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 })
}

export { readFileSync }
