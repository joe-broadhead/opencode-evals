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
 * The plugins whose credential the evals profile does not hold for the batch: `noCredentialPlugins` (`accounts: "fake"`,
 * such as github and jira, plus `accounts: "none"` in packs or `$EVALS_STORE/round.json`) and the local plugins whose pack
 * says `"profile": false` (charts, history, jobs, utilities, voice, boxd, browse). This is ONLY the `+profile` filter —
 * `integrationsFor`/`needed` — because local plugins' tools work locally; grading, gating, egress and reach keep the
 * master meaning of `accounts` (`noAccountPlugins`/`noCredentialPlugins`). Inference is marked `profile: false` ON PURPOSE, although
 * its `decide`/`extract` use their own `inference-openrouter` key: opencode-inference 0.0.7 asserts no permission for them (the
 * dispatcher never asks for the tool's own action, and a `kind: text` source needs no file read), so at `ask-changes` a call that
 * holds a key is not asked and spends (the live write probe, 21 Nov 2026: one real Decisions call, a HALT). Keyless, the call fails at
 * sign-in before anything is sent. (`plugin-rules.json` lists both tools as `asked` because its probe plugin asks the host for each action; the tool's own dispatch never does.) Take the marker off only for a release that asks first.
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
