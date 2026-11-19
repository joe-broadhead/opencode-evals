// Fake mode (`accounts: fake`, GitHub and Jira): the catalogs, the fixtures, the `@fixture` clause, the override and the fake MCP server over HTTP.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawn, spawnSync } from "node:child_process"
import { parseSignature } from "../src/fake/ts-signature.mjs"
import { OWN_TOOLS, catalogProblems, githubCatalog } from "../scripts/mcp-catalog.mjs"
import { readCatalog, mcpOverride, installFake, fakeFor, REAL_HOSTS } from "../src/run/fake-mode.mjs"
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
  // a pack tool with no snapshot is derived, and says so
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

test("the MCP override names the plugin's own server and points at the fake on loopback; the sealed config carries it", () => {
  const override = mcpOverride({ github: 4101, jira: 4102 })
  assert.deepEqual(override, { github: { type: "remote", url: "http://127.0.0.1:4101/mcp" }, jira: { type: "remote", url: "http://127.0.0.1:4102/mcp" } })
  assert.deepEqual(sealedConfig({ armDir: null, model: "mock/m1", mcp: override }).mcp, override)
  assert.equal(sealedConfig({ armDir: null, model: "mock/m1" }).mcp, undefined)
  assert.deepEqual(fakeFor(["github", "slack", "jira"], new Set(["github", "jira"])), ["github", "jira"])
  for (const hosts of Object.values(REAL_HOSTS)) assert.ok(hosts.length >= 3)
})

test("installFake copies the server, the fixtures and the catalogs of the plugins asked for, and nothing else", () => {
  const dir = scratch()
  try {
    const out = installFake(dir, ["github"])
    for (const f of ["mcp-server.ts", "github.catalog.json", "fixtures/github.mjs"]) assert.ok(existsSync(join(out, f)), f)
    assert.equal(existsSync(join(out, "jira.catalog.json")), false)
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
    assert.equal((await fetch(`http://127.0.0.1:${port}/elsewhere`)).status, 404)
    const entries = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l))
    assert.deepEqual(entries.filter((e) => e.ev === "tools/call").map((e) => e.tool), ["list_issues", "add_issue_comment", "no_such_tool"])
    assert.equal(entries.find((e) => e.tool === "no_such_tool").unknown, true)
  } finally {
    proc.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})
