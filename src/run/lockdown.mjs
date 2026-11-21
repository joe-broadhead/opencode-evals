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
export const LOCKED_TOOLS = Object.freeze(["shell", "read", "grep", "glob", "write", "edit", "patch", "webfetch", "websearch", "subagent", "experimental_image_generate", "experimental_video_generate"])

/**
 * Host tools the plan did not name that can still reach beyond the plugin under test: a schedule runs a prompt or a
 * script later, a worktree and a session move change where a run works, an MCP resource read reaches a connected
 * server. None of them is a vendor tool, so none is measured; all are removed from a credentialed trial.
 */
export const EXTRA_LOCKED_TOOLS = Object.freeze([
  // 2.3.x's automations (they replace the schedule tools, which 2.2.x still has) and its MCP event watch.
  "automation_create", "automation_delete", "automation_list", "automation_pause", "automation_resume", "watch_mcp_event",
  "schedule_create", "schedule_delete", "schedule_list", "schedule_pause", "schedule_resume",
  "worktree_create", "worktree_list", "worktree_remove", "session_move", "session_rename",
  "list_mcp_resources", "read_mcp_resource",
])

/** Spending "reads" that are confirm-only: the plugin allows them at every access, so a config ask rule makes them asks. */
export const CONFIRM_ONLY_READS = Object.freeze(["tavily_tavily_research", "tavily_tavily_crawl"])

/**
 * Spending tools a trial lets through with no ask, because the round meters them: they run inside the vendor's credit cap (caps.json `vendors`, the batch's balance check and the
 * per-run vendor use of R14), so a case about them stays measurable. They stay allowed whatever class the pack gives them: when Tavily's next release marks all five tools as spend-class
 * (they cost credits), the plugin asks for each at `ask-changes`, but the harness's rules come after the plugin's own block (the host lets the last matching rule win), so these three are
 * `allow` here and `tavily_tavily_research` and `tavily_tavily_crawl` (the unbounded ones) stay confirm-only: asked, and declined in a trial.
 */
export const CAPPED_SPEND_READS = Object.freeze(["tavily_tavily_search", "tavily_tavily_extract", "tavily_tavily_map"])

/** The one deliberate exception to "the harness is never more permissive than the plugin", and why. Listed so that a test and a probe can say it is the only one. */
export const PERMISSIVE_EXCEPTIONS = Object.freeze(CAPPED_SPEND_READS.map((action) => ({ action, why: "a spending read the round meters: it runs inside the vendor's credit cap (caps.json `vendors`, the batch's balance check, R14's per-run use), so a case about it stays measurable although its plugin asks for it at ask-changes once Tavily marks all five tools spend-class" })))

/** Options every companion gets besides `access`, so a stray call cannot spend (plan §1.3). */
export const COMPANION_CAPS = Object.freeze({
  // The plugin refuses 0 ("a whole number of credits, or null for no cap", found 0: probe P0-A2): 1 is the lowest cap it takes.
  // Every ElevenLabs write is asked and declined in this round besides, so the cap is a second lock, not the first.
  elevenlabs: { sessionCreditCap: 1, dailyCreditCap: 1 },
  x: { scriptBudgetUsd: 0.25, scriptDailyBudgetUsd: 5 },
})

export const ACCESS = "ask-changes"

/** The options a plugin always runs with in this round: ask-changes, and its caps when it has any. The caps are the
 * sealed rules: an arm file's or companions map's extra options add to them, but cannot raise or remove them. */
export function companionOptions(id, extra = {}) {
  return { ...extra, ...(COMPANION_CAPS[id] ?? {}), access: ACCESS }
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
    for (const tool of pack.tools ?? []) if (tool.class === "write" && tool.permission && !CAPPED_SPEND_READS.includes(tool.permission)) out.add(tool.permission)
    for (const action of pack.spend?.confirm ?? []) out.add(action)
  }
  for (const action of CONFIRM_ONLY_READS) out.add(action)
  return [...out].sort()
}

/**
 * What each plugin's OWN rules do at the trial's access (`packs/<id>/plugin-rules.json`, `scripts/plugin-rules.mjs`): the plugin loaded in the host with none of the harness's rules, and the host asked about
 * every action of its pack. Map plugin id -> { allowed: Set, asked: Set, denied: Set }. A plugin asks for some reads on purpose (Slack's private search and file read, X's direct-message reads): consent for
 * private content is the plugin's, and the harness may not turn it into an allow.
 */
export function loadPluginRules(dir = PACKS_DIR) {
  const out = new Map()
  if (!existsSync(dir)) return out
  for (const id of readdirSync(dir)) {
    const file = join(dir, id, "plugin-rules.json")
    if (!existsSync(file)) continue
    const data = JSON.parse(readFileSync(file, "utf8"))
    out.set(id, { access: data.access, allowed: new Set(data.allowed ?? []), asked: new Set(data.asked ?? []), denied: new Set(data.denied ?? []) })
  }
  return out
}
let cachedPluginRules = null
const defaultPluginRules = () => (cachedPluginRules ??= loadPluginRules())

/**
 * The permission action of every read tool the harness lets through with no ask: the harness is never more permissive than the plugin, so only an action the plugin's own rules allow at the trial's
 * access (a pack with no `plugin-rules.json` allows none), and the metered spending reads (PERMISSIVE_EXCEPTIONS). A confirm-only read is not here: it is in `writeActions`.
 */
export function readActions(packs = loadPacks(), pluginRules = defaultPluginRules()) {
  const confirm = new Set(writeActions(packs))
  const out = new Set()
  for (const pack of packs) {
    const own = pluginRules.get(pack.id)
    for (const tool of pack.tools ?? []) {
      if (!tool.permission || tool.effect === "deny" || confirm.has(tool.permission)) continue
      if (CAPPED_SPEND_READS.includes(tool.permission) || (tool.class === "read" && own?.allowed.has(tool.permission))) out.add(tool.permission)
    }
  }
  return [...out].sort()
}

/** The reads of the packs that the harness leaves as asks because their plugin asks for them (or denies them, or has no recorded rules), by plugin. */
export function keptAsks(packs = loadPacks(), pluginRules = defaultPluginRules()) {
  const allowed = new Set(readActions(packs, pluginRules))
  const confirm = new Set(writeActions(packs))
  const out = {}
  for (const pack of packs) for (const tool of pack.tools ?? []) if (tool.class === "read" && tool.permission && !allowed.has(tool.permission) && !confirm.has(tool.permission)) (out[pack.id] ??= []).push(tool.permission)
  return out
}

/**
 * The action patterns that cover every tool of a plugin: `<prefix>*` for the prefix its tools' permission actions share (`slack_`, `gws.`), and the underscore spelling of a dotted one. A rule
 * on them, written BEFORE the specific ones, makes a tool the pack does not list an ask (the last matching rule wins, and an unmatched action is an ask only by the host's own default,
 * which a plugin's `access: all` does not change: the rule is the harness's own).
 */
export function namespacePatterns(packs = loadPacks()) {
  const out = new Set()
  for (const pack of packs) {
    const prefixes = new Set([`${pack.id}_`])
    for (const tool of pack.tools ?? []) if (tool.permission && tool.permission.endsWith(tool.name) && tool.permission.length > tool.name.length) prefixes.add(tool.permission.slice(0, tool.permission.length - tool.name.length))
    for (const prefix of [...prefixes]) {
      out.add(`${prefix}*`)
      if (prefix.endsWith(".")) out.add(`${prefix.slice(0, -1)}_*`)
    }
  }
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
export function lockdownPermissions({ packs = loadPacks(), commit = [], extra = true, pluginRules = defaultPluginRules(), bare = false } = {}) {
  // `bare`: no rule at all (the plugin-rules builder asks what each plugin's own rules do, with none of the harness's)
  if (bare) return []
  const allowed = new Set(commit)
  const tools = [...LOCKED_TOOLS, ...(extra ? EXTRA_LOCKED_TOOLS : [])]
  const rules = [...tools.map((tool) => ({ action: tool, resource: "*", effect: "deny" })), { action: "external_directory", resource: "*", effect: "deny" }]
  // Fail closed for a tool no pack lists (review of #14, round 3): every plugin's whole namespace is an ask first; then the pack's reads are allowed; then every write is an ask (or an allow, for the
  // commit set's own named actions). A tool a plugin registers that its pack does not know matches only the first, so it asks, and `opencode run` declines it, at any `access` of the plugin.
  for (const action of namespacePatterns(packs)) rules.push({ action, resource: "*", effect: "ask" })
  for (const action of readActions(packs, pluginRules)) rules.push({ action, resource: "*", effect: "allow" })
  for (const action of writeActions(packs)) rules.push({ action, resource: "*", effect: allowed.has(action) ? "allow" : "ask" })
  // A commit set may name an action no pack lists: the plan declares it, so it is allowed like the others (the guard still refuses it unless its target is in scope).
  const listed = new Set(writeActions(packs))
  for (const action of allowed) if (!listed.has(action)) rules.push({ action, resource: "*", effect: "allow" })
  return rules
}

/** The host's own rule evaluation (@opencode/core, permission.js `evaluate`): the LAST rule whose action matches wins (`*` is a wildcard), and an action no rule names is an ask. */
export function effectiveEffect(permissions, action) {
  const matches = (input, pattern) => new RegExp(`^${String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "s").test(input)
  return [...permissions].reverse().find((rule) => matches(action, rule.action) && matches("*", rule.resource ?? "*"))?.effect ?? "ask"
}

/** What a trial's config lacks, as a checkable list: every locked tool denied as a permission and a policy, every write asked. */
export function lockdownProblems(config, { packs = loadPacks(), commit = [], pluginRules = defaultPluginRules() } = {}) {
  const problems = []
  const policies = config?.policies ?? []
  const permissions = config?.permissions ?? []
  for (const tool of LOCKED_TOOLS) {
    if (!permissions.some((p) => p.action === tool && p.resource === "*" && p.effect === "deny")) problems.push(`tool ${tool} is not denied as a permission (so the model is still offered it)`)
    if (!policies.some((p) => p.action === "tool.use" && p.resource === `${tool}:*` && p.effect === "deny")) problems.push(`tool.use ${tool}:* is not denied`)
  }
  if (!permissions.some((p) => p.action === "external_directory" && p.effect === "deny")) problems.push("permission external_directory is not denied")
  const allowed = new Set(commit)
  // the namespace asks come first and the reads' allows after them, so that only an unlisted tool is left to the ask
  const index = (action, effect) => permissions.findIndex((p) => p.action === action && p.resource === "*" && p.effect === effect)
  const firstSpecific = Math.min(...[...readActions(packs, pluginRules), ...writeActions(packs)].map((action) => permissions.findIndex((p) => p.action === action)).filter((i) => i >= 0), permissions.length)
  for (const pattern of namespacePatterns(packs)) {
    const at = index(pattern, "ask")
    if (at < 0) problems.push(`the namespace ${pattern} is not an ask (a tool no pack lists would not be asked)`)
    else if (at > firstSpecific) problems.push(`the namespace ${pattern} is asked after a specific rule (it would override it)`)
  }
  for (const action of readActions(packs, pluginRules)) {
    const effect = effectiveEffect(permissions, action)
    if (effect !== "allow") problems.push(`read action ${action} is ${effect}, not allow (a known read would ask)`)
  }
  // never more permissive than the plugin: an action the plugin asks for or denies resolves to an allow only through the listed exception
  const exceptions = new Set(PERMISSIVE_EXCEPTIONS.map((e) => e.action))
  for (const pack of packs) {
    const own = pluginRules.get(pack.id)
    for (const tool of pack.tools ?? []) {
      if (!tool.permission || exceptions.has(tool.permission) || allowed.has(tool.permission)) continue
      if (effectiveEffect(permissions, tool.permission) === "allow" && !own?.allowed.has(tool.permission)) problems.push(`${tool.permission} resolves to allow but ${pack.id}'s own rules ${own ? "ask for it" : "are not recorded"}: the harness may not be more permissive than the plugin`)
    }
  }
  for (const action of writeActions(packs)) {
    const effect = effectiveEffect(permissions, action)
    const want = allowed.has(action) ? "allow" : "ask"
    if (effect !== want) problems.push(`write action ${action} is ${effect}, not ${want}`)
  }
  return problems
}
