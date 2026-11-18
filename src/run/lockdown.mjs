// The sealed config's safety rules (EVALS-232, G1 to G4): what a credentialed trial may not do at all, and what it may
// only ask to do (and is always refused).
//
// A trial that holds a vendor credential keeps it in its own `auth.json` and environment. A model with a shell, a file
// read, a web fetch or a subagent could read it and call the vendor directly, past every plugin's `ask-changes` and past
// the guard. So the sealed config removes those tools (`policies: tool.use deny`) and denies them again as permissions,
// and every write action of every pack is an `ask`, which `opencode run` rejects. Only the commit set turns the `ask`
// rules of its own named actions into `allow`.
//
//   lockdownPolicies()                      config.policies: the tools the model never sees
//   lockdownPermissions({ packs, commit })  config.permissions: deny the unsafe, ask every write and spending action
//   writeActions(packs)                     every write permission action of the packs
//   companionOptions(id)                    the options each companion plugin always gets: ask-changes and its caps

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

export const PACKS_DIR = resolve(import.meta.dirname, "..", "..", "packs")

/** The shell, file, web and subagent tools (and the image tool, which calls a vendor): removed from every credentialed trial. */
export const LOCKED_TOOLS = Object.freeze(["shell", "read", "grep", "glob", "write", "edit", "patch", "webfetch", "websearch", "subagent", "experimental_image_generate"])

/**
 * Host tools the plan did not name that can still reach beyond the plugin under test: a schedule runs a prompt or a
 * script later, a worktree and a session move change where a run works, an MCP resource read reaches a connected
 * server. None of them is a vendor tool, so none is measured; all are removed from a credentialed trial.
 */
export const EXTRA_LOCKED_TOOLS = Object.freeze([
  "schedule_create", "schedule_delete", "schedule_list", "schedule_pause", "schedule_resume",
  "worktree_create", "worktree_list", "worktree_remove", "session_move", "session_rename",
  "list_mcp_resources", "read_mcp_resource",
])

/** Spending "reads" that are confirm-only: the plugin allows them at every access, so a config ask rule makes them asks. */
export const CONFIRM_ONLY_READS = Object.freeze(["tavily_tavily_research", "tavily_tavily_crawl"])

/** Options every companion gets besides `access`, so a stray call cannot spend (plan §1.3). */
export const COMPANION_CAPS = Object.freeze({
  // The plugin refuses 0 ("a whole number of credits, or null for no cap", found 0: probe P0-A2): 1 is the lowest cap it takes.
  // Every ElevenLabs write is asked and declined in this round besides, so the cap is a second lock, not the first.
  elevenlabs: { sessionCreditCap: 1, dailyCreditCap: 1 },
  x: { scriptBudgetUsd: 0.25, scriptDailyBudgetUsd: 5 },
})

export const ACCESS = "ask-changes"

/** The options a plugin always runs with in this round: ask-changes, and its caps when it has any. */
export function companionOptions(id, extra = {}) {
  return { ...(COMPANION_CAPS[id] ?? {}), ...extra, access: ACCESS }
}

/** Every pack under `dir`, as parsed JSON, sorted by id. */
export function loadPacks(dir = PACKS_DIR) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, "pack.json")))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name, "pack.json"), "utf8")))
}

/** The permission action of every write tool in the packs (a pack's `spend.confirm` actions included). */
export function writeActions(packs = loadPacks()) {
  const out = new Set()
  for (const pack of packs) {
    for (const tool of pack.tools ?? []) if (tool.class === "write" && tool.permission) out.add(tool.permission)
    for (const action of pack.spend?.confirm ?? []) out.add(action)
  }
  for (const action of CONFIRM_ONLY_READS) out.add(action)
  return [...out].sort()
}

/**
 * `config.policies`: what is denied when a call is evaluated. A policy's resource is `<tool>:<input>`, so `shell` alone
 * matches nothing: the pattern is `shell:*`. This is the second lock; the first is the blanket permission deny below,
 * which is what removes a tool from the list the model is offered (the host hides a tool whose own permission is denied
 * for resource `*`: `whollyDisabled` in @opencode/core's tool snapshot, found by probe P0-A1 on 2.3.2).
 */
export function lockdownPolicies({ extra = true } = {}) {
  const tools = [...LOCKED_TOOLS, ...(extra ? EXTRA_LOCKED_TOOLS : [])]
  return [
    ...tools.map((tool) => ({ action: "tool.use", resource: `${tool}:*`, effect: "deny" })),
    { action: "websearch.use", resource: "*", effect: "deny" },
  ]
}

/**
 * `config.permissions`: a blanket deny of every locked tool by its own name (the tool is then not offered at all), and
 * of the file and directory actions the other tools ask; then `ask` every write and spending action. In the commit set
 * `commit` names the write actions that become `allow` (its 25 cases' own); every other write stays an ask.
 */
export function lockdownPermissions({ packs = loadPacks(), commit = [], extra = true } = {}) {
  const allowed = new Set(commit)
  const tools = [...LOCKED_TOOLS, ...(extra ? EXTRA_LOCKED_TOOLS : [])]
  const rules = [...tools.map((tool) => ({ action: tool, resource: "*", effect: "deny" })), { action: "external_directory", resource: "*", effect: "deny" }]
  for (const action of writeActions(packs)) rules.push({ action, resource: "*", effect: allowed.has(action) ? "allow" : "ask" })
  return rules
}

/** What a trial's config lacks, as a checkable list: every locked tool denied as a permission and a policy, every write asked. */
export function lockdownProblems(config, { packs = loadPacks(), commit = [] } = {}) {
  const problems = []
  const policies = config?.policies ?? []
  const permissions = config?.permissions ?? []
  for (const tool of LOCKED_TOOLS) {
    if (!permissions.some((p) => p.action === tool && p.resource === "*" && p.effect === "deny")) problems.push(`tool ${tool} is not denied as a permission (so the model is still offered it)`)
    if (!policies.some((p) => p.action === "tool.use" && p.resource === `${tool}:*` && p.effect === "deny")) problems.push(`tool.use ${tool}:* is not denied`)
  }
  if (!permissions.some((p) => p.action === "external_directory" && p.effect === "deny")) problems.push("permission external_directory is not denied")
  const allowed = new Set(commit)
  for (const action of writeActions(packs)) {
    const rule = permissions.filter((p) => p.action === action).pop()
    const want = allowed.has(action) ? "allow" : "ask"
    if (rule?.effect !== want) problems.push(`write action ${action} is ${rule?.effect ?? "unruled"}, not ${want}`)
  }
  return problems
}
