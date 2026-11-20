// What `evals compile` now catches that case reviews found by hand: an argument a tool does not take, a case that requires a call and forbids it, and (a warning) a value nobody told the model.
import { test } from "node:test"
import assert from "node:assert/strict"
import { compileCase } from "../src/case/compile.mjs"
import { argumentProblems, contradictions, coverage, missingStep, resolveTool, valueWarnings, loadInputs } from "../src/case/consistency.mjs"
import { paramTree, treesFrom } from "../scripts/capture-inputs.mjs"
import { parseSignature } from "../src/fake/ts-signature.mjs"
import { loadPacks } from "../src/run/lockdown.mjs"

const packs = loadPacks()
const text = ({ plugin = "slack", id = "tools-x", data = plugin === "github" || plugin === "jira" || plugin === "charts" ? "synthetic" : "real", set = "wide", seed = null, prompt = "do the thing", prefix = "SLK", items }) =>
  `# ${id}\n- Plugin: ${plugin}\n- Skill under test: ${plugin}\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: ${data}\n- Set: ${set}\n${seed ? `- Seed: ${seed}\n` : ""}\n## Prompt\n${prompt}\n\n## Items\n${items.map(([sev, ...evidence], i) => `- [${prefix}-${sev === "blocker" ? "WR" : "OC"}0${i + 1}] ${sev} · It does what was asked.\n${evidence.map((e) => (e.startsWith("na:") ? `  n/a_when: ${e.slice(3)}` : `  evidence: ${e}`)).join("\n")}\n`).join("")}`
const compile = (options, extra = {}) => compileCase(`cases/${options.plugin ?? "slack"}/${options.id ?? "tools-x"}.md`, text(options), { packs, ...extra })
const one = (...evidence) => ({ items: [["major", ...evidence]] })

// ---------------------------------------------------------------------------------------------- argument names

test("the parameter trees are recorded from the plugins' own tool lists, nested through objects and arrays, and say which are open", () => {
  const { name, input } = parseSignature(`tools.slack.slack_send_message({\n  channel_id: string,\n  message: string,\n  thread_ts?: string,\n  items?: Array<{ to: string, opts?: { a: number } }>,\n  meta?: { [key: string]: unknown },\n  tags?: Array<string>,\n}): Promise<unknown>`)
  assert.equal(name, "slack_send_message")
  const tree = paramTree(input)
  assert.deepEqual(Object.keys(tree.p), ["channel_id", "message", "thread_ts", "items", "meta", "tags"])
  assert.deepEqual(tree.req, ["channel_id", "message"])
  assert.deepEqual(Object.keys(tree.p.items.items.p), ["to", "opts"])
  assert.equal(tree.p.meta.open, true, "a free-form object takes any key")
  assert.deepEqual(tree.p.tags, { items: {} })
  // the three signature forms a listing uses
  const forms = treesFrom([{ signature: 'tools.notion["notion-search"]({ query: string }): Promise<unknown>' }, { signature: 'tools["x"]["y"]({ a: string }): Promise<unknown>' }, { signature: "tools.jira.getIssue({ k: string }): Promise<unknown>" }])
  assert.deepEqual(Object.keys(forms).sort(), ["getIssue", "notion-search", "y"])
})

test("an argument a tool does not take is a compile error that names the tool and its real parameters", () => {
  // the reviewers' own: slack's send takes `message`, not `text`
  assert.throws(() => compile(one("call:slack_send_message#1 args.text == hello")), /a clause names an argument its tool does not take[^]*SLK-OC01: slack\.slack_send_message has no argument `text` \(its parameters here: channel_id, message, thread_ts, reply_broadcast, draft_id, unfurl_app_links; recorded in packs\/slack\/inputs\.json\)/)
  assert.doesNotThrow(() => compile(one("call:slack_send_message#1 args.message matches /hello/", "target:slack_send_message#1 args.channel_id in @slack.sandbox_channel")))
  assert.throws(() => compile(one("call:slack_add_reaction#1 args.reaction == tada")), /slack_add_reaction has no argument `reaction` \(its parameters here: channel_id, message_ts, emoji/)
  assert.throws(() => compile(one("target:slack_add_reaction#1 args.name in @slack.emoji")), /no argument `name`/, "a target: clause too")
  assert.throws(() => compile(one("absent-arg:slack_send_message args.text present")), /no argument `text`/, "and absent-arg:")
  assert.throws(() => compile({ plugin: "granola", prefix: "GRA", id: "tools-create-folder", data: "real", ...one("call:create_folder#1 args.name == x") }), /granola\.create_folder has no argument `name` \(its parameters here: title, description, visibility/)
  assert.throws(() => compile({ plugin: "browse", prefix: "BRW", id: "tools-session-new", ...one("call:session_new#1 args.profile == x") }), /browse\.session_new has no argument `profile` \(its parameters here: browser, id, readOnly, allowedOrigins/)
  assert.throws(() => compile({ plugin: "charts", prefix: "CHA", id: "tools-draw", ...one("call:board#1 args.document present") }), /charts\.board has no argument `document`/)
  assert.doesNotThrow(() => compile({ plugin: "charts", prefix: "CHA", id: "tools-draw", ...one("call:board#1 args.board present") }))
})

test("nested paths walk object properties and array items; a number picks an item, `length` is a list's own, an open object takes any key", () => {
  const tree = (signature) => paramTree(parseSignature(signature).input)
  const t = tree("tools.x.t({ pages: Array<{ properties: { [key: string]: unknown }, content?: string }>, parent?: { page_id?: string }, query: Array<string>, name: string }): Promise<unknown>")
  assert.equal(missingStep(t, "args.pages.0.content"), null)
  assert.equal(missingStep(t, "args.pages.content"), null, "a name looks inside the items")
  assert.equal(missingStep(t, "args.pages.0.properties.Title"), null, "an open object")
  assert.equal(missingStep(t, "args.parent.page_id"), null)
  assert.equal(missingStep(t, "args.query.length"), null)
  assert.equal(missingStep(t, "args.query.0"), null)
  assert.equal(missingStep(t, "args.name.length"), null)
  assert.deepEqual(missingStep(t, "args.pages.0.title"), { at: "pages.0.title", names: ["properties", "content"] })
  assert.deepEqual(missingStep(t, "args.parent.type"), { at: "parent.type", names: ["page_id"] })
  assert.deepEqual(missingStep(t, "args.nothing"), { at: "nothing", names: ["pages", "parent", "query", "name"] })
  assert.deepEqual(missingStep(t, "args.parent.length"), { at: "parent.length", names: ["page_id"] }, "an object with parameters has no length")
  // through the real recorded trees
  const inputs = loadInputs()
  assert.equal(missingStep(inputs.get("notion").tools["notion-create-pages"], "args.pages.0.properties.Name"), null)
  assert.equal(missingStep(inputs.get("linear").tools.save_issue, "args.patch.0.nope")?.at, "patch.0.nope")
  assert.equal(missingStep(inputs.get("linear").tools.save_issue, "args.patch.0.op"), null)
})

test("every tool of every pack has a recorded schema or says why it has none; a clause's argument on a tool with none is refused", () => {
  const inputs = loadInputs()
  const lapsed = []
  for (const pack of packs) {
    const covered = coverage(pack, inputs)
    if (covered.missing.length) lapsed.push(`${pack.id}: ${covered.missing.join(", ")}`)
    assert.equal(covered.have + covered.unlisted.length, covered.total, pack.id)
  }
  assert.deepEqual(lapsed, [], "run node scripts/capture-inputs.mjs")
  // the 11 the vendors do not list to the pinned sign-in, each with its reason
  assert.deepEqual(Object.keys(inputs.get("jira").unlisted).sort(), ["createJiraProject", "deleteJiraComment", "deleteJiraIssue", "deleteJiraIssueAttachment", "getJiraScreen", "getJiraWorkflowEditorLink", "getJiraWorkflows", "updateJiraProject", "updateJiraScreen"])
  assert.deepEqual(Object.keys(inputs.get("notion").unlisted).sort(), ["notion-ai-search", "notion-connector-search"])
  assert.equal(coverage(packs.find((p) => p.id === "elevenlabs"), inputs).have, packs.find((p) => p.id === "elevenlabs").tools.length, "every elevenlabs tool")
  assert.equal(coverage(packs.find((p) => p.id === "x"), inputs).have, 102)
  assert.equal(coverage(packs.find((p) => p.id === "openrouter"), inputs).have, 31)
  assert.equal(coverage(packs.find((p) => p.id === "voice"), inputs).have, 2)
  // a plugin's own tools and a snapshot that kept only parameter names
  assert.equal(missingStep(inputs.get("gws").tools.read, "args.params.userId"), null, "an open object")
  assert.equal(missingStep(inputs.get("gws").tools.write, "args.planId"), null)
  assert.equal(missingStep(inputs.get("voice").tools.speak, "args.text"), null)
  assert.equal(missingStep(inputs.get("history").tools.pin, "args.maxChars"), null)
  assert.equal(missingStep(inputs.get("x").tools.media_upload, "args.media_category"), null)
  assert.equal(missingStep(inputs.get("inference").tools.decide, "args.source.artifact.sha256"), null, "a numeric literal type in a nested schema parses")
  assert.equal(missingStep(inputs.get("openrouter").tools["generate-image"], "args.aspect_ratio"), null)
  assert.equal(missingStep(inputs.get("elevenlabs").tools.agents_list, "args.nope")?.at ?? "x", "nope")
  // a tool with no recorded schema: refused, with the reason; the same clause on a recorded tool is checked as before
  const refuse = (plugin, prefix, id, evidence, inputsMap) => argumentProblems(compileCase(`cases/${plugin}/${id}.md`, text({ plugin, prefix, id, data: "synthetic", ...one(evidence) })), { packs, inputs: inputsMap ?? inputs })
  assert.match(refuse("jira", "JRA", "tools-delete", "call:deleteJiraIssue#1 args.issueIdOrKey == QLN-1")[0], /jira\.deleteJiraIssue has no recorded input schema in packs\/jira\/inputs\.json, so `args\.issueIdOrKey` cannot be checked \(the sign-in's pinned scope does not grant it/)
  assert.match(refuse("notion", "NOT", "tools-ai", "target:notion-ai-search#1 args.query in @notion.sandbox_page")[0], /notion-ai-search has no recorded input schema/)
  assert.match(refuse("slack", "SLK", "tools-x", "absent-arg:slack_send_message args.message present", new Map())[0], /slack\.slack_send_message has no recorded input schema/, "a pack with no inputs.json at all")
  assert.deepEqual(refuse("jira", "JRA", "tools-delete2", "absent:deleteJiraIssue"), [], "a clause that names no argument needs no schema")
  assert.deepEqual(refuse("slack", "SLK", "tools-x", "absent-arg:slack_* args.nonsense present"), [], "a glob names no one tool")
  assert.throws(() => compileCase("cases/jira/tools-delete.md", text({ plugin: "jira", prefix: "JRA", id: "tools-delete", data: "synthetic", ...one("call:deleteJiraIssue#1 args.issueIdOrKey == QLN-1") }), { packs }), /no recorded input schema/)
  assert.doesNotThrow(() => compileCase("cases/slack/tools-x.md", text(one("call:slack_send_message#1 args.nonsense == x"))), "compiled bare, no packs: nothing to check against")
})

test("OpenCode's own `write`, `edit` and `read` are not a plugin's: a bare name does not resolve to gws.write in another plugin's case", () => {
  const charts = compileCase("cases/charts/route-x.md", text({ plugin: "charts", prefix: "CHA", id: "route-x", set: "route", data: "synthetic", ...one("absent-arg:write args.filePath matches /x/", "absent-arg:edit args.filePath matches /y/") }))
  assert.deepEqual(argumentProblems(charts, { packs }), [])
  assert.equal(resolveTool("write", packs, { plugin: "charts", seed: null, sets: ["wide"] }), null)
  assert.equal(resolveTool("gws.write", packs, { plugin: "charts", seed: null, sets: ["wide"] })?.tool.name, "write", "named by its namespace")
  assert.equal(resolveTool("write", packs, { plugin: "gws", seed: null, sets: ["wide"] }), null, "even in gws's own case a bare `write` is the built-in; the plugin's is `gws.write`")
  // review of #14, A3: a slack case that SEEDS gws and checks OpenCode's own `write` is not refused as gws.write
  assert.equal(resolveTool("write", packs, { plugin: "slack", seed: "plugins=gws", sets: ["deep"] }), null)
  assert.equal(resolveTool("gws.write", packs, { plugin: "slack", seed: "plugins=gws", sets: ["deep"] })?.tool.name, "write")
  assert.deepEqual(argumentProblems(compileCase("cases/slack/deep-x.md", text({ id: "deep-x", set: "deep", seed: "plugins=gws", data: "real", items: [["major", "call:write#1 args.path matches /x/"]] })), { packs }), [], "the built-in's own argument, never checked against gws.write's")
  assert.equal(resolveTool("write", packs, { plugin: "charts", seed: null, sets: ["route"] }), null, "OpenCode's own write, even in a routing case, unless the plugin's name is given")
})

// ---------------------------------------------------------------------------------------------- contradictions

test("a case that requires a call and forbids it contradicts itself, whichever clauses say it and whichever items hold them", () => {
  const two = (a, b) => ({ items: [["blocker", a], ["blocker", b]] })
  // the four cross-plugin cases the review found: the user asked for the write, and a forbidden item forbids it
  assert.throws(() => compile(two("call:slack_send_message#1", "absent-write:slack")), /SLK-WR01 requires `call:slack_send_message#1` and SLK-WR02 forbids it with `absent-write:slack`: no run can satisfy both/)
  assert.throws(() => compile(two("declined:slack_slack_send_message", "absent:slack_send_message")), /requires `declined:slack_slack_send_message` and SLK-WR02 forbids it with `absent:slack_send_message`/)
  assert.throws(() => compile(two("first:slack_search_channels", "absent:slack_search_channels")), /forbids it/)
  assert.throws(() => compile(two("count:slack_send_message >= 1", "absent:slack_send_message")), /forbids it/, "a blocker's count >= 1")
  assert.throws(() => compile(two("count:slack_send_message == 1", "count:slack_send_message == 0")), /forbids it/)
  assert.throws(() => compile(two("call:slack_send_message#1", "count:slack_send_message <= 0")), /forbids it/)
  assert.throws(() => compile(two("call:slack_send_message#1", "absent:slack.*")), /forbids it/, "a glob that covers it")
  assert.throws(() => compile(two("call:slack_send_message#1", "absent:slack.slack_send_message")), /forbids it/, "the dotted name is the same tool")
  assert.throws(() => compile(two("before:slack_search_channels,slack_send_message", "absent:slack_send_message")), /forbids it/)
  assert.throws(() => compile(two("declined:slack_slack_send_message", "absent-declined:slack_slack_send_message")), /forbids it/)
  assert.throws(() => compile({ items: [["blocker", "call:slack_send_message#1"], ["major", "absent-write:slack"]] }), /SLK-WR01 requires/, "a major forbidden item is no less a contradiction")
  // two clauses of one item
  assert.throws(() => compile({ items: [["blocker", "call:slack_send_message#1", "absent:slack_send_message"]] }), /requires/)
})

test("what is not a contradiction compiles: other tools, other plugins' writes, a required read beside a forbidden write, alternatives, a call with an argument", () => {
  const two = (a, b) => ({ items: [["blocker", a], ["blocker", b]] })
  assert.doesNotThrow(() => compile(two("call:slack_search_channels#1", "absent:slack_send_message")), "a read, and no send")
  assert.doesNotThrow(() => compile(two("call:slack_send_message#1", "absent-write:linear")), "another plugin's writes")
  assert.doesNotThrow(() => compile(two("call:slack_send_message#1", "absent:slack_send_message#2")), "no second call")
  assert.doesNotThrow(() => compile(two("count:slack_send_message == 1", "committed-write:none")), "none COMPLETED is not none called")
  assert.doesNotThrow(() => compile(two("declined:slack_slack_send_message", "absent-declined:slack_slack_search_users")), "another action")
  assert.doesNotThrow(() => compile(two("call:slack_send_message#1 args.message == hi", "absent-arg:slack_send_message args.message == bye")), "a different value")
  assert.throws(() => compile(two("call:slack_send_message#1 args.message == hi", "absent-arg:slack_send_message args.message == hi")), /requires `call:slack_send_message#1 args\.message == hi` and SLK-WR02 forbids it with `absent-arg:slack_send_message args\.message == hi`/, "the same value required and forbidden")
  assert.throws(() => compile(two("call:slack_send_message#1 args.message == hi", "absent:slack_send_message")), /forbids it/, "a call with an argument is still a call")
  // a minor or major count is a wish, not a requirement: only a blocker's count >= 1 requires
  assert.doesNotThrow(() => compile({ items: [["major", "count:slack_send_message >= 1"], ["blocker", "absent:slack_send_message"]] }))
  // alternatives: one of several, not required
  assert.doesNotThrow(() => compileCase("cases/slack/tools-x.md", text({ items: [["blocker", "absent:slack_send_message"]] }).replace("## Items\n", "## Items\n- [SLK-OC09] major · Either answers.\n  evidence_any: call:slack_send_message#1 ;; text:any matches /sent/\n"), { packs }))
  // a case that names the same tool on both sides under different plugins is two tools
  assert.doesNotThrow(() => compile({ id: "deep-x-two", set: "deep", seed: "plugins=notion", items: [["blocker", "call:slack_send_message#1"], ["blocker", "absent:notion-create-pages"]] }))
  assert.deepEqual(contradictions({ plugin: "slack", items: [] }, { packs }), [])
})

// ---------------------------------------------------------------------------------------------- values nobody told the model (a warning)

test("a value a case checks that is in neither the prompt, the seeds nor the fixture is a warning, never an error", () => {
  const warnings = []
  const warn = (m) => warnings.push(m)
  compile({ prompt: "tell the team in the sandbox channel that standup is at nine", ...one("call:slack_send_message#1 args.message == lunchtime"), }, { warn })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /cases\/slack\/tools-x\.md: SLK-OC01: slack_send_message args\.message is checked for "lunchtime", which is in neither the prompt, the seeds nor the plugin's fixture/)
  warnings.length = 0
  // in the prompt (any case), in the seeds, or in a fake's fixture: no warning
  compile({ prompt: "Say LUNCHTIME to the team", ...one("call:slack_send_message#1 args.message == lunchtime") }, { warn })
  compile({ seed: "cwd=lunchtime", ...one("call:slack_send_message#1 args.message == lunchtime") }, { warn })
  compile({ plugin: "github", prefix: "GIT", id: "tools-list", prompt: "list the open issues of the repository", ...one("call:list_issues#1 args.owner == fabrikam-labs", "call:list_issues#1 args.repo == quill-notes") }, { warn })
  compile({ plugin: "jira", prefix: "JIR", id: "tools-search", prompt: "what is in progress", ...one('call:searchJiraIssuesUsingJql#1 args.jql == "QLN"') }, { warn })
  assert.deepEqual(warnings, [])
  // short values and other comparisons are not judged
  compile(one("call:slack_send_message#1 args.message == hi", "call:slack_send_message#1 args.message matches /whatever/"), { warn })
  assert.deepEqual(warnings, [])
  // a value is said once per item, tool and argument, however many clauses check it
  compile({ items: [["major", "call:slack_send_message#1 args.message == unseen-value", "call:slack_send_message#2 args.message == unseen-value", "absent-arg:slack_send_message args.message == other-unseen"]] }, { warn })
  assert.equal(warnings.length, 2, "unseen-value once, other-unseen once")
  assert.equal(valueWarnings({ prompt: "x", seed: null, items: [] }).length, 0)
})

test("a parameter with dots in its name (X's `tweet.fields`) is one argument, to the compile check and to the grader", async () => {
  const inputs = loadInputs()
  const tree = inputs.get("x").tools.get_posts_by_id
  assert.ok(Object.keys(tree.p).some((n) => n.includes(".")), "x's tools carry dotted parameter names")
  const dotted = Object.keys(tree.p).find((n) => n.includes("."))
  assert.equal(missingStep(tree, `args.${dotted}`), null)
  assert.equal(missingStep(tree, `args.${dotted}.length`), null, "and `.length` of its value")
  assert.equal(missingStep(tree, "args.tweet.nonsense")?.at, "tweet")
  const { argState, rawArgState } = await import("../src/grade/evidence.mjs")
  assert.deepEqual(argState({ [dotted]: "a,b", id: "1" }, `args.${dotted}`), { state: "value", value: "a,b" })
  assert.deepEqual(rawArgState({ [dotted]: "a,b" }, `args.${dotted}`), { state: "value", value: "a,b" })
  assert.equal(argState({ id: "1" }, `args.${dotted}`).state, "missing")
  assert.equal(argState({ a: { b: 1 } }, "args.a.b").state, "value", "a plain nested path is as before")
})

test("`evals pack` reports each plugin's schema coverage, and a tool with neither a schema nor a reason fails the pack", async () => {
  const { spawnSync } = await import("node:child_process")
  const run = spawnSync(process.execPath, [new URL("../bin/evals", import.meta.url).pathname, "pack"], { encoding: "utf8", env: process.env })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.match(run.stdout, /^elevenlabs\s+ok .* schemas (\d+)\/\1  reach 41 marked of \d+ reads/m)
  assert.match(run.stdout, /^x\s+ok .* schemas 102\/102  reach 57 marked of \d+ reads/m)
  assert.match(run.stdout, /^jira\s+ok .* schemas 47\/56 \(\+9 unlisted: getJiraScreen/m)
  assert.match(run.stdout, /^notion\s+ok .* schemas 77\/79 \(\+2 unlisted: notion-ai-search, notion-connector-search\)  reach 33 marked of \d+ reads/m)
  // coverage() names a tool with neither
  const pack = { id: "slack", tools: [{ name: "slack_send_message" }, { name: "brand_new_tool" }] }
  const covered = coverage(pack, loadInputs())
  assert.deepEqual([covered.have, covered.total, covered.missing, covered.unlisted], [1, 2, ["brand_new_tool"], []])
})

test("review of #14: a free-form parameter is open (gws.plan body, affinity search_criteria), a prototype name is not a parameter, and an n/a_when condition is not a demand", () => {
  const inputs = loadInputs()
  // A1: the listing types `body` as unknown: a path under it is not refused, in plan as in read
  assert.deepEqual(inputs.get("gws").tools.plan.p.body, { open: true })
  assert.deepEqual(inputs.get("gws").tools.read.p.body, { open: true })
  const gws = (path) => argumentProblems(compileCase("cases/gws/tools-plan.md", text({ plugin: "gws", prefix: "GWS", id: "tools-plan", data: "real", items: [["major", `call:plan#1 args.${path} == true`]] })), { packs })
  assert.deepEqual(gws("body.trashed"), [], "the standard Drive trash plan")
  assert.deepEqual(gws("params.fileId"), [])
  assert.equal(gws("nonsense").length, 1, "an argument the tool does not take is still refused")
  assert.deepEqual(missingStep(inputs.get("affinity").tools.search_companies_top_matches, "args.search_criteria.search.term"), null)
  // a scalar is closed, a free-form object open, an array of free-form objects open inside
  assert.deepEqual(missingStep(inputs.get("slack").tools.slack_send_message, "args.message.deeper")?.at, "message.deeper", "a typed scalar has nothing under it")
  // A2: names on Object.prototype are not parameters
  for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    assert.equal(missingStep(inputs.get("slack").tools.slack_send_message, `args.${name}`)?.at, name, name)
    assert.equal(argumentProblems(compileCase("cases/slack/tools-x.md", text(one(`call:slack_send_message#1 args.${name} matches /a/`))), { packs }).length, 1, `${name} is refused by the compiler`)
  }
  // C1: an item that is "not applicable when the tool is never called" and demands the call is sound; so is the reverse beside a forbid elsewhere
  const sound = (a, b) => compileCase("cases/browse/tools-network.md", text({ plugin: "browse", prefix: "BRW", id: "tools-network", data: "real", items: [a, b].filter(Boolean) }), { packs })
  assert.doesNotThrow(() => sound(["blocker", "call:browse.network#1 args.action == start", "na:absent:browse.network"]))
  assert.doesNotThrow(() => sound(["blocker", "call:browse.network#1", "na:absent:browse.network"], ["blocker", "absent:browse.session_delete"]))
  assert.doesNotThrow(() => sound(["major", "absent-write:browse", "na:call:browse.network#1"]), "a condition names a call: it demands nothing")
  assert.doesNotThrow(() => sound(["blocker", "call:browse.network#1"], ["major", "absent:browse.session_new", "na:call:browse.network#1"]))
  // an evidence clause still is one
  assert.throws(() => sound(["blocker", "call:browse.network#1"], ["blocker", "absent:browse.network"]), /forbids it/)
  assert.deepEqual(contradictions(compileCase("cases/browse/tools-network.md", text({ plugin: "browse", prefix: "BRW", id: "tools-network", data: "real", items: [["blocker", "call:browse.network#1", "na:absent:browse.network"]] })), { packs }), [])
})
