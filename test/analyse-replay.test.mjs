// The analyser's own replay test, ported from review/tools/test-run-evals-counts.mjs and kept as the
// regression suite for the one bug that made every earlier count wrong. When the review tree is present
// it replays the real nm4 recording; when it is not, the synthetic shapes still cover the same code.
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { innerCounts, summarize, askedTools, sameTool } from "../src/trace/analyse.mjs"

const runDir = join(homedir(), "opencode-release/review/evalruns/nm4/metaview-live")
const hasRun = existsSync(join(runDir, "job-post-rewrite-asks-first.jsonl"))

const replay = (name) => {
  const base = join(runDir, name)
  const lines = readFileSync(`${base}.jsonl`, "utf8").split("\n").filter(Boolean)
  const summary = existsSync(`${base}.summary.json`) ? JSON.parse(readFileSync(`${base}.summary.json`, "utf8")) : {}
  return summarize(lines, summary.stderr ?? "")
}

test("nm4 replay: the run that exposed the bug reports 6 outer and 6 inner calls", { skip: !hasRun && "review tree not present" }, () => {
  const s = replay("job-post-rewrite-asks-first")
  assert.equal(s.toolCalls, 6)
  assert.equal(s.failedCalls, 0, "the outer status says no failure")
  assert.equal(s.inner.calls, 6)
  assert.equal(s.inner.declined, 1)
  assert.equal(s.inner.errored, 1)
  assert.equal(s.inner.failures, 2, "one decline and one 504, which the outer status hid")
  const declined = s.inner.detail.filter((d) => d.kind === "declined")
  const errored = s.inner.detail.filter((d) => d.kind === "errored")
  assert.deepEqual(declined.map((d) => String(d.tool).split(".").pop()), ["send_job_post_message"])
  assert.deepEqual(errored.map((d) => [d.tool, d.status]), [["list_job_posts", "504"]])
})

test("an MCP error carried as a JSON value is an inner failure", () => {
  const wrapped = innerCounts(
    "await tools.metaview.list_job_posts({})",
    JSON.stringify({ error: 'MCP tool "list_job_posts" on server "metaview" failed: Error POSTing to endpoint: {} (HTTP 503)' }),
  )
  assert.equal(wrapped.errored, 1)
  assert.equal(wrapped.detail[0].tool, "list_job_posts")
  assert.equal(wrapped.detail[0].status, "503")
})

test("a thrown Code Mode error is an inner failure, a decline is not", () => {
  const thrown = innerCounts("return 1n", "ReferenceError: Unknown identifier 'BigInt'. (line 2, col 66)")
  assert.equal(thrown.errored, 1)
  assert.equal(thrown.declined, 0)
  assert.equal(thrown.detail[0].tool, "execute")
})

test("prose that merely talks about errors is not a failure", () => {
  const prose = innerCounts(
    "return await tools.metaview.get_job_post({})",
    JSON.stringify({ items: [{ description: "After a failed follow-up, inspect the post. Per-candidate failures come back as an error entry, not a tool error." }] }),
  )
  assert.equal(prose.declined, 0)
  assert.equal(prose.errored, 0)
})

test("a decline visible only in stderr is still a decline, and names the tool", () => {
  const stderrOnly = summarize(
    [JSON.stringify({ type: "tool_use", part: { tool: "execute", state: { status: "completed", input: { code: "return await tools.metaview.send_job_post_message({})" }, output: JSON.stringify({ ok: false }) } } })],
    "\u001b[93m\u001b[1m! \u001b[0mpermission requested: metaview_send_job_post_message (*); auto-rejecting\n",
  )
  assert.equal(stderrOnly.inner.declined, 1)
  assert.equal(stderrOnly.inner.detail[0].tool, "metaview_send_job_post_message")
  assert.equal(askedTools("permission requested: a_b (*); auto-rejecting\npermission requested: c_d (*); auto-rejecting").length, 2)
  assert.ok(sameTool("metaview.send_job_post_message", "metaview_send_job_post_message"))
  assert.ok(!sameTool("search_posts_all", "search_users"))
})
