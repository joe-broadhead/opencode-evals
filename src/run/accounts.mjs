// Plugins that run with no account (the owner's decision: GitHub and Jira are not signed in to the evals profile, whatever their clients'
// risk to the real profile). A plugin's setting is `accounts`:
//   "signed-in"  the default: its trials hold the evals profile's credential for it
//   "fake"       GitHub's and Jira's setting: no account and no real endpoint, and still measurable. The harness's own fake MCP server serves the
//                plugin's released tool list (packs/<id>/mcp.json) and answers from a synthetic fixture; the plugin runs as released, pointed at it
//                by an MCP override in the sealed config. See src/run/fake-mode.mjs. Its cases are `Data: synthetic`.
//   "none"       its cases run with no credential and no server. Its tools exist only after a sign-in, so a call to one is an attempt that finds no tool.
//                Writes stay graded at the declined call (nothing reaches the vendor); reads are graded on tool choice and arguments, and on
//                an honest "not signed in" answer rather than invented data. A case that reads nothing needs no target and no canary, is not
//                deferred for lack of a credential, and is not held by the data sign-off (no third party's words reach any model).
// The setting is in the plugin's pack (`accounts` in packs/<id>/pack.json, committed) and the owner's `$EVALS_STORE/round.json` overrides it
// (`{ "accounts": { "github": "none", "slack": "signed-in" } }`), so the round's config can change without a commit.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { seedPlugins } from "../case/schema.mjs"

export const ACCOUNTS = ["signed-in", "none", "fake"]

function roundConfig(store) {
  try {
    const file = join(store, "round.json")
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
  } catch {
    // An unreadable round config changes nothing: every plugin keeps what its pack says.
    return {}
  }
}

/** The plugins whose setting is `mode`: the packs' `accounts`, as the store's round.json overrides them. */
function pluginsWith(mode, { packs = [], store = null } = {}) {
  const out = new Set(packs.filter((pack) => pack.accounts === mode).map((pack) => pack.id))
  const overrides = store ? roundConfig(store).accounts ?? {} : {}
  for (const [id, value] of Object.entries(overrides)) {
    if (value === mode) out.add(id)
    else if (ACCOUNTS.includes(value)) out.delete(id)
  }
  return out
}

/** The plugins that run with no account and no server (`accounts: "none"`): not measurable. */
export const noAccountPlugins = (options) => pluginsWith("none", options)

/** The plugins that run against the harness's fake MCP server (`accounts: "fake"`): no account, no real endpoint, measurable. */
export const fakePlugins = (options) => pluginsWith("fake", options)

/** The plugins that hold no credential in a trial, of either kind: nothing is asked of the evals profile for them and no vendor host is opened. */
export const noCredentialPlugins = (options) => new Set([...noAccountPlugins(options), ...fakePlugins(options)])

/**
 * The plugins whose credential the evals profile cannot hold: the fake-mode plugins (github, jira) and the local plugins
 * whose pack says `"profile": false` (charts, history, jobs, utilities, voice, boxd, browse). This is ONLY the
 * `+profile` filter — `integrationsFor`/`needed` — because their tools work locally; it must not touch grading, gating,
 * egress or reach, which keep the master meaning of `accounts` (`noAccountPlugins`/`noCredentialPlugins`). The marker is
 * a pack field no other code reads; `round.json` overrides `accounts`, not this. Inference is NOT marked: its
 * `decide`/`extract` spend on its own `inference-openrouter` key (`src/providers/openrouter/http.ts` of
 * opencode-inference 0.0.7 resolves it at dispatch), so a batch that names inference fails closed when the profile lacks
 * it instead of silently running the spending tools keyless.
 */
export const noProfilePlugins = (options = {}) => new Set([...noCredentialPlugins(options), ...pluginsMarked(options)])

/** The plugins whose pack carries a field set to `value`: static, never overridden by the store. */
function pluginsMarked({ packs = [] } = {}) {
  return new Set(packs.filter((pack) => pack.profile === false).map((pack) => pack.id))
}

/** The plugins a case uses: its own and every one its `Seed: plugins=` names. */
export const pluginsOf = (caseObject) => [...new Set([caseObject.plugin, ...seedPlugins(caseObject.seed)])]

/** Does every plugin the case uses run with no account? Such a case reads no data and needs no credential, target or canary. */
export const usesOnlyNoAccount = (caseObject, noAccount) => Boolean(noAccount?.size) && pluginsOf(caseObject).every((id) => noAccount.has(id))

/** `github.get_pull_request`, `github_get_pull_request` and `jira_getJiraIssue` name their plugin first. */
export const pluginOfTool = (tool) => String(tool ?? "").split(/[._]/)[0]
