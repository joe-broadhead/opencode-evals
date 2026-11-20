// Privacy by construction: the least `Data:` a case may declare is a floor over the tools it can call (its plugin's named ones, and every marked tool of each companion it seeds), lifted
// only by a `target:` clause that scopes the call to a sandbox alias. `evals compile` refuses a lower label.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { compileCase } from "../src/case/compile.mjs"
import { dataFloor, reachProblems, loadReach } from "../src/case/reach.mjs"
import { loadPacks } from "../src/run/lockdown.mjs"
import { MARKS, build } from "../scripts/reach-marks.mjs"

const ROOT = join(import.meta.dirname, "..")
const packs = loadPacks()
// `items`, when given, replaces `evidence` (one major item per line): [[severity, ...lines]], a line `any:a ;; b` is the item's evidence_any and `na:c` its n/a_when.
const render = (items, prefix) => items.map(([severity, ...lines], i) => `- [${prefix}-${severity === "blocker" ? "WR" : "OC"}0${i + 1}] ${severity} · It does what was asked.\n${lines.map((l) => (l.startsWith("any:") ? `  evidence_any: ${l.slice(4)}` : l.startsWith("na:") ? `  n/a_when: ${l.slice(3)}` : `  evidence: ${l}`)).join("\n")}\n`).join("")
const text = ({ plugin = "slack", id = "tools-x", data = "seeded", seed = null, set = "wide", evidence = ["absent:slack_send_message"], items = null, prefix = "SLK" } = {}) =>
  `# ${id}\n- Plugin: ${plugin}\n- Skill under test: ${plugin}\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: ${data}\n- Set: ${set}\n${seed ? `- Seed: ${seed}\n` : ""}\n## Prompt\ndo the thing\n\n## Items\n${items ? render(items, prefix) : evidence.map((e, i) => `- [${prefix}-OC0${i + 1}] major · It does what was asked.\n  evidence: ${e}\n`).join("")}`
const compile = (options, extra = {}) => compileCase(`cases/${options?.plugin ?? "slack"}/${options?.id ?? "tools-x"}.md`, text(options), { packs, ...extra })
const floorOf = (options) => dataFloor(compileCase(`cases/${options?.plugin ?? "slack"}/${options?.id ?? "tools-x"}.md`, text({ ...options, data: "candidate" })), { packs })?.kind ?? null

test("the marks name tools their packs have, and the files are what scripts/reach-marks.mjs builds", () => {
  for (const [id, spec] of Object.entries(MARKS)) {
    const pack = JSON.parse(readFileSync(join(ROOT, "packs", id, "pack.json"), "utf8"))
    const built = build(id, spec, pack) // throws on a mark for a tool the pack lacks
    assert.equal(readFileSync(join(ROOT, "packs", id, "reach.json"), "utf8"), `${JSON.stringify(built, null, 1)}\n`, `${id}: run node scripts/reach-marks.mjs`)
    for (const mark of Object.values(built.tools)) assert.ok(["own", "real", "candidate"].includes(mark.floor) && mark.why, JSON.stringify(mark))
  }
  assert.deepEqual([...loadReach().keys()].sort(), Object.keys(MARKS).sort())
})

test("the reviewers' lists are marked: workspace-wide searches and lists, directories, signed URLs, conversations, gws read, and nothing in the fakes", () => {
  const reach = loadReach()
  const real = (plugin, ...tools) => tools.forEach((t) => assert.equal(reach.get(plugin).tools[t]?.floor, "real", `${plugin}.${t}`))
  real("notion", "notion-search", "notion-ai-search", "notion-connector-search", "notion-memory-search", "notion-list-shared-pages", "notion-list-recent-pages", "notion-list-private-pages", "notion-get-teams", "notion-get-users", "notion-get-sidebar-tabs", "notion-search-agents", "notion-search-sessions", "notion-get-file-download-urls")
  real("slack", "slack_search_public", "slack_search_public_and_private", "slack_search_channels", "slack_search_users", "slack_list_user_channels", "slack_read_user_profile")
  real("linear", "list_users", "list_teams", "get_notifications", "list_issues", "list_documents", "list_initiatives", "list_releases", "list_release_notes", "list_templates", "list_agent_skills", "issues")
  real("elevenlabs", "agents_get_conversation", "agents_get_conversation_audio_url", "agents_list_conversations", "agents_get_memory", "agents_list_batch_calls", "agents_list_alerts", "agents_list_triage_tickets")
  assert.equal(reach.get("gws").tools.read.floor, "real")
  assert.equal(reach.get("gws").tools.read.lower.floor, "own")
  assert.equal(reach.get("boxd").tools.read.floor, "own")
  assert.equal(reach.get("x").tools.search_posts_all.floor, "real", "every read of x")
  assert.equal(reach.has("github") || reach.has("jira"), false, "the fakes hold no real data")
  assert.equal(reach.get("slack").tools.slack_search_users.unscopable, true)
  assert.equal(reach.get("slack").tools.slack_read_channel.unscopable, undefined, "a read by id can be scoped")
  assert.equal(reach.get("slack").tools.slack_send_message, undefined, "a write is graded at its declined call")
})

test("a case on its own plugin has the floor of the tools its clauses name; the ones it does not name do not count", () => {
  assert.equal(floorOf({ evidence: ["call:slack_search_public#1"] }), "real")
  assert.equal(floorOf({ evidence: ["first:slack_search_users"] }), "real")
  assert.equal(floorOf({ evidence: ["before:slack_search_channels,slack_send_message"] }), "real")
  assert.equal(floorOf({ evidence: ["absent:slack_send_message", "declined:slack_slack_send_message"] }), null, "a write, declined: nothing it can read is named")
  assert.equal(floorOf({ evidence: ["absent:slack_search_public"] }), null, "a tool it must NOT call sets no floor")
  assert.throws(() => compile({ data: "seeded", evidence: ["call:slack_search_public#1"] }), /Data: seeded is below this case's floor, real: it can call slack\.slack_search_public \(searches every channel of the workspace/)
  assert.throws(() => compile({ data: "own", evidence: ["call:slack_search_users#1"] }), /below this case's floor, real/)
  assert.doesNotThrow(() => compile({ data: "real", evidence: ["call:slack_search_public#1"] }))
  assert.doesNotThrow(() => compile({ data: "seeded", evidence: ["absent:slack_send_message"] }))
  assert.equal(compile({ data: "candidate", evidence: ["call:slack_search_public#1"] }).data, "candidate", "a higher label is fine")
})

// What lifts a floor: EVERY call constrained, on the argument that selects what the tool returns, to a sandbox alias. Blocker items, `count <= N`, `target:` for calls 1..N, exact aliases of the
// tool's own plugin. The mutations below each remove one part, and the floor must stay.
const lift = (extra = [], { data = "seeded", tool = "slack_read_channel", arg = "channel_id", alias = "@slack.sandbox_channel", options = {} } = {}) =>
  compile({ data, items: [["blocker", `count:${tool} == 1`, `target:${tool}#1 args.${arg} in ${alias}`], ...extra], ...options })
const stays = (what, run) => assert.throws(run, /below this case's floor, real/, what)

test("a floor lifts only when every call is constrained, on the argument that selects what the tool returns, to an exact sandbox alias of its plugin: the shape that lifts", () => {
  assert.equal(floorOf({ evidence: ["call:slack_read_channel#1"] }), "real", "an unscoped read of a channel by id")
  assert.doesNotThrow(() => lift())
  assert.doesNotThrow(() => lift([], { alias: "@slack.sandbox_channel, @slack.self_dm" }), "two exact aliases of its own plugin")
  // calls 1..N, each constrained
  assert.doesNotThrow(() => compile({ data: "seeded", items: [["blocker", "count:slack_read_channel <= 2", "target:slack_read_channel#1 args.channel_id in @slack.sandbox_channel", "target:slack_read_channel#2 args.channel_id in @slack.sandbox_channel"]] }))
  assert.doesNotThrow(() => compile({ data: "seeded", items: [["blocker", "count:slack_read_channel < 2", "target:slack_read_channel#1 args.channel_id in @slack.sandbox_channel"]] }), "< 2 is one call")
  // a directory and a workspace-wide search have no argument that bounds them
  stays("a user directory", () => compile({ data: "seeded", items: [["blocker", "count:slack_search_users == 1", "target:slack_search_users#1 args.query in @slack.self_name"]] }))
  stays("a workspace-wide search", () => compile({ data: "seeded", items: [["blocker", "count:slack_search_public == 1", "target:slack_search_public#1 args.query in @slack.sandbox_query"]] }))
  stays("the reviewers' example: scoped in the prompt, the tool searches the whole workspace", () => compile({ data: "seeded", evidence: ["call:slack_search_public#1"] }))
})

test("MUTATIONS: a weak, partial, loose or unrelated target clause must not lift the floor", () => {
  const read = "target:slack_read_channel#1 args.channel_id in @slack.sandbox_channel"
  const one = ["count:slack_read_channel == 1", read]
  // the clauses are in the wrong place: an item that is not a blocker, an alternative, a condition
  for (const severity of ["major", "minor"]) stays(`a ${severity} item`, () => compile({ data: "seeded", items: [[severity, ...one]] }))
  stays("the target in a major item, the count in a blocker", () => compile({ data: "seeded", items: [["blocker", "count:slack_read_channel == 1"], ["major", read]] }))
  stays("the count in a major item, the target in a blocker", () => compile({ data: "seeded", items: [["major", "count:slack_read_channel == 1"], ["blocker", read]] }))
  stays("one alternative of an evidence_any", () => compile({ data: "seeded", items: [["blocker", "count:slack_read_channel == 1", `any:${read} ;; text:any matches /sandbox/i`]] }))
  stays("an n/a_when condition", () => compile({ data: "seeded", items: [["blocker", "count:slack_read_channel == 1", `na:${read}`]] }))
  // only some of the calls are constrained, or the calls are not bounded at all
  stays("call #1 only, where two calls are allowed", () => compile({ data: "seeded", items: [["blocker", "count:slack_read_channel <= 2", read]] }))
  stays("call #2 only", () => compile({ data: "seeded", items: [["blocker", "count:slack_read_channel <= 2", "target:slack_read_channel#2 args.channel_id in @slack.sandbox_channel"]] }))
  stays("no count bound: the model may call it again", () => compile({ data: "seeded", items: [["blocker", read]] }))
  stays("a bound no one reads as one (>= 1)", () => compile({ data: "seeded", items: [["blocker", "count:slack_read_channel >= 1", read]] }))
  stays("a bound above the cap (11 calls)", () => compile({ data: "seeded", items: [["blocker", "count:slack_read_channel <= 11", read]] }))
  stays("the bound is on another tool", () => compile({ data: "seeded", items: [["blocker", "count:slack_read_thread == 1", read]] }))
  // the clause is on an argument that does not select what comes back, or on another tool
  for (const arg of ["limit", "cursor", "latest", "oldest", "response_format"]) stays(`args.${arg}`, () => lift([], { arg }))
  stays("the scope of another tool of the plugin", () => compile({ data: "seeded", items: [["blocker", "count:slack_read_channel == 1", "target:slack_read_thread#1 args.channel_id in @slack.sandbox_channel"]] }))
  // the alias is loose, a created id, another plugin's, or one the store does not hold
  stays("a prefix alias (a loose match)", () => lift([], { alias: "@slack.sandbox_channel*" }))
  stays("created, in a major item (a read creates nothing)", () => compile({ data: "seeded", items: [["blocker", "count:slack_read_channel == 1"], ["major", "target:slack_read_channel#1 args.channel_id in created"]] }))
  stays("an alias and created, in a major item", () => compile({ data: "seeded", items: [["blocker", "count:slack_read_channel == 1"], ["major", "target:slack_read_channel#1 args.channel_id in @slack.sandbox_channel,created"]] }))
  assert.throws(() => lift([], { alias: "created" }), /created/, "created in a blocker is refused outright")
  stays("an exact alias beside a loose one", () => lift([], { alias: "@slack.sandbox_channel,@slack.sandbox*" }))
  stays("another plugin's alias", () => lift([], { alias: "@boxd.name" }))
  stays("a notion alias on a slack tool", () => lift([], { alias: "@notion.sandbox_page" }))
  stays("an alias the store's targets do not hold", () => compile({ data: "seeded", items: [["blocker", ...one]] }, { targets: new Set(["slack.self_dm"]) }))
  assert.doesNotThrow(() => compile({ data: "seeded", items: [["blocker", ...one]] }, { targets: new Set(["slack.sandbox_channel"]) }), "the same clause with an alias the store holds lifts")
  // a tool with no scope argument never lifts, whatever is said: linear's get_initiative takes a free-text query, list_comments has five selectors
  const never = (tool, arg, alias) => assert.throws(() => compile({ plugin: "linear", prefix: "LIN", id: "tools-read", data: "seeded", items: [["blocker", `count:${tool} == 1`, `target:${tool}#1 args.${arg} in ${alias}`]] }), /no clause can lift it: none of these tools has an argument that selects what it returns/)
  never("get_initiative", "query", "@linear.sandbox_initiative")
  never("list_comments", "issueId", "@linear.sandbox_issue")
  never("get_team", "query", "@linear.sandbox_team")
  // and the ones that have one do: linear get_issue by id, list_issues by team; notion fetch by id
  assert.doesNotThrow(() => compile({ plugin: "linear", prefix: "LIN", id: "tools-read", data: "seeded", items: [["blocker", "count:get_issue == 1", "target:get_issue#1 args.id in @linear.sandbox_issue"]] }))
  assert.doesNotThrow(() => compile({ plugin: "linear", prefix: "LIN", id: "tools-read", data: "seeded", items: [["blocker", "count:list_issues == 1", "target:list_issues#1 args.team in @linear.sandbox_team"]] }))
  assert.doesNotThrow(() => compile({ plugin: "notion", prefix: "NOT", id: "tools-read", data: "seeded", items: [["blocker", "count:notion-fetch == 1", "target:notion-fetch#1 args.id in @notion.sandbox_page"]] }))
  assert.throws(() => compile({ plugin: "notion", prefix: "NOT", id: "tools-read", data: "seeded", items: [["blocker", "count:notion-fetch == 1", "target:notion-fetch#1 args.include_transcript in @notion.sandbox_page"]] }), /floor, real/, "notion-fetch's scope is its id")
  // the message says what would lift it
  assert.throws(() => compile({ data: "seeded", evidence: ["call:slack_read_channel#1"] }), /constrain every call of slack\.slack_read_channel by args\.channel_id to a sandbox alias: a blocker `count:<tool> <= N` and a blocker `target:<tool>#n args\.<argument> in @<its own plugin's alias>`/)
})

test("gws read takes its floor from its operation, for EVERY call: gmail is the owner's real mail, drive and calendar their own", () => {
  const gws = (items, data = "seeded") => compile({ plugin: "gws", prefix: "GWS", id: "tools-read", data, items })
  const drive = (n) => `call:gws.read#${n} args.operation == drive.files.list`
  assert.throws(() => gws([["blocker", "call:gws.read#1"]]), /Data: seeded is below this case's floor, real: it can call gws\.read \(gmail\.\* reads the owner's real mail/)
  assert.throws(() => gws([["blocker", "count:gws.read == 1", "call:gws.read#1 args.operation == gmail.users.messages.list"]]), /floor, real/)
  assert.throws(() => gws([["blocker", "count:gws.read == 1", "call:gws.read#1 args.operation matches /^calendar\\./"]]), /floor, real/, "a pattern does not say which operation: only an exact one lowers")
  assert.throws(() => gws([["blocker", "count:gws.read <= 2", drive(1)]]), /floor, real/, "call #2 is free")
  assert.throws(() => gws([["blocker", "count:gws.read <= 2", drive(1), "call:gws.read#2"]]), /floor, real/, "every clause that names it must")
  assert.throws(() => gws([["blocker", drive(1)]]), /floor, real/, "no count bound")
  assert.throws(() => gws([["major", "count:gws.read == 1", drive(1)]]), /floor, real/, "a major item")
  assert.throws(() => gws([["blocker", "count:gws.read == 1", `any:${drive(1)} ;; text:any matches /files/`]]), /floor, real/, "one alternative of an evidence_any")
  assert.throws(() => gws([["blocker", "count:gws.read == 1", `na:${drive(1)}`]]), /floor, real/, "an n/a_when condition")
  assert.throws(() => gws([["blocker", "count:gws.read == 1", "call:gws.read#1 args.operation == calendar.events.list"]], "seeded"), /Data: seeded is below this case's floor, own/)
  assert.doesNotThrow(() => gws([["blocker", "count:gws.read == 1", "call:gws.read#1 args.operation == calendar.events.list"]], "own"))
  assert.doesNotThrow(() => gws([["blocker", "count:gws.read <= 2", drive(1), "call:gws.read#2 args.operation == drive.files.get"]], "own"))
  assert.doesNotThrow(() => gws([["blocker", "call:gws.read#1"]], "real"))
})

test("every marked tool's scope is a parameter it takes, and an unscopable tool has none; the scopes are only where one argument selects what comes back", () => {
  const reach = loadReach()
  const inputs = (id) => JSON.parse(readFileSync(join(ROOT, "packs", id, "inputs.json"), "utf8")).tools
  let scoped = 0
  for (const [id, marks] of reach) {
    for (const [name, mark] of Object.entries(marks.tools)) {
      if (mark.scope === undefined) continue
      scoped++
      assert.equal(mark.unscopable, undefined, `${id}.${name} is unscopable and has a scope`)
      assert.ok(Object.hasOwn(inputs(id)[name]?.p ?? {}, mark.scope), `${id}.${name} has no parameter ${mark.scope}`)
    }
  }
  assert.ok(scoped > 50, `${scoped} tools have a scope`)
  // the ones with none, by design: free-text queries, lists across selectors, directories
  for (const [id, name] of [["linear", "get_initiative"], ["linear", "get_project"], ["linear", "list_comments"], ["linear", "list_documents"], ["slack", "slack_search_public"], ["notion", "notion-search"], ["notion", "notion-query-data-sources"], ["elevenlabs", "agents_list_secrets"], ["elevenlabs", "agents_query_workspace_conversations"], ["jobs", "list"], ["browse", "secrets_list"], ["gws", "events_list"]]) assert.equal(reach.get(id).tools[name]?.scope, undefined, `${id}.${name}`)
  assert.equal(reach.get("slack").tools.slack_read_channel.scope, "channel_id")
  assert.equal(reach.get("linear").tools.get_issue.scope, "id")
  assert.equal(reach.get("notion").tools["notion-fetch"].scope, "id")
})

test("the reviewers' flagged reads are marked: the six elevenlabs conversation and analytics reads, the signed URL and the transcription, and gws events_list (own)", () => {
  const reach = loadReach()
  for (const name of ["agents_search_conversation_messages", "agents_semantic_search_conversation_messages", "agents_query_workspace_conversations", "agents_resolve_conversation", "agents_query_analytics", "agents_list_whatsapp_accounts", "agents_get_signed_url", "creative_transcribe_audio"]) {
    assert.equal(reach.get("elevenlabs").tools[name]?.floor, "real", name)
  }
  assert.equal(reach.get("gws").tools.events_list?.floor, "own")
  // so a case that calls one cannot be synthetic
  assert.throws(() => compile({ plugin: "elevenlabs", prefix: "ELV", id: "tools-search", data: "synthetic", evidence: ["call:agents_search_conversation_messages#1"] }), /Data: synthetic is below this case's floor, real/)
  assert.throws(() => compile({ plugin: "elevenlabs", prefix: "ELV", id: "tools-url", data: "seeded", evidence: ["call:agents_get_signed_url#1"] }), /below this case's floor, real/)
  assert.throws(() => compile({ plugin: "gws", prefix: "GWS", id: "tools-events", data: "seeded", evidence: ["call:gws.events_list#1"] }), /Data: seeded is below this case's floor, own/)
  assert.doesNotThrow(() => compile({ plugin: "gws", prefix: "GWS", id: "tools-events", data: "own", evidence: ["call:gws.events_list#1"] }))
})

test("a COMPANION in Seed: plugins= brings every marked tool of it, named or not: a synthetic plugin that seeds Slack is real", () => {
  // charts is a synthetic plugin with no marks of its own
  const charts = (options) => compile({ plugin: "charts", prefix: "CHA", id: "tools-draw", set: "wide", evidence: ["absent:execute"], ...options })
  assert.equal(floorOf({ plugin: "charts", prefix: "CHA", evidence: ["absent:execute"] }), null, "alone: no floor")
  assert.throws(() => charts({ data: "synthetic", seed: "plugins=slack" }), /Data: synthetic is below this case's floor, real: it can call slack\.slack_[a-z_]+ \([^)]*\).* and \d+ more, through slack, a plugin its Seed: plugins= installs with the owner's sign-in/)
  assert.throws(() => charts({ data: "own", seed: "plugins=slack" }), /floor, real/)
  assert.doesNotThrow(() => charts({ data: "real", seed: "plugins=slack" }))
  // the companion's tools need not be named: a declined send is all the case asks for, and the model could read first
  assert.throws(() => charts({ data: "seeded", seed: "plugins=slack", evidence: ["declined:slack_slack_send_message"] }), /floor, real/)
  // each of the reviewers' companions
  for (const companion of ["notion", "linear", "x", "elevenlabs"]) assert.throws(() => charts({ data: "synthetic", seed: `plugins=${companion}` }), /floor, real/, companion)
  assert.throws(() => charts({ data: "synthetic", seed: "plugins=gws" }), /floor, real: it can call gws\.read/, "Gmail")
  assert.throws(() => charts({ data: "synthetic", seed: "plugins=boxd" }), /Data: synthetic is below this case's floor, own: it can call boxd\./)
  // a lower floor from a companion's `gws read` with a calendar operation only
  // (the companion's other marked tools: gws.events_list is `own` too, so the case is `own`)
  const calendar = [["blocker", "count:gws.read == 1", "call:gws.read#1 args.operation == calendar.events.list"]]
  assert.doesNotThrow(() => charts({ data: "own", seed: "plugins=gws", evidence: undefined, items: calendar }))
  assert.throws(() => charts({ data: "seeded", seed: "plugins=gws", items: calendar }), /floor, own/)
  // the highest floor over all the companions
  assert.throws(() => charts({ data: "own", seed: "plugins=boxd,slack" }), /floor, real/)
  assert.doesNotThrow(() => charts({ data: "own", seed: "plugins=boxd" }))
  // a companion whose marked tools are all scoped to sandbox aliases lifts: here a one-tool reach, to show the rule, not the packs
  const reach = new Map([["slack", { tools: { slack_read_channel: { floor: "real", why: "a channel by id", scope: "channel_id" } } }]])
  const lifted = (items, data = "synthetic", r = reach) => reachProblems(compileCase("cases/charts/tools-draw.md", text({ plugin: "charts", prefix: "CHA", id: "tools-draw", data, seed: "plugins=slack", items })), { packs, reach: r })
  const scopedRead = [["blocker", "count:slack_read_channel == 1", "target:slack_read_channel#1 args.channel_id in @slack.sandbox_channel"]]
  assert.equal(lifted(scopedRead).length, 0, "the only marked tool, every call constrained on its scope")
  assert.equal(lifted([["major", "absent:execute"]]).length, 1, "unscoped")
  assert.equal(lifted([["major", ...scopedRead[0].slice(1)]]).length, 1, "constrained in a major item: no lift")
  assert.equal(lifted([["blocker", "target:slack_read_channel#1 args.channel_id in @slack.sandbox_channel"]]).length, 1, "no count bound: no lift")
  assert.equal(lifted([["blocker", "count:slack_read_channel == 1", "target:slack_read_channel#1 args.limit in @slack.sandbox_channel"]]).length, 1, "an argument that is not the scope: no lift")
  const unscopable = new Map([["slack", { tools: { slack_read_channel: { floor: "real", why: "x", unscopable: true } } }]])
  assert.equal(lifted(scopedRead, "synthetic", unscopable).length, 1, "an unscopable tool never lifts")
  const noScope = new Map([["slack", { tools: { slack_read_channel: { floor: "real", why: "x" } } }]])
  assert.equal(lifted(scopedRead, "synthetic", noScope).length, 1, "a tool with no scope argument never lifts")
})

test("the fake plugins hold no sign-in, so seeding one adds no floor; a fake-mode case that seeds a real plugin does", () => {
  const github = (options) => compile({ plugin: "github", prefix: "GIT", id: "tools-issue", data: "synthetic", evidence: ["absent:issue_write"], ...options })
  assert.doesNotThrow(() => github({ seed: "plugins=jira" }), "jira is fake too")
  assert.throws(() => github({ seed: "plugins=linear" }), /Data: synthetic is below this case's floor, real: it can call linear\./, "linear holds the owner's sign-in")
  assert.throws(() => github({ seed: "plugins=slack" }), /through slack/)
  assert.doesNotThrow(() => github({ seed: "plugins=linear", data: "real" }))
})

test("the floor sits on top of the plugin-level minimum, and a case with no label or no packs is not judged here", () => {
  assert.throws(() => compile({ plugin: "granola", prefix: "GRA", id: "tools-x", data: "seeded", evidence: ["absent:sign_out"] }), /reads real data|floor/)
  assert.deepEqual(reachProblems({ plugin: "slack", items: [] }, { packs }), [], "no Data: label")
  assert.equal(dataFloor({ plugin: "slack", data: "seeded", items: [] }, { packs: null }), null, "no packs")
  assert.equal(dataFloor({ plugin: "nopack", data: "seeded", items: [] }, { packs }), null)
  // compile without packs does not judge (the unit tests of other things compile bare cases)
  assert.doesNotThrow(() => compileCase("cases/slack/tools-x.md", text({ data: "seeded", evidence: ["call:slack_search_public#1"] })))
})
