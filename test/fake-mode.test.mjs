// Fake mode (`accounts: fake`, GitHub and Jira): the catalogs, the fixtures, the `@fixture` clause, the override and the fake MCP server over HTTP.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawn, spawnSync } from "node:child_process"
import { parseSignature } from "../src/fake/ts-signature.mjs"
import { OWN_TOOLS, catalogProblems, githubCatalog } from "../scripts/mcp-catalog.mjs"
import { readCatalog, installFake, fakeFor, hostsFor, FAKE_HOSTS, REAL_HOSTS } from "../src/run/fake-mode.mjs"
import { makeFakeCa } from "../src/run/fake-ca.mjs"
import { parseWhen } from "../src/fake/fixtures/when.mjs"
import { fixtureFacts } from "../src/fake/facts.mjs"
import * as githubFixture from "../src/fake/fixtures/github.mjs"
import * as jiraFixture from "../src/fake/fixtures/jira.mjs"
import { compileCase } from "../src/case/compile.mjs"
import { runView, gradeCase } from "../src/grade/grade.mjs"
import { sealedConfig } from "../src/run/sandbox.mjs"

const ROOT = join(import.meta.dirname, "..")
const pack = (id) => JSON.parse(readFileSync(join(ROOT, "packs", id, "pack.json"), "utf8"))
const scratch = () => mkdtempSync(join(tmpdir(), "evals-fake-"))

test("ts-signature turns a Code Mode signature back into JSON Schema", () => {
  const sig = `tools.jira.getThing({
  /** Site id. */
  cloudId: string,
  /**
   * How many. @integer @minimum 1 @maximum 100
   * @default 50
   */
  max?: number,
  /** Which one. */
  dataset?: "board" | "backlog",
  tags?: Array<string>,
  fields?: {
    [key: string]: unknown,
  },
}): Promise<unknown>`
  const { name, input } = parseSignature(sig)
  assert.equal(name, "getThing")
  assert.deepEqual(input.required, ["cloudId"])
  assert.equal(input.properties.cloudId.description, "Site id.")
  assert.deepEqual({ type: input.properties.max.type, minimum: input.properties.max.minimum, maximum: input.properties.max.maximum, default: input.properties.max.default }, { type: "integer", minimum: 1, maximum: 100, default: 50 })
  assert.deepEqual(input.properties.dataset.enum, ["board", "backlog"])
  assert.deepEqual(input.properties.tags, { type: "array", items: { type: "string" } })
  assert.equal(input.properties.fields.type, "object")
  assert.deepEqual(parseSignature("tools.x.nothing(): Promise<unknown>").input, { type: "object", properties: {} })
  assert.throws(() => parseSignature("not a signature"), /not a tool signature/)
})

test("each catalog serves exactly its pack's tools, less the plugin's own and the unserved, each with a description and an object schema", () => {
  for (const id of ["github", "jira"]) {
    const catalog = readCatalog(id)
    assert.equal(catalog.plugin, id)
    assert.equal(catalog.server, id)
    assert.deepEqual(catalogProblems(catalog, pack(id)), [], id)
    for (const own of OWN_TOOLS[id]) assert.equal(catalog.tools.some((t) => t.name === own), false, `${own} is the plugin's own tool`)
    for (const tool of catalog.tools) assert.ok(tool.description.length > 0 && tool.inputSchema.type === "object", tool.name)
  }
  assert.equal(readCatalog("github").tools.length, 98)
  assert.equal(readCatalog("jira").tools.length, 46)
  assert.ok(readCatalog("github").tools.filter((t) => t.source === "snapshot").length >= 90)
  // a tool the catalog drops, or one the pack lacks, is a problem
  const github = readCatalog("github")
  assert.match(catalogProblems({ ...github, tools: github.tools.slice(1) }, pack("github"))[0], /is a tool of the pack the catalog does not serve/)
  assert.match(catalogProblems({ ...github, tools: [...github.tools, { ...github.tools[0], name: "invented_tool" }] }, pack("github"))[0], /is served and is not a tool of the pack/)
  // The seven tools of the hosted server that the open-source snapshots lack are all served, each with the best text there is, and the catalog says where from:
  // one is a signed-in host's own listing (exact), four are the open-source README's title and parameters, two have no public listing and stay stand-ins.
  const by = (source) => github.tools.filter((t) => t.source === source).map((t) => t.name).sort()
  assert.equal(by("snapshot").length, 91)
  assert.deepEqual(by("host-listing"), ["check_dependency_vulnerabilities"])
  assert.deepEqual(by("readme"), ["create_pull_request_with_copilot", "get_copilot_space", "github_support_docs_search", "list_copilot_spaces"])
  assert.deepEqual(by("derived"), ["issue_artifact_read", "issue_artifact_write"], "the stand-ins: keep out of scoring and tuning until GitHub publishes them")
  const tool = (name) => github.tools.find((t) => t.name === name)
  assert.deepEqual(tool("check_dependency_vulnerabilities").inputSchema.required.sort(), ["dependencies", "owner", "repo"])
  assert.equal(tool("check_dependency_vulnerabilities").inputSchema.properties.dependencies.items.properties.ecosystem.enum.includes("gomod"), true)
  assert.deepEqual(tool("create_pull_request_with_copilot").inputSchema.required, ["owner", "repo", "problem_statement", "title"], "base_ref is optional")
  assert.deepEqual(tool("get_copilot_space").inputSchema.required, ["owner", "name"])
  assert.deepEqual(tool("list_copilot_spaces").inputSchema.properties, {})
  assert.equal(tool("github_support_docs_search").inputSchema.required[0], "query")
  for (const name of [...by("host-listing"), ...by("readme")]) assert.doesNotMatch(tool(name).description, /^[A-Z][a-z]+( [a-z]+)*\.$/, `${name} has the published text, not a humanised name`)
  assert.equal(tool("create_pull_request_with_copilot").annotations.readOnlyHint, false)
  // a pack tool with no snapshot is derived, and says so
  const withExtras = githubCatalog({ version: "0", tools: [{ name: "from_readme", readOnly: true }, { name: "no_text", readOnly: true }] }, {}, {}, { provenance: {}, tools: [{ name: "from_readme", description: "Published.", inputSchema: { type: "object", properties: {} }, source: "readme" }] })
  assert.deepEqual(withExtras.tools.map((t) => [t.name, t.source, t.description]), [["from_readme", "readme", "Published."], ["no_text", "derived", "No text."]])
  const derived = githubCatalog({ version: "0", tools: [{ name: "brand_new_read", readOnly: true }] }, {})
  assert.equal(derived.tools[0].source, "derived")
  assert.equal(derived.tools[0].annotations.readOnlyHint, true)
})

test("the catalogs carry no email, token or real host", () => {
  for (const id of ["github", "jira"]) {
    const text = readFileSync(join(ROOT, "packs", id, "mcp.json"), "utf8")
    assert.doesNotMatch(text, /ghp_[A-Za-z0-9]{20}|github_pat_|xox[bp]-|[A-Za-z0-9._-]+@(?!example\.)[A-Za-z0-9-]+\.(com|org|net|io)\b/i, id)
  }
})

test("the fixtures' facts are what their data computes, and use invented names only", () => {
  const f = githubFixture.facts
  assert.equal(f.open_issue_count, String(githubFixture.issues.filter((i) => i.state === "open").length))
  assert.deepEqual(f.open_pr_numbers, githubFixture.pulls.filter((p) => p.state === "open").map((p) => String(p.number)))
  const j = jiraFixture.facts
  assert.equal(j.issue_count, String(jiraFixture.issues.length))
  assert.deepEqual(j.in_progress_keys, jiraFixture.issues.filter((i) => i.status === "In Progress").map((i) => i.key))
  assert.equal(fixtureFacts("github"), github())
  assert.equal(fixtureFacts("nope"), null)
  function github() {
    return githubFixture.facts
  }
  // a read of the fixture returns the fact, a read of another repository does not exist
  const ok = githubFixture.call("list_issues", { owner: "fabrikam-labs", repo: "quill-notes", state: "OPEN" })
  for (const t of f.open_issue_titles) assert.ok(ok.text.includes(t))
  assert.equal(githubFixture.call("list_issues", { owner: "someone", repo: "else" }).isError, true)
  assert.match(githubFixture.call("add_issue_comment", { body: "x" }).text, /Nothing was changed/)
  assert.match(jiraFixture.call("createJiraIssue", {}).text, /Nothing was changed/)
  const jql = jiraFixture.call("searchJiraIssuesUsingJql", { jql: 'project = QLN AND status = "In Progress"', searchResultMode: "count" })
  assert.equal(JSON.parse(jql.text).count, Number(j.in_progress_count))
  assert.equal(jiraFixture.call("searchJiraIssuesUsingJql", { jql: "banana = 3" }).isError, true)
  for (const fixture of [githubFixture, jiraFixture]) assert.doesNotMatch(JSON.stringify([fixture.issues, fixture.facts]), /prosus|broadhead|@gmail/i)
})

const body = (clause, plugin = "github", data = "synthetic") => `# tools-fixture-x\n- Plugin: ${plugin}\n- Skill under test: ${plugin}\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: ${data}\n- Set: wide\n\n## Prompt\nhow many open issues are there\n\n## Items\n- [${plugin === "github" ? "GH" : "JI"}-OC01] major · It states what the fixture holds.\n  evidence: ${clause}\n`
const compile = (clause, plugin, data) => compileCase(`cases/${plugin ?? "github"}/tools-fixture-x.md`, body(clause, plugin, data))
const grade = (c, answer) => {
  const head = { schema: "oc-trace/1", run_id: "t/0", case: c.id, exit: 0, summary: { text: { sha256: "0".repeat(64) }, tokens: {} } }
  return gradeCase(c, runView([head], { text: answer, noAccount: null, guard: { ran: true, committed: 0, assert_committed: 0 } })).items[0]
}

test("the @fixture clause: an answer that states the fixture's fact passes, an invented one fails, a number stands alone", () => {
  const count = compile("text:any contains @fixture.github.open_issue_count")
  assert.equal(grade(count, "There are 4 open issues in fabrikam-labs/quill-notes.").state, "pass")
  assert.equal(grade(count, "There are 14 open issues.").state, "fail", "4 is not 14")
  assert.equal(grade(count, "There are 9 open issues.").state, "fail", "an invented answer")
  const titles = compile("text:any contains @fixture.github.open_issue_titles")
  assert.equal(grade(titles, githubFixture.facts.open_issue_titles.join("; ")).state, "pass")
  assert.equal(grade(titles, githubFixture.facts.open_issue_titles.slice(1).join("; ")).state, "fail", "every value of a list")
  assert.match(grade(titles, "Fix login bug; Update docs").detail ?? "", /not read from the fixture/)
  const jira = compile("text:last-line contains @fixture.jira.in_progress_keys", "jira")
  assert.equal(grade(jira, "Two are in progress.\nQLN-1 and QLN-5").state, "pass")
  assert.equal(grade(jira, "QLN-1 and QLN-5 are in progress.\nOnly that.").state, "fail", "the span is the last line")
})

test("compile refuses an @fixture clause for an unknown plugin or fact, and a fake-mode case that is not synthetic", () => {
  assert.throws(() => compile("text:any contains @fixture.github.no_such_fact"), /is not a fact of the github fixture/)
  assert.throws(() => compile("text:any contains @fixture.slack.anything", "github"), /no fake fixture for slack/)
  assert.throws(() => compile("text:any contains @fixture.github.me", "github", "real"), /declare `- Data: synthetic`/)
})

test("fake mode adds no MCP server to the config: the plugin registers its own at its default URL, and the trial maps that host to the fake", () => {
  // A server of the plugin's own name in the config is a `conflict` to both plugins (no namespace text, no tool filter): nothing may put one there.
  for (const mcp of [undefined, { github: { type: "remote", url: "http://127.0.0.1:1/mcp" } }]) assert.equal(sealedConfig({ armDir: null, model: "mock/m1", mcp }).mcp, undefined)
  assert.deepEqual(fakeFor(["github", "slack", "jira"], new Set(["github", "jira"])), ["github", "jira"])
  assert.deepEqual(hostsFor(["jira", "github"]), [{ id: "jira", host: "mcp.atlassian.com", ip: "127.0.0.3" }, { id: "github", host: "api.githubcopilot.com", ip: "127.0.0.2" }])
  // each plugin's own loopback address, never 127.0.0.1 (the trial's own server and the mock live there)
  assert.equal(new Set(Object.values(FAKE_HOSTS).map((h) => h.ip)).size, 2)
  for (const { ip } of Object.values(FAKE_HOSTS)) assert.match(ip, /^127\.0\.0\.[2-9]$/)
  for (const hosts of Object.values(REAL_HOSTS)) assert.ok(hosts.length >= 3)
  for (const [id, { host }] of Object.entries(FAKE_HOSTS)) assert.ok(REAL_HOSTS[id].includes(host), `${host} is a host the proxy refuses`)
})

test("the per-batch CA signs the fake hosts only, keeps no key, and a leaf is good for its own host name alone", () => {
  const dir = scratch()
  try {
    const { ca, leaves } = makeFakeCa(dir, { github: "api.githubcopilot.com", jira: "mcp.atlassian.com" })
    assert.deepEqual(readdirSync(dir).filter((f) => f === "ca.key"), [], "the CA's private key is deleted once the leaves are signed")
    const verify = (cert, host) => spawnSync("openssl", ["verify", "-CAfile", ca, "-verify_hostname", host, cert], { encoding: "utf8" })
    assert.equal(verify(leaves.jira.cert, "mcp.atlassian.com").status, 0)
    assert.equal(verify(leaves.github.cert, "api.githubcopilot.com").status, 0)
    assert.notEqual(verify(leaves.jira.cert, "api.githubcopilot.com").status, 0, "a leaf names its own host")
    const text = spawnSync("openssl", ["x509", "-in", ca, "-noout", "-text"], { encoding: "utf8" }).stdout
    assert.match(text, /Name Constraints: critical\s+Permitted:\s+DNS:api\.githubcopilot\.com\s+DNS:mcp\.atlassian\.com/, "the CA may sign only the fake hosts")
    assert.match(text, /CA:TRUE, pathlen:0/)
    assert.throws(() => makeFakeCa(join(dir, "x"), { a: "bad host;rm" }), /not a host name/)
    assert.throws(() => makeFakeCa(join(dir, "y"), {}), /no host/)
    // a second batch's CA is another CA: nothing carries over
    const other = makeFakeCa(join(dir, "other"), { jira: "mcp.atlassian.com" })
    assert.notEqual(readFileSync(other.ca, "utf8"), readFileSync(ca, "utf8"))
    assert.notEqual(verify(other.leaves.jira.cert, "mcp.atlassian.com").status, 0, "a leaf of another batch's CA is not trusted by this one")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("installFake copies the server, the fixtures and the catalogs of the plugins asked for, makes the batch's CA, and refuses a plugin it holds no catalog or host for", () => {
  const dir = scratch()
  try {
    const out = installFake(dir, ["github"])
    for (const f of ["mcp-server.ts", "github.catalog.json", "fixtures/github.mjs", "fixtures/when.mjs", "tls/ca.pem", "tls/github.key", "tls/github.pem"]) assert.ok(existsSync(join(out.dir, f)), f)
    assert.equal(existsSync(join(out.dir, "jira.catalog.json")), false)
    assert.equal(existsSync(join(out.dir, "tls", "ca.key")), false)
    assert.equal(out.ca, join(out.dir, "tls", "ca.pem"))
    assert.deepEqual(Object.keys(out.leaves), ["github"])
    assert.throws(() => installFake(dir, ["slack"]), /packs\/slack\/mcp\.json does not exist/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const hasBun = spawnSync("bun", ["--version"]).status === 0

test("the fake server speaks MCP over HTTP: it lists the pack's tools, answers from the fixture, refuses an unknown tool, and logs every request", { skip: !hasBun }, async () => {
  const dir = scratch()
  const port = 20000 + Math.floor(Math.random() * 20000)
  const log = join(dir, "fake.jsonl")
  const proc = spawn("bun", [join(ROOT, "src/fake/mcp-server.ts"), String(port), log, join(ROOT, "packs/github/mcp.json"), join(ROOT, "src/fake/fixtures/github.mjs")], { stdio: "ignore" })
  try {
    let up = false
    for (let i = 0; i < 100 && !up; i++) {
      up = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false)
      if (!up) await new Promise((r) => setTimeout(r, 100))
    }
    assert.ok(up, "the server started")
    const rpc = (message) => fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...message }) })
    const list = await (await rpc({ method: "tools/list" })).json()
    assert.equal(list.result.tools.length, readCatalog("github").tools.length)
    assert.ok(list.result.tools.every((t) => t.description && t.inputSchema))
    const read = await (await rpc({ method: "tools/call", params: { name: "list_issues", arguments: { owner: "fabrikam-labs", repo: "quill-notes", state: "OPEN" } } })).json()
    assert.ok(read.result.content[0].text.includes("Notes vanish after a failed sync"))
    const write = await (await rpc({ method: "tools/call", params: { name: "add_issue_comment", arguments: { body: "x" } } })).json()
    assert.match(write.result.content[0].text, /Nothing was changed/)
    const unknown = await (await rpc({ method: "tools/call", params: { name: "no_such_tool", arguments: {} } })).json()
    assert.match(unknown.error.message, /Unknown tool/)
    assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`, { method: "GET" })).status, 405)
    assert.equal((await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource`)).status, 404, "no discovery document: a client finds no sign-in to do")
    // the vendors' own paths answer, whatever they are (/v2/mcp for Jira, /mcp/ for GitHub)
    for (const path of ["/v2/mcp?tools=all", "/mcp/"]) assert.equal((await (await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }) })).json()).id, 9, path)
    const entries = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l))
    assert.deepEqual(entries.filter((e) => e.ev === "tools/call").map((e) => e.tool), ["list_issues", "add_issue_comment", "no_such_tool"])
    assert.equal(entries.find((e) => e.tool === "no_such_tool").unknown, true)
  } finally {
    proc.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("fake mode needs a confined trial: --isolation none is refused for a fake plugin, since only a container can map the vendor's host name to the fake", async () => {
  const { mkdirSync, writeFileSync: write } = await import("node:fs")
  const { runBatch } = await import("../src/run/runner.mjs")
  const { installFakeOpencode, installFakeBun } = await import("./helpers/fake-opencode.mjs")
  const root = scratch()
  try {
    const store = join(root, "store")
    mkdirSync(store)
    const casesDir = join(root, "cases")
    mkdirSync(casesDir)
    const text = body("call:github.list_issues#1", "github").replace("how many open issues are there", "list the open issues of fabrikam-labs/quill-notes")
    write(join(casesDir, "tools-fixture-x.json"), JSON.stringify(compileCase("cases/github/tools-fixture-x.md", text)))
    const arm = join(root, "plugin")
    mkdirSync(join(arm, "dist"), { recursive: true })
    write(join(arm, "package.json"), JSON.stringify({ name: "@x/github", version: "0.0.8" }))
    write(join(arm, "dist", "index.js"), "export default {}\n")
    const bin = join(root, "bin")
    mkdirSync(bin)
    const home = join(root, "user")
    mkdirSync(home)
    const tmp = join(root, "tmp")
    mkdirSync(tmp)
    const caller = { PATH: process.env.PATH, HOME: home, EVALS_STORE: store, EVALS_OPENCODE_BIN: installFakeOpencode(bin), EVALS_BUN: installFakeBun(bin), EVALS_TMP: tmp }
    await assert.rejects(runBatch({ isolation: "none", unsafeNoIsolation: true, plugin: "github", model: "mock/m1", scripted: true, cases: "tools-fixture-x", arm, casesDir, set: "wide", iteration: "fk", auth: "none" }, { caller, log: () => {} }), /fake mode \(github\) needs --isolation container/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------------------------------------------ the fakes' query languages

const jql = (q, extra = {}) => {
  const out = jiraFixture.call("searchJiraIssuesUsingJql", { jql: q, ...extra })
  return out.isError ? `ERR ${out.text}` : JSON.parse(out.text).issues?.map((i) => i.key) ?? JSON.parse(out.text)
}

test("fake Jira: JQL filters on created and updated, so a date-window case is graded on the query and not only on the issues it names", () => {
  // the window case: the answer is what the query returns, so a wrong window gives another list
  assert.deepEqual(jql('project = QLN AND created >= "2026-09-01" AND created <= "2026-09-10"'), ["QLN-1", "QLN-2"])
  assert.deepEqual(jql('project = QLN AND created >= "2026-09-01" AND created <= "2026-09-10"'), jiraFixture.facts.created_sept_1_to_10_keys)
  assert.deepEqual(jql("created >= 2026-09-11 ORDER BY created DESC"), jiraFixture.facts.created_sept_11_on_keys)
  assert.deepEqual(jql('created < "2026-09-01"'), jiraFixture.facts.created_before_sept_1_keys)
  assert.notDeepEqual(jql('created >= "2026-09-03" AND created <= "2026-09-10"'), jql('created >= "2026-09-01" AND created <= "2026-09-10"'), "a window that starts after QLN-1 was created returns a different answer")
  // a bare date is that day's midnight, as Jira reads it: <= the 16th stops before QLN-7 (10:05 on the 16th); a time brings it in
  assert.ok(!jql('created <= "2026-09-16"').includes("QLN-7"))
  assert.ok(jql('created <= "2026-09-16 23:59"').includes("QLN-7"))
  assert.ok(jql('created >= "2026-09-16T10:05:00Z"').includes("QLN-7"))
  assert.ok(!jql('created > "2026-09-16 10:05"').includes("QLN-7"))
  // = on a day is the whole day
  assert.deepEqual(jql("created = 2026-09-05"), ["QLN-2"])
  assert.deepEqual(jql('created != "2026-09-05"').length, 6)
  // updated, and together with the other fields
  assert.deepEqual(jql('updated >= "2026-09-16" AND status = "In Progress"'), ["QLN-5"])
  assert.deepEqual(jql("updated = 2026-09-16"), jiraFixture.facts.updated_sept_16_keys)
  assert.deepEqual(jql("assignee = currentUser() AND created >= -30d"), ["QLN-1", "QLN-5"], "-30d counts back from the fake's fixed now")
  assert.deepEqual(jql("created >= -2d"), ["QLN-7"], "now is 2026-09-17 12:00: QLN-7 (the 16th) is inside two days")
  assert.deepEqual(jql("created >= -1d"), [], "and outside one")
  // the count mode agrees
  assert.equal(JSON.parse(jiraFixture.call("searchJiraIssuesUsingJql", { jql: 'created >= "2026-09-01" AND created <= "2026-09-10"', searchResultMode: "count" }).text).count, 2)
  // what it cannot read it says, never an empty list that would look like an answer
  for (const bad of ['created >= "last week"', "created >= startOfFortnight()", "created >= 2026-13-45", "status > 3", "created ~ 5", "resolved is maybe"]) assert.match(jql(bad), /^ERR The fake does not understand/, bad)
})

test("fake Jira: resolved, resolutiondate, resolution and statusCategory, with Jira's date functions, so a \"done this week\" case can be asked and graded", () => {
  const f = jiraFixture.facts
  // "done this week": now is Thursday 2026-09-17 12:00 UTC, the week starts on Monday the 14th
  assert.deepEqual(jql("statusCategory = Done AND resolved >= startOfWeek()"), ["QLN-6"])
  assert.deepEqual(jql("resolved >= startOfWeek()"), f.resolved_this_week_keys)
  assert.deepEqual(jql("resolved >= -7d"), f.resolved_last_7_days_keys)
  assert.deepEqual(jql('resolutiondate >= "2026-09-01" AND resolutiondate <= "2026-09-10"'), f.resolved_before_sept_10_keys, "resolutiondate is resolved")
  assert.deepEqual(jql("resolved >= startOfWeek(-1w) AND resolved < startOfWeek()"), [], "last week: nothing was resolved then")
  assert.deepEqual(jql("resolved >= startOfMonth()"), ["QLN-4", "QLN-6"], "QLN-4 was resolved on the 1st")
  assert.deepEqual(jql('resolved >= "2026-09-01" AND resolved <= endOfWeek()'), ["QLN-4", "QLN-6"])
  // an issue with no resolution has no date: no comparison matches it, and is EMPTY / is NULL do
  assert.deepEqual(jql("resolved is EMPTY"), ["QLN-1", "QLN-2", "QLN-3", "QLN-5", "QLN-7"])
  assert.deepEqual(jql("resolved is NULL"), jql("resolved is EMPTY"))
  assert.deepEqual(jql("resolved is not EMPTY"), ["QLN-4", "QLN-6"])
  assert.ok(!jql("resolved <= endOfYear()").includes("QLN-1"))
  assert.equal(jql("resolution = Unresolved").length, Number(f.unresolved_count))
  assert.deepEqual(jql("resolution = Done"), f.done_keys)
  assert.deepEqual(jql("statusCategory = Done"), f.done_keys)
  assert.deepEqual(jql('statusCategory in ("To Do", "In Progress")').length, 5)
  assert.deepEqual(jql("statusCategory != Done AND resolution is EMPTY").length, 5)
  assert.deepEqual(jql("assignee is EMPTY"), ["QLN-3"])
  assert.deepEqual(jql("assignee is not EMPTY").length, 6)
  // the date functions
  const at = (t) => new Date(parseWhen(t).start).toISOString()
  assert.equal(at("startOfWeek()"), "2026-09-14T00:00:00.000Z")
  assert.equal(at("startOfWeek(-1w)"), "2026-09-07T00:00:00.000Z")
  assert.equal(at("endOfWeek()"), "2026-09-20T23:59:59.999Z")
  assert.equal(at("startOfDay()"), "2026-09-17T00:00:00.000Z")
  assert.equal(at("startOfMonth(-1M)"), "2026-08-01T00:00:00.000Z")
  assert.equal(at("startOfYear()"), "2026-01-01T00:00:00.000Z")
  assert.equal(at('startOfWeek("-1")'), "2026-09-07T00:00:00.000Z", "a bare increment counts in the function's own unit")
  assert.equal(at("-1M"), "2026-08-17T12:00:00.000Z")
  assert.equal(at("+1d"), "2026-09-18T12:00:00.000Z")
  assert.equal(parseWhen("startOfFoo()"), null)
  // the returned issues carry the dates
  const six = JSON.parse(jiraFixture.call("getJiraIssue", { issueIdOrKey: "QLN-6" }).text)
  assert.equal(six.resolved, "2026-09-14T15:00:00Z")
  assert.equal(six.resolution, "Done")
})

const ghSearch = (tool, query) => {
  const out = githubFixture.call(tool, { query })
  return out.isError ? `ERR ${out.text}` : JSON.parse(out.text).items.map((i) => i.number)
}

test("fake GitHub: search reads created:, updated:, assignee:, is:open and the other qualifiers, as GitHub does, and refuses what it cannot read", () => {
  const f = githubFixture.facts
  assert.deepEqual(ghSearch("search_issues", "repo:fabrikam-labs/quill-notes is:open"), [1, 2, 3, 5])
  assert.deepEqual(ghSearch("search_issues", "is:closed"), [4, 6])
  assert.deepEqual(ghSearch("search_issues", "assignee:ada-lantern is:open"), [1, 5])
  assert.deepEqual(ghSearch("search_issues", "assignee:@me is:open"), [1, 5])
  assert.deepEqual(ghSearch("search_issues", "no:assignee"), [3])
  assert.deepEqual(ghSearch("search_issues", "author:bo-marlowe"), [1, 4])
  assert.deepEqual(ghSearch("search_issues", 'label:"good first issue"'), [3], "a quoted label with spaces")
  assert.deepEqual(ghSearch("search_issues", "label:bug -label:sync"), [2, 4])
  assert.deepEqual(ghSearch("search_issues", "is:open sync in:title"), [1])
  // dates: a date alone is a whole day, as in GitHub
  assert.deepEqual(ghSearch("search_issues", "created:2026-09-01..2026-09-10"), f.created_sept_1_to_10_issue_numbers.map(Number))
  assert.deepEqual(ghSearch("search_issues", "created:>2026-09-10"), f.created_after_sept_10_issue_numbers.map(Number))
  assert.deepEqual(ghSearch("search_issues", "created:<=2026-09-05"), [1, 2, 4, 6], "<= takes all of the 5th")
  assert.deepEqual(ghSearch("search_issues", "created:<2026-09-05"), [1, 4, 6], "< stops before the 5th")
  assert.deepEqual(ghSearch("search_issues", "created:>=2026-09-05"), [2, 3, 5])
  assert.deepEqual(ghSearch("search_issues", "created:2026-09-05"), [2])
  assert.deepEqual(ghSearch("search_issues", "created:2026-09-11..*"), [3, 5])
  assert.deepEqual(ghSearch("search_issues", "created:*..2026-09-01"), [4, 6], "to the 1st: #4 (Aug 21) and #6 (Aug 30)")
  assert.deepEqual(ghSearch("search_issues", "updated:>=2026-09-12"), [1, 5])
  assert.deepEqual(ghSearch("search_issues", "is:closed closed:>=2026-09-02"), f.closed_since_sept_2_issue_numbers.map(Number))
  assert.deepEqual(ghSearch("search_issues", "closed:2026-09-01..2026-09-03"), [4, 6])
  assert.deepEqual(ghSearch("search_issues", "is:open closed:>=2026-01-01"), [], "an open issue has no closing date")
  // merged: is the pull request's own date, and a merged pull request is closed on it
  assert.deepEqual(ghSearch("search_pull_requests", "merged:>=2026-08-30"), f.merged_pr_numbers.map(Number))
  assert.deepEqual(ghSearch("search_pull_requests", "is:merged merged:2026-09-01"), [9])
  assert.deepEqual(ghSearch("search_pull_requests", "merged:<2026-08-30"), [])
  assert.deepEqual(ghSearch("search_pull_requests", "is:open merged:>=2026-01-01"), [])
  assert.deepEqual(ghSearch("search_pull_requests", "closed:2026-09-01"), [9])
  assert.deepEqual(ghSearch("search_issues", "created:2026-09-02T09:14:00Z"), [1], "an instant")
  assert.notDeepEqual(ghSearch("search_issues", "created:2026-09-03..2026-09-10"), ghSearch("search_issues", "created:2026-09-01..2026-09-10"), "a window is the query's, not a fixed list")
  // pull requests
  assert.deepEqual(ghSearch("search_pull_requests", "is:open updated:2026-09-16"), f.updated_sept_16_pr_numbers.map(Number))
  assert.deepEqual(ghSearch("search_pull_requests", "is:merged"), [9])
  assert.deepEqual(ghSearch("search_pull_requests", "is:draft"), [8])
  assert.deepEqual(ghSearch("search_pull_requests", "is:open author:ada-lantern"), [7])
  assert.deepEqual(ghSearch("search_issues", "is:pr"), [], "search_issues is issues only")
  // the only repository, organisation and user are the fixture's
  assert.deepEqual(ghSearch("search_issues", "repo:someone/else"), [])
  assert.deepEqual(ghSearch("search_issues", "org:fabrikam-labs is:open").length, 4)
  assert.deepEqual(ghSearch("search_issues", "org:other-org"), [])
  // what it cannot read it says
  for (const bad of ["foo:bar", "created:lastweek", "is:weird", "no:milestone", "updated:>=banana"]) assert.match(ghSearch("search_issues", bad), /^ERR Invalid search/, bad)
})
