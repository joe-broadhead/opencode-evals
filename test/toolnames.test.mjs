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

const mk = (plugin, id, header, evidence, data = "synthetic") => compileCase(`cases/${plugin}/${id}.md`, `# ${id}
- Plugin: ${plugin}
- Skill under test: ${plugin}
- Tier: T3
- Source: test
- Decision tested: x
- Data: ${data}
${header}
## Prompt
do it

## Forbidden
- [${plugin.slice(0, 3).toUpperCase()}-SF01] blocker · Nothing is sent.
${evidence.map((e) => `  evidence: ${e}`).join("\n")}
`)

// granola reads other people's meetings: its cases are `Data: real` (a header is one line, so the label is passed, not appended)
const check = (plugin, id, header, ...evidence) => toolNameProblems(mk(plugin, id, header, evidence, plugin === "granola" ? "real" : "synthetic"), packs)

test("a tool the plugin has, by any of its names, is fine; one it lacks is a problem that names the version", () => {
  assert.deepEqual(check("slack", "tools-slack-send-message", "- Set: wide", "absent:slack_send_message", "absent:slack.slack_send_message", "count:slack_search_users <= 2"), [])
  assert.deepEqual(check("slack", "tools-slack-send-message2", "- Set: wide", "declined:slack_slack_send_message", "count:slack_send_message == 1"), [], "a declined write is still a call")
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
  // with no recorded parameters a misspelt absent-arg: path is unverifiable and refused; where the pack records them (slack does) it is checked at compile instead (test/consistency.test.mjs)
  assert.match(toolNameProblems(mk("slack", "tools-arg", "- Set: wide", ["absent-arg:slack_send_message args.chanel_idd == X"]), packs, { inputs: new Map() })[0], /absent-arg:slack_send_message cannot be checked against the tool's signature/)
  assert.deepEqual(check("slack", "tools-arg", "- Set: wide", "absent-arg:slack_send_message args.chanel_idd == X"), [], "recorded: argumentProblems says it, at compile")
  assert.match(check("slack", "tools-b", "- Set: wide", "absent:nosuch.thing")[0], /no plugin nosuch/)
  assert.match(check("slack", "tools-c", "- Set: wide", "absent:zzz_*")[0], /matches no plugin or tool/)
})

test("a sibling plugin's tool may be named only in a case of set route", () => {
  assert.match(check("slack", "tools-d", "- Set: wide", "absent:list_meetings")[0], /it is granola's: only a case in set route, or one whose Seed: plugins= lists granola, may name it/)
  assert.match(check("slack", "tools-e", "- Set: wide", "absent:granola.list_meetings")[0], /is a tool of granola, not of slack \(only a case in set route, or one whose Seed: plugins= lists granola/)
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

// ---------------------------------------------------------------------------------------------- companions: Seed: plugins=

const withHidden = packs.map((p) => (p.id === "notion" ? { ...p, tools: [...p.tools, { name: "notion-delete", permission: "notion_notion-delete", class: "write", hidden: true }, { name: "notion-create-pages", permission: "notion_notion-create-pages", class: "write" }] } : p))
const deep = (id, seed, ...evidence) => toolNameProblems(mk("slack", id, `- Set: deep\n${seed ? `- Seed: ${seed}\n` : ""}`, evidence), withHidden)

test("a deep case may name the tools of a companion its Seed: plugins= lists, with every clause that names a tool, checked against the companion's own pack", () => {
  const seed = "plugins=notion,jira"
  // the interview-to-Slack shape: the case's own plugin is slack, the companion is notion (and jira)
  assert.deepEqual(deep("deep-x-a", seed, "call:notion-search#1", "call:notion.notion-search#1", "first:notion-search", "before:notion-search,slack_send_message", "absent:notion-create-pages", "absent:notion.notion-create-pages", "count:notion-search <= 2", "call:getJiraIssue#1", "absent-write:jira"), [])
  assert.deepEqual(deep("deep-x-a2", seed, "declined:notion_notion-create-pages", "target:notion-create-pages#1 args.parent in @notion.sandbox_page"), [])
  // the case's own tools are still its own
  assert.deepEqual(deep("deep-x-b", seed, "call:slack_send_message#1", "declined:slack_slack_send_message"), [])
  assert.deepEqual(deep("deep-x-b2", seed, "absent:slack_send_message"), [])
  // a companion's tool the pack lacks is a problem, named with the companion's pack and version
  const bad = deep("deep-x-c", seed, "call:notion-nosuch#1", "absent:notion.nosuch-either", "call:jira.getjiraissue#1")
  assert.equal(bad.length, 3)
  assert.match(bad[0], /notion-nosuch is not a tool of slack v0\.0\.6/)
  assert.match(bad[1], /notion\.nosuch-either is not a tool of notion v0\.0\.5/, "checked against notion's pack")
  assert.match(bad[2], /jira\.getjiraissue is not a tool of jira v0\.0\.5/, "spelt as the plugin spells it")
  // a companion's hidden tool is as unreachable as anywhere
  assert.match(deep("deep-x-d", seed, "absent:notion-delete")[0], /notion-delete is hidden by notion at runtime/)
  assert.match(deep("deep-x-e", seed, "absent:notion.notion-delete")[0], /is not a reachable tool of notion/)
})

test("a plugin the case does not seed is still refused, whatever else it seeds, and in a case that seeds nothing; the plugin's own seed is no companion", () => {
  assert.match(deep("deep-x-f", "plugins=jira", "call:notion-search#1")[0], /it is notion's: only a case in set route, or one whose Seed: plugins= lists notion, may name it/)
  assert.match(deep("deep-x-g", "plugins=jira", "call:notion.notion-search#1")[0], /is a tool of notion, not of slack \(only a case in set route, or one whose Seed: plugins= lists notion/)
  assert.match(deep("deep-x-h", null, "absent:notion-search")[0], /it is notion's/)
  assert.match(deep("deep-x-i", "cwd=api", "call:getJiraIssue#1")[0], /it is jira's/)
  assert.match(deep("deep-x-j", "plugins=slack", "call:notion-search#1")[0], /it is notion's/, "seeding itself seeds nobody")
  // seeded with spaces and with a list, as the Seed: header allows
  assert.deepEqual(deep("deep-x-k", "plugins=jira, notion files=x", "call:notion-search#1", "call:getJiraIssue#1"), [])
  // a wide case may name its seeded companion too, and a route case still any sibling
  assert.deepEqual(toolNameProblems(mk("slack", "tools-seeded", "- Set: wide\n- Seed: plugins=notion\n", ["call:notion-search#1"]), packs), [])
  assert.match(toolNameProblems(mk("slack", "tools-unseeded", "- Set: wide\n- Seed: plugins=jira\n", ["call:notion-search#1"]), packs)[0], /it is notion's/)
  assert.deepEqual(toolNameProblems(mk("slack", "route-any", "- Set: route\n", ["call:notion-search#1", "call:getJiraIssue#1"]), packs), [])
})

test("the real packs: a Slack deep case that seeds granola names Slack's send and Granola's read; one that does not seed it cannot", () => {
  const real = loadPacks()
  const text = (seed) => `# deep-x-notes
- Plugin: slack
- Skill under test: slack
- Tier: T3
- Source: test
- Decision tested: x
- Data: real
- Set: deep
${seed ? `- Seed: ${seed}\n` : ""}
## Prompt
Summarise my last meeting and post the action items to my own DM.

## Items
- [SLK-WR01] blocker · The action items go to the self-DM.
  evidence: call:slack_send_message#1
  evidence: before:granola.get_meetings,slack_send_message
  evidence: declined:slack_slack_send_message
`
  const seeded = toolNameProblems(compileCase("cases/slack/deep-x-notes.md", text("plugins=granola")), real)
  assert.deepEqual(seeded, [])
  const unseeded = toolNameProblems(compileCase("cases/slack/deep-x-notes.md", text(null)), real)
  assert.ok(unseeded.some((p) => /granola/.test(p) && /Seed: plugins=/.test(p)), unseeded.join("\n"))
})

test("a positive glob on a plugin the case neither owns nor seeds is refused; a negative one, a seeded one and the case's own are fine", () => {
  assert.match(deep("deep-x-g1", "plugins=jira", "call:notion.*#1")[0], /notion\.\* names notion, which this case does not seed \(Seed: plugins=notion\) and which is not its own: a positive match on it can never be satisfied/)
  assert.match(deep("deep-x-g2", null, "first:notion.*")[0], /names notion, which this case does not seed/)
  assert.match(deep("deep-x-g3", "plugins=jira", "before:notion.*,slack_send_message")[0], /names notion/)
  assert.deepEqual(deep("deep-x-g4", "plugins=jira", "absent:notion.*"), [], "nothing of an unseeded plugin was called: a negative clause is true, not vacuous")
  assert.deepEqual(deep("deep-x-g5", "plugins=notion", "call:notion.*#1"), [], "seeded")
  assert.deepEqual(deep("deep-x-g6", "plugins=notion", "call:slack.*#1"), [], "the case's own")
  assert.deepEqual(toolNameProblems(mk("slack", "route-glob2", "- Set: route\n", ["call:notion.*#1"]), packs), [], "a routing case may name any sibling")
})

test("a Seed: key written twice is a compile error: the compiler reads the first plugins= and the runner the last", () => {
  assert.throws(() => mk("slack", "deep-x-dup", "- Set: deep\n- Seed: plugins=slack plugins=notion\n", ["absent:slack_send_message"]), /the Seed: key `plugins=` is written twice: the compiler reads the first and the runner the last/)
  assert.throws(() => mk("slack", "deep-x-dup2", "- Set: deep\n- Seed: files=a cwd=x files=b\n", ["absent:slack_send_message"]), /key `files=` is written twice/)
  assert.doesNotThrow(() => mk("slack", "deep-x-ok", "- Set: deep\n- Seed: plugins=notion,jira files=a cwd=x\n", ["absent:slack_send_message"]))
  assert.doesNotThrow(() => mk("slack", "deep-x-ok2", "- Set: deep\n- Seed: plugins=notion, jira\n", ["absent:slack_send_message"]))
})
