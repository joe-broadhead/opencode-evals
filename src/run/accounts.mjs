// Plugins that run with no account (the owner's decision: GitHub and Jira are not signed in to the evals profile, whatever their clients'
// risk to the real profile). A plugin's setting is `accounts`:
//   "signed-in"  the default: its trials hold the evals profile's credential for it
//   "none"       its cases run with no credential. Its tools exist only after a sign-in, so a call to one is an attempt that finds no tool.
//                Writes stay graded at the declined call (nothing reaches the vendor); reads are graded on tool choice and arguments, and on
//                an honest "not signed in" answer rather than invented data. A case that reads nothing needs no target and no canary, is not
//                deferred for lack of a credential, and is not held by the data sign-off (no third party's words reach any model).
// The setting is in the plugin's pack (`accounts` in packs/<id>/pack.json, committed) and the owner's `$EVALS_STORE/round.json` overrides it
// (`{ "accounts": { "github": "none", "slack": "signed-in" } }`), so the round's config can change without a commit.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { seedPlugins } from "../case/schema.mjs"

export const ACCOUNTS = ["signed-in", "none"]

function roundConfig(store) {
  try {
    const file = join(store, "round.json")
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
  } catch {
    // An unreadable round config changes nothing: every plugin keeps what its pack says.
    return {}
  }
}

/** The plugins that run with no account: the packs' `accounts: "none"`, as the store's round.json overrides them. */
export function noAccountPlugins({ packs = [], store = null } = {}) {
  const out = new Set(packs.filter((pack) => pack.accounts === "none").map((pack) => pack.id))
  const overrides = store ? roundConfig(store).accounts ?? {} : {}
  for (const [id, value] of Object.entries(overrides)) {
    if (value === "none") out.add(id)
    else if (value === "signed-in") out.delete(id)
  }
  return out
}

/** The plugins a case uses: its own and every one its `Seed: plugins=` names. */
export const pluginsOf = (caseObject) => [...new Set([caseObject.plugin, ...seedPlugins(caseObject.seed)])]

/** Does every plugin the case uses run with no account? Such a case reads no data and needs no credential, target or canary. */
export const usesOnlyNoAccount = (caseObject, noAccount) => Boolean(noAccount?.size) && pluginsOf(caseObject).every((id) => noAccount.has(id))

/** `github.get_pull_request`, `github_get_pull_request` and `jira_getJiraIssue` name their plugin first. */
export const pluginOfTool = (tool) => String(tool ?? "").split(/[._]/)[0]
