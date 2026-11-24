// The harness is fail-closed for a tool no pack lists (review of #14, round 3): the sealed config asks for the whole namespace of every plugin and allows only the pack's reads, the guard
// treats a plugin's tool outside the packs as a write, and what a pack must list is checked against what its release registers and what a signed-in host lists.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { lockdownPermissions, lockdownProblems, lockdownPolicies, namespacePatterns, readActions, writeActions, loadPacks } from "../src/run/lockdown.mjs"
import { buildPolicy } from "../src/run/guard/policy.mjs"
import { decideBefore, isUnknownTool } from "../src/run/guard/logic.mjs"
import { listingProblems, inPack, nameOfPath, readSidecar, readExtras } from "../src/pack/listing.mjs"
import { undeclaredTools } from "../src/pack/from-plugin.mjs"
import { releaseInfo } from "../src/pack/release.mjs"

const ROOT = join(import.meta.dirname, "..")
const packs = loadPacks()

/** The host's own rule evaluation (@opencode/core permission.js): the LAST rule whose action and resource match wins; nothing matching is an ask. `*` matches anything. */
const matches = (input, pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "s").test(input)
const effectOf = (rules, action) => rules.findLast((rule) => matches(action, rule.action) && matches("*", rule.resource))?.effect ?? "ask"

test("the sealed config asks for a plugin's whole namespace, then allows the pack's reads, then asks every write: a tool no pack lists is an ask, at any access of the plugin", () => {
  const rules = lockdownPermissions({ packs })
  // every known read is allowed, every write asks; the confirm-only reads (tavily research, crawl) ask
  for (const action of readActions(packs)) assert.equal(effectOf(rules, action), "allow", action)
  for (const action of writeActions(packs)) assert.equal(effectOf(rules, action), "ask", action)
  assert.equal(effectOf(rules, "tavily_tavily_research"), "ask")
  assert.equal(effectOf(rules, "tavily_tavily_search"), "allow")
  // the eight ElevenLabs tools its live server lists and v0.0.9's pack lacks, one of which places phone calls
  for (const name of ["agents_brand_new_dial", "agents_brand_new_rules", "agents_brand_new_read", "agents_brand_new_update", "creative_brand_new_guide"]) assert.equal(effectOf(rules, `elevenlabs_${name}`), "ask", name)
  // another plugin's, with a dotted prefix (gws), and an underscore spelling of it
  assert.equal(effectOf(rules, "gws.brand_new_tool"), "ask")
  assert.equal(effectOf(rules, "gws_brand_new_tool"), "ask")
  assert.equal(effectOf(rules, "slack_slack_brand_new"), "ask")
  assert.equal(effectOf(rules, "gws.read"), "allow", "a pack's own read")
  // the locked core tools stay denied, and a tool that is not a plugin's is not made an ask by the namespace rules
  for (const tool of ["shell", "read", "write", "webfetch"]) assert.equal(effectOf(rules, tool), "deny", tool)
  assert.equal(effectOf(rules, "execute"), "ask", "no rule names it: the host's own default (it is not a plugin's tool and has none of the namespaces)")
  assert.deepEqual(lockdownProblems({ policies: lockdownPolicies(), permissions: rules }, { packs }), [])
  // every plugin has a namespace pattern
  const patterns = namespacePatterns(packs)
  for (const pack of packs) assert.ok(patterns.some((p) => p.startsWith(`${pack.id}_`) || p.startsWith(`${pack.id}.`)), pack.id)
})

test("the order matters: a namespace ask after a known read would ask it, and lockdownProblems says so; a missing namespace ask, a read that asks and a write that does not are named", () => {
  const rules = lockdownPermissions({ packs })
  const without = rules.filter((r) => !(r.effect === "ask" && r.action === "elevenlabs_*"))
  assert.match(lockdownProblems({ policies: lockdownPolicies(), permissions: without }, { packs }).join("\n"), /the namespace elevenlabs_\* is not an ask/)
  const last = [...rules.filter((r) => r.action !== "elevenlabs_*"), { action: "elevenlabs_*", resource: "*", effect: "ask" }]
  const problems = lockdownProblems({ policies: lockdownPolicies(), permissions: last }, { packs }).join("\n")
  assert.match(problems, /the namespace elevenlabs_\* is asked after a specific rule/)
  assert.match(problems, /read action elevenlabs_agents_get_conversation is ask, not allow/)
  // with no packs (noWriteAsks) there are no namespace or read rules: the locks, and the two confirm-only reads' asks
  const bare = lockdownPermissions({ packs: [] })
  assert.ok(bare.every((r) => r.effect === "deny" || r.action.startsWith("tavily_tavily_")))
  assert.ok(!bare.some((r) => r.action.endsWith("*") && r.effect === "ask"))
})

test("a commit set may name an action no pack lists: it becomes an allow after the namespace ask, and the guard treats it as the plan's declared write", () => {
  const rules = lockdownPermissions({ packs, commit: ["elevenlabs_agents_brand_new_dial"] })
  assert.equal(effectOf(rules, "elevenlabs_agents_brand_new_dial"), "allow")
  assert.equal(effectOf(rules, "elevenlabs_agents_brand_new_read"), "ask", "another unlisted tool still asks")
  const policy = buildPolicy({ mode: "commit", packs, locked: true, commit: { elevenlabs_agents_brand_new_dial: { extract: "args.agent_id", allow: ["agent_sandbox"] } } })
  assert.equal(decideBefore(policy, "elevenlabs_agents_brand_new_dial", { agent_id: "agent_sandbox" }).pass, true, "named, in scope")
  assert.equal(decideBefore(policy, "elevenlabs_agents_brand_new_dial", { agent_id: "agent_real" }).pass, false, "named, out of scope")
  assert.equal(decideBefore(policy, "elevenlabs_agents_brand_new_dial", { agent_id: "agent_real" }).why, "a target outside the sandbox")
  assert.equal(decideBefore(policy, "elevenlabs_agents_brand_new_read", {}).pass, false, "another unlisted tool: refused")
})

test("the guard blocks unlisted tools in every mode, locked or unlocked", () => {
  const unlocked = buildPolicy({ mode: "refuse", packs })
  const locked = (mode, commit = {}) => buildPolicy({ mode, packs, locked: true, commit })
  const outbound = "elevenlabs_agents_brand_new_dial"
  assert.equal(isUnknownTool(unlocked, outbound), true)
  for (const mode of ["refuse", "log"]) {
    const decision = decideBefore(locked(mode), outbound, {})
    assert.equal(decision.pass, false, `${mode}: blocked before the tool body`)
    assert.deepEqual(decision.write, { unknown: true })
  }
  const refused = decideBefore(locked("commit", { jobs_delete: { extract: "args.id", allow: ["x"] } }), outbound, {})
  assert.equal(refused.pass, false)
  assert.equal(refused.tool, true, "the guard's `tool` marker: EVALS-ASSERT tool: <name> refused (...)")
  assert.match(refused.why, /a tool no pack lists, and the commit set does not name it/)
  // spellings: dotted, mcp-prefixed
  for (const name of ["elevenlabs.agents_brand_new_dial", "mcp_elevenlabs_agents_brand_new_dial", "gws.brand_new", "slack_slack_brand_new", "x_brand_new_tool"]) assert.equal(isUnknownTool(locked("refuse"), name), true, name)
  // not it: every tool of every pack, the allow-list's own tools, the probe's tools, core tools (refused elsewhere), and other prefixes
  const policy = locked("refuse")
  for (const pack of packs) for (const tool of pack.tools) assert.equal(isUnknownTool(policy, tool.permission), false, `${pack.id}.${tool.name}`)
  for (const name of ["execute", "skill", "question", "todowrite", "evalsprobe_assert_all"]) assert.equal(isUnknownTool(policy, name), false, name)
  for (const name of ["bash", "write", "xylophone_play", "history"]) assert.equal(isUnknownTool(policy, name), true, name)
  assert.equal(decideBefore(policy, "bash", {}).pass, false, "a core tool is still refused by the allow-list")
  assert.equal(decideBefore(policy, "slack_slack_read_channel", {}).why, "not a write", "a known read")
})

test("a probe pack with a tool taken out makes exactly that tool unknown (the unknown-tool probe's shape)", () => {
  const trimmed = packs.map((pack) => (pack.id === "jobs" ? { ...pack, tools: pack.tools.filter((tool) => tool.name !== "create") } : pack))
  const policy = buildPolicy({ mode: "refuse", packs: trimmed, locked: true })
  assert.equal(isUnknownTool(policy, "jobs_create"), true)
  assert.equal(isUnknownTool(policy, "jobs_delete"), false)
  assert.equal(effectOf(lockdownPermissions({ packs: trimmed }), "jobs_create"), "ask")
  assert.equal(effectOf(lockdownPermissions({ packs }), "jobs_create"), "ask", "and with it in the pack it is its write: also an ask")
})

// ---------------------------------------------------------------------------------------------- what a pack is checked against

test("listing: a name is in the pack under its own name, its permission, or prefixed by the plugin id; a listing path's last name is the tool's", () => {
  const pack = { id: "affinity", tools: [{ name: "affinity_data_migration", permission: "affinity_affinity_data_migration" }, { name: "get_company", permission: "affinity_get_company" }] }
  assert.equal(inPack(pack, "get_company"), true)
  assert.equal(inPack(pack, "data_migration"), true, "a host that strips the plugin's prefix")
  assert.equal(inPack(pack, "affinity_get_company"), true, "the permission action")
  assert.equal(inPack(pack, "get_calls"), false)
  assert.equal(nameOfPath('tools.notion["notion-search"]'), "notion-search")
  assert.equal(nameOfPath("tools.jira.getJiraIssue"), "getJiraIssue")
})

test("listing problems: a tool the release registers that the pack lacks fails; a tool a host lists fails unless a reason explains it; a reason for a tool that is no longer unexplained is stale", () => {
  const pack = { id: "elevenlabs", tools: [{ name: "agents_list", permission: "elevenlabs_agents_list" }] }
  const registered = { names: ["agents_list", "events_list"] }
  const live = { names: ["agents_list", "agents_brand_new_dial"] }
  const none = listingProblems(pack, { registered, live, extras: {} })
  assert.deepEqual(none.registered, ["events_list"])
  assert.deepEqual(none.live, ["agents_brand_new_dial"])
  const excused = listingProblems(pack, { registered: { names: ["agents_list"] }, live, extras: { elevenlabs: { agents_brand_new_dial: "places a phone call" } } })
  assert.deepEqual([excused.registered, excused.live, excused.stale], [[], [], []])
  // an explanation for a tool the pack now lists, or the host no longer lists
  assert.deepEqual(listingProblems(pack, { live: { names: ["agents_list"] }, extras: { elevenlabs: { agents_brand_new_dial: "x" } } }).stale, ["agents_brand_new_dial"])
  assert.deepEqual(listingProblems({ ...pack, tools: [...pack.tools, { name: "agents_brand_new_dial", permission: "elevenlabs_agents_brand_new_dial" }] }, { live, extras: { elevenlabs: { agents_brand_new_dial: "x" } } }).stale, ["agents_brand_new_dial"])
  assert.deepEqual(listingProblems(pack, {}), { registered: [], live: [], stale: [] }, "no sidecars: nothing to compare (evals pack says so)")
})

test("every committed pack agrees with its registered.json, its live.json and the curated reasons; each curated reason is for an unlisted tool", () => {
  const extras = readExtras(ROOT)
  let reasons = 0
  for (const pack of packs) {
    const registered = readSidecar(ROOT, pack.id, "registered.json")
    assert.ok(registered, `${pack.id} has a registered.json`)
    assert.deepEqual(listingProblems(pack, { registered, live: readSidecar(ROOT, pack.id, "live.json"), extras }), { registered: [], live: [], stale: [] }, pack.id)
    reasons += Object.keys(extras[pack.id] ?? {}).length
    assert.ok(pack.release?.tag === `v${pack.version}` && /^[0-9a-f]{40}$/.test(pack.release.commit), `${pack.id} records its release`)
  }
  // what the host lists beyond the pinned packs carries a reason; a reason for a tool the pack lists is stale (listingProblems above). ElevenLabs' eight, Granola's two and Affinity's 21 were classified
  // by v0.0.10, v0.0.7 and v0.0.7: their reasons are gone, and the tools are in their packs.
  for (const id of Object.keys(extras)) for (const [name, why] of Object.entries(extras[id])) assert.ok(typeof why === "string" && why.length > 20, `${id}.${name} has a reason`)
  for (const id of ["elevenlabs", "granola", "affinity"]) assert.equal(extras[id], undefined, `${id}: classified by its release`)
  for (const name of ["agents_outbound_call", "agents_get_draft", "agents_update_draft", "creative_get_guide", "agents_create_pronunciation_dictionary"]) assert.equal(inPack(packs.find((p) => p.id === "elevenlabs"), name), true, `${name} is in the v0.0.10 pack`)
  for (const name of ["update_meeting_title", "update_summary"]) assert.equal(inPack(packs.find((p) => p.id === "granola"), name), true, name)
  for (const name of ["delete_field", "get_calls", "update_field"]) assert.equal(inPack(packs.find((p) => p.id === "affinity"), name), true, name)
})

test("`evals pack` fails a pack that differs from what its release registers or a host lists, and one with no release recorded: mutations on a copy of the sidecars", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-pack-mut-"))
  try {
    assert.equal(spawnSync(process.execPath, [join(ROOT, "bin", "evals"), "pack"], { encoding: "utf8" }).status, 0, "the committed packs pass")
    cpSync(join(ROOT, "packs"), join(dir, "packs"), { recursive: true })
    const eleven = packs.find((p) => p.id === "elevenlabs")
    const live = readSidecar(dir, "elevenlabs", "live.json")
    writeFileSync(join(dir, "packs", "elevenlabs", "live.json"), JSON.stringify({ ...live, names: [...live.names, "agents_brand_new_dial"] }))
    const problems = listingProblems(eleven, { registered: readSidecar(dir, "elevenlabs", "registered.json"), live: readSidecar(dir, "elevenlabs", "live.json"), extras: readExtras(ROOT) })
    assert.deepEqual(problems.live, ["agents_brand_new_dial"], "a tool the host lists that neither the pack nor a reason has")
    const removed = packs.map((p) => (p.id === "slack" ? { ...p, tools: p.tools.filter((t) => t.name !== "mark_read") } : p)).find((p) => p.id === "slack")
    assert.deepEqual(listingProblems(removed, { registered: readSidecar(ROOT, "slack", "registered.json") }).registered, ["mark_read"], "a tool the release registers that the pack dropped")
    const extra = readExtras(ROOT)
    const withReason = { elevenlabs: { agents_brand_new_dial: "places a phone call" } }
    const names = { names: [...readSidecar(ROOT, "elevenlabs", "live.json").names, "agents_brand_new_dial"] }
    assert.deepEqual(listingProblems(eleven, { live: names, extras: withReason }).live, [], "with its reason")
    assert.deepEqual(listingProblems(eleven, { live: names, extras: {} }).live, ["agents_brand_new_dial"], "a tool the host lists, with no reason")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a tool a release registers that its declaration does not name is added to the pack as an unclassified WRITE on a sync; none leaves the derived tools alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-undeclared-"))
  try {
    mkdirSync(join(dir, "packs", "demo"), { recursive: true })
    writeFileSync(join(dir, "packs", "demo", "registered.json"), JSON.stringify({ names: ["list", "events_list", "demo_probe"] }))
    const derived = [{ name: "list", permission: "demo_list", effect: "allow", readOnly: true, class: "read" }]
    const { tools } = undeclaredTools("demo", dir, derived)
    assert.deepEqual(tools.map((t) => t.name), ["list", "events_list", "demo_probe"])
    assert.deepEqual(tools[1], { name: "events_list", permission: "demo_events_list", effect: "allow", readOnly: false, class: "write", undeclared: true })
    assert.equal(tools[2].class, "write", "classed a write, never a read")
    assert.deepEqual(undeclaredTools("demo", dir, tools), {}, "nothing left to add")
    assert.deepEqual(undeclaredTools("none", dir, derived), {}, "no registered.json")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("releaseInfo: the tag and the commit it points at in a checkout, null when the tag is not there", () => {
  const info = releaseInfo({ repo: join(ROOT), version: "9.9.9" })
  assert.deepEqual(info, { version: "9.9.9", tag: "v9.9.9", commit: null })
})

test("Tavily lockdown exceptions do not override a pack's write classification in the guard", () => {
  const spend = packs.map((pack) => (pack.id === "tavily" ? { ...pack, tools: pack.tools.map((tool) => ({ ...tool, class: "write", readOnly: false, effect: "ask" })) } : pack))
  for (const [list, label] of [[packs, "released"], [spend, "spend-class"]]) {
    const rules = lockdownPermissions({ packs: list })
    for (const name of ["search", "extract", "map"]) assert.equal(effectOf(rules, `tavily_tavily_${name}`), "allow", `${label} ${name}`)
    for (const name of ["research", "crawl", "added_later"]) assert.equal(effectOf(rules, `tavily_tavily_${name}`), "ask", `${label} ${name}`)
    assert.deepEqual(lockdownProblems({ policies: lockdownPolicies(), permissions: rules }, { packs: list }), [], label)
    const policy = buildPolicy({ mode: "refuse", packs: list, locked: true })
    for (const name of ["search", "extract", "map"]) {
      const classifiedWrite = list.find((p) => p.id === "tavily").tools.find((t) => t.permission === `tavily_tavily_${name}`).class === "write"
      assert.equal(policy.actions.includes(`tavily_tavily_${name}`), classifiedWrite, `${label}: ${name}`)
      assert.equal(decideBefore(policy, `tavily_tavily_${name}`, {}).pass, !classifiedWrite)
    }
    assert.equal(isUnknownTool(policy, "tavily_tavily_search"), false, "known")
    assert.equal(isUnknownTool(policy, "tavily_tavily_added_later"), true)
  }
})

// ---------------------------------------------------------------------------------------------- the harness is never more permissive than the plugin

import { loadPluginRules, keptAsks, PERMISSIVE_EXCEPTIONS, CAPPED_SPEND_READS, effectiveEffect } from "../src/run/lockdown.mjs"
import { ruleProblems } from "../src/pack/listing.mjs"

test("the harness allows only the reads the plugin's own rules allow: the eight private-content reads stay asked, and the metered Tavily reads are the one listed exception", () => {
  const own = loadPluginRules()
  const rules = lockdownPermissions({ packs })
  // the eight named in the review: Slack's private search and file read, X's six direct-message reads
  for (const action of ["slack_slack_search_public_and_private", "slack_slack_read_file", "x_get_chat_conversation", "x_get_chat_conversation_events", "x_get_chat_conversations", "x_get_chat_message_requests", "x_get_users_public_key", "x_get_users_public_keys"]) {
    assert.equal(effectOf(rules, action), "ask", action)
    assert.equal(own.get(action.startsWith("x_") ? "x" : "slack").asked.has(action), true, `${action}: the plugin's own rules ask`)
  }
  // for every action of every pack: an allow in the sealed config is an allow of the plugin's own, bar the exception
  const exceptions = new Set(PERMISSIVE_EXCEPTIONS.map((e) => e.action))
  assert.deepEqual([...exceptions].sort(), ["tavily_tavily_extract", "tavily_tavily_map", "tavily_tavily_search"])
  assert.deepEqual([...exceptions].sort(), [...CAPPED_SPEND_READS].sort())
  for (const e of PERMISSIVE_EXCEPTIONS) assert.match(e.why, /metered|credit cap/)
  let allowed = 0
  for (const pack of packs) for (const tool of pack.tools) {
    if (effectOf(rules, tool.permission) !== "allow") continue
    allowed++
    assert.ok(exceptions.has(tool.permission) || own.get(pack.id).allowed.has(tool.permission), `${tool.permission} is allowed by the harness but not by ${pack.id}'s own rules`)
  }
  assert.ok(allowed > 500, `${allowed} reads allowed`)
  assert.equal(Object.values(keptAsks(packs)).flat().length, 8, "exactly the eight reads the plugins ask consent for")
  assert.deepEqual(lockdownProblems({ policies: lockdownPolicies(), permissions: rules }, { packs }), [])
})

test("lockdownProblems names an allow the plugin does not make; a pack with no recorded rules gets no read allowed (fail closed)", () => {
  const rules = [...lockdownPermissions({ packs }), { action: "slack_slack_read_file", resource: "*", effect: "allow" }]
  assert.match(lockdownProblems({ policies: lockdownPolicies(), permissions: rules }, { packs }).join("\n"), /slack_slack_read_file resolves to allow but slack's own rules ask for it: the harness may not be more permissive than the plugin/)
  const none = lockdownPermissions({ packs, pluginRules: new Map() })
  for (const pack of packs) for (const tool of pack.tools) if (!CAPPED_SPEND_READS.includes(tool.permission)) assert.notEqual(effectOf(none, tool.permission), "allow", tool.permission)
  const spend = packs.map((pack) => (pack.id === "tavily" ? { ...pack, tools: pack.tools.map((t) => ({ ...t, class: "write" })) } : pack))
  assert.equal(effectOf(lockdownPermissions({ packs: spend, pluginRules: new Map() }), "tavily_tavily_search"), "allow", "the exception needs no recording")
})

/** A pack version as a literal in a RegExp (the committed packs move with each release sync; the messages name them). */
const esc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

test("every committed plugin-rules.json decides every action of its pack and names its release; ruleProblems says what is wrong", () => {
  const own = loadPluginRules()
  for (const pack of packs) assert.deepEqual(ruleProblems(pack, readSidecar(ROOT, pack.id, "plugin-rules.json")), [], pack.id)
  assert.equal(own.get("slack").access, "ask-changes")
  assert.match(ruleProblems(packs[0], null)[0], /has no plugin-rules\.json/)
  const slack = packs.find((p) => p.id === "slack")
  const rules = readSidecar(ROOT, "slack", "plugin-rules.json")
  assert.match(ruleProblems(slack, { ...rules, allowed: rules.allowed.slice(1) }).join(), /does not decide slack_/)
  assert.match(ruleProblems(slack, { ...rules, release: { version: "0.0.1" } }).join(), new RegExp(`is of v0\\.0\\.1, the pack is v${esc(slack.version)}`))
})

test("a sidecar must come from the release the pack records, under the same version too: another commit, no commit, a decided action the pack dropped (the metaview case) all fail `evals pack`'s check", async () => {
  const { releaseProblems } = await import("../src/pack/listing.mjs")
  const slack = packs.find((p) => p.id === "slack")
  const rules = readSidecar(ROOT, "slack", "plugin-rules.json")
  const registered = readSidecar(ROOT, "slack", "registered.json")
  assert.deepEqual(ruleProblems(slack, rules), [])
  assert.deepEqual(releaseProblems(slack, registered, "registered.json"), [])
  // the same version, another commit
  const other = { ...rules, release: { ...rules.release, commit: "0".repeat(40) } }
  assert.match(ruleProblems(slack, other).join(), new RegExp(`plugin-rules\\.json was recorded from 0000000, the pack's release v${esc(slack.version)} is [0-9a-f]{7}: another build of the same version`))
  assert.match(releaseProblems(slack, { ...registered, release: { version: slack.version } }, "registered.json").join(), /records no release commit/)
  assert.match(releaseProblems(slack, { ...registered, release: { ...registered.release, commit: "1".repeat(40) } }, "registered.json").join(), /another build of the same version/)
  assert.match(releaseProblems(slack, { release: { version: "0.0.5" } }, "registered.json").join(), new RegExp(`registered\\.json is of v0\\.0\\.5, the pack is v${esc(slack.version)}`))
  // a pack that dropped a tool its rules still decide (metaview's events_list, under the same version)
  const dropped = { ...slack, tools: slack.tools.filter((t) => t.name !== "slack_search_users") }
  assert.match(ruleProblems(dropped, rules).join(), /plugin-rules\.json decides slack_slack_search_users, which the pack does not list: it was recorded from another build/)
  // every committed sidecar agrees with its pack's release commit
  for (const pack of packs) {
    assert.deepEqual(releaseProblems(pack, readSidecar(ROOT, pack.id, "registered.json"), "registered.json"), [], pack.id)
    assert.deepEqual(ruleProblems(pack, readSidecar(ROOT, pack.id, "plugin-rules.json")), [], pack.id)
  }
})
