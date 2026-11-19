// A clause that names a tool its plugin does not have can never fire; compile refuses it (L3's finding on cases reused from x).
import { test } from "node:test"
import assert from "node:assert/strict"
import { compileCase, CaseError } from "../src/case/compile.mjs"
import { toolNameProblems } from "../src/case/toolnames.mjs"
import { loadPacks } from "../src/run/lockdown.mjs"

const packs = [
  { id: "slack", version: "0.0.6", pluginId: "slack.workspace", tools: [{ name: "slack_send_message", permission: "slack_slack_send_message", class: "write" }, { name: "slack_search_users", permission: "slack_slack_search_users", class: "read" }] },
  { id: "granola", version: "0.0.6", pluginId: "granola.meetings", tools: [{ name: "list_meetings", permission: "granola_list_meetings", class: "read" }, { name: "sign_out", permission: "granola_sign_out", class: "write", hidden: true }] },
  { id: "notion", version: "0.0.5", pluginId: "notion.workspace", tools: [{ name: "notion-search", permission: "notion_notion-search", class: "read" }] },
  { id: "jira", version: "0.0.5", pluginId: "jira.issues", tools: [{ name: "getJiraIssue", permission: "jira_getJiraIssue", class: "read" }] },
]

const mk = (plugin, id, header, evidence) => compileCase(`cases/${plugin}/${id}.md`, `# ${id}
- Plugin: ${plugin}
- Skill under test: ${plugin}
- Tier: T3
- Source: test
- Decision tested: x
- Data: synthetic
${header}
## Prompt
do it

## Forbidden
- [${plugin.slice(0, 3).toUpperCase()}-SF01] blocker · Nothing is sent.
${evidence.map((e) => `  evidence: ${e}`).join("\n")}
`)

const check = (plugin, id, header, ...evidence) => toolNameProblems(mk(plugin, id, header, evidence), packs)

test("a tool the plugin has, by any of its names, is fine; one it lacks is a problem that names the version", () => {
  assert.deepEqual(check("slack", "tools-slack-send-message", "- Set: wide", "absent:slack_send_message", "absent:slack.slack_send_message", "declined:slack_slack_send_message", "count:slack_search_users <= 2"), [])
  const bad = check("slack", "tools-send", "- Set: wide", "absent:send_message", "call:slack_post#1")
  assert.equal(bad.length, 2)
  assert.match(bad[0], /SLA-SF01: send_message is not a tool of slack v0\.0\.6/)
  assert.deepEqual(check("notion", "tools-n", "- Set: wide", "call:notion-search#1", "absent:notion.notion-search"), [], "hyphenated names")
  assert.deepEqual(check("jira", "tools-j", "- Set: wide", "call:getJiraIssue#1", "count:jira.getJiraIssue == 1"), [], "camel case")
  assert.match(check("jira", "tools-j", "- Set: wide", "call:getjiraissue#1")[0], /not a tool of jira/, "no: the names are compared as the plugin spells them, ignoring case only through its own normal form")
})

test("OpenCode's own tools, globs and namespaces need no entry; an unknown namespace or glob does", () => {
  assert.deepEqual(check("slack", "tools-a", "- Set: wide", "absent:shell", "absent:write", "absent:slack_*", "absent:slack.*"), [])
  assert.match(check("slack", "tools-glob", "- Set: wide", "before:slack.*,shell")[0], /positive glob in a wide case/, "a glob passes on any tool's call")
  assert.match(check("slack", "tools-glob2", "- Set: wide", "call:slack.*#1")[0], /positive glob in a wide case/)
  assert.deepEqual(check("slack", "route-glob", "- Set: route", "before:slack.*,shell"), [], "a routing case may")
  assert.match(check("slack", "tools-arg", "- Set: wide", "absent-arg:slack_send_message args.chanel_idd == X")[0], /absent-arg:slack_send_message cannot be checked against the tool's signature/)
  assert.match(check("slack", "tools-b", "- Set: wide", "absent:nosuch.thing")[0], /no plugin nosuch/)
  assert.match(check("slack", "tools-c", "- Set: wide", "absent:zzz_*")[0], /matches no plugin or tool/)
})

test("a sibling plugin's tool may be named only in a case of set route", () => {
  assert.match(check("slack", "tools-d", "- Set: wide", "absent:list_meetings")[0], /it is granola's: only a case in set route may name it/)
  assert.match(check("slack", "tools-e", "- Set: wide", "absent:granola.list_meetings")[0], /is a tool of granola, not of slack \(only a case in set route/)
  assert.deepEqual(check("slack", "route-no-1", "- Set: route", "absent:list_meetings", "absent:granola.list_meetings", "absent-write:granola"), [])
  assert.match(check("slack", "route-no-2", "- Set: route", "absent:totally_made_up")[0], /not a tool of slack/)
})

test("a tool the plugin hides at runtime is as unreachable as an unknown one", () => {
  assert.match(check("granola", "tools-g", "- Set: wide", "absent:sign_out")[0], /hidden by granola at runtime/)
  assert.match(check("slack", "route-no-3", "- Set: route", "absent:granola.sign_out")[0], /not a reachable tool of granola/)
  assert.deepEqual(check("granola", "tools-h", "- Set: wide", "call:list_meetings#1"), [])
})

test("absent-write names a plugin, and only a case in one of the round's sets is checked", () => {
  assert.match(check("slack", "tools-i", "- Set: wide", "absent-write:nosuch")[0], /absent-write:nosuch names no plugin/)
  assert.deepEqual(toolNameProblems({ plugin: "slack", sets: [], items: [{ id: "SLK-SF01", evidence: [{ kind: "absent", tool: "send_message" }] }] }, packs), [], "a case in no round set is as it was written (a legacy corpus's)")
  assert.deepEqual(toolNameProblems({ plugin: "unknown", sets: ["wide"], items: [] }, packs), ["no pack for plugin unknown: its tools cannot be checked"])
})

test("compileCase refuses such a case when given the packs, and says what it could never do", () => {
  const text = `# tools-x\n- Plugin: slack\n- Skill under test: slack\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: synthetic\n- Set: wide\n\n## Prompt\np\n\n## Forbidden\n- [SLA-SF01] blocker · Nothing is sent.\n  evidence: absent:send_message\n`
  assert.throws(() => compileCase("cases/slack/tools-x.md", text, { packs }), (e) => e instanceof CaseError && /could never fire/.test(e.message) && /send_message is not a tool of slack/.test(e.message))
  assert.equal(compileCase("cases/slack/tools-x.md", text).id, "tools-x", "without packs it compiles as before")
})

test("against the real packs: slack's send is a tool and a made-up one is not", () => {
  const real = loadPacks()
  const slack = real.find((p) => p.id === "slack")
  assert.ok(slack.tools.some((t) => t.name === "slack_send_message"))
  assert.deepEqual(toolNameProblems(mk("slack", "tools-slack-send-message", "- Set: wide", ["absent:slack_send_message"]), real), [])
  assert.equal(toolNameProblems(mk("slack", "tools-q", "- Set: wide", ["absent:slack_publish"]), real).length, 1)
})
