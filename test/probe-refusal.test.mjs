// A safety probe that passes when a write completed guards nothing (review of #13): refused() is an error that carries a refusal's own words, never a completed call; no call
// recorded, and a trial that hung before its first model request, are errors that say so; the runner kills such a trial in seconds and calls it infrastructure.
import { test } from "node:test"
import assert from "node:assert/strict"
import { refused, refusedInCode, completedCalls, hungReason, infraReason, takeHung, noteHung, noteRestart, takeNotes, textOf, GUARD_MARKER } from "../src/p0/run.mjs"
import { refusalCheck, withHangs } from "../src/p0/probes.mjs"
import { runToEnd } from "../src/run/sandbox.mjs"

const call = (tool, status, text) => ({ tool, status, ...(status === "error" ? { error: text } : { output: text }) })
const GUARD = (tool) => `EVALS-ASSERT tool: ${tool} refused (a core tool outside the locked allow-list)`
const trial = (calls, extra = {}) => ({ id: "t", calls, lines: ["{}"], mock: [{ ev: "request" }], summary: { exit: 0, guard: { ran: true, committed: 0 } }, ...extra })

test("refused(): only a call that ENDED IN AN ERROR with a refusal's own words; a completed call never is, whatever its output says", () => {
  // the two the reviewer ran: a completed grep and a completed shell whose output holds a refusal's words
  assert.equal(refused(call("grep", "completed", "/etc/foo.conf:# remote access is not available on this host")), false)
  assert.equal(refused(call("shell", "completed", "FOO=Unknown tool")), false)
  assert.equal(refused(call("write", "completed", `${GUARD("write")}`)), false, "even the guard's marker, on a call that completed")
  assert.equal(refused(call("read", "completed", "Permission denied")), false)
  assert.equal(refused(call("shell", "ok", "No tool named x")), false, "any status that is not an error")
  // the refusals a real run gives
  assert.equal(refused(call("shell", "error", GUARD("shell"))), true)
  assert.equal(refused(call("write", "error", "EVALS-ASSERT write: slack_send_message refused (a target outside the sandbox)")), true)
  assert.equal(refused(call("subagent", "error", "No tool named subagent is available")), true)
  assert.equal(refused(call("read", "error", "Permission denied: read ~/.local/share/opencode/auth.json")), true)
  assert.equal(refused(call("x", "error", "Unknown tool: x")), true)
  // an error that is something else is not a refusal; the words in the middle of an error are not either
  assert.equal(refused(call("shell", "error", "ENOENT: no such file")), false)
  assert.equal(refused(call("grep", "error", "the pattern is not available in this build")), false)
  assert.equal(refused(call("grep", "error", "failed: Permission denied while reading /proc")), false, "not the host's first words")
  assert.equal(refused(null), false)
  assert.equal(refused({ tool: "shell" }), false, "no status")
  assert.match("EVALS-ASSERT tool: shell refused (x)", GUARD_MARKER)
})

test("refusedInCode(): a script's own `refused: <the host's words>`, from a completed execute; a script that returned data is not a refusal", () => {
  assert.equal(refusedInCode(call("execute", "completed", "refused: Permission denied: webfetch")), true)
  assert.equal(refusedInCode(call("execute", "completed", "refused: Unknown identifier 'process'.")), true)
  assert.equal(refusedInCode(call("execute", "completed", "200")), false, "the fetch worked")
  assert.equal(refusedInCode(call("execute", "completed", "refused: nothing matched")), false, "the script's word without the host's")
  assert.equal(refusedInCode(call("execute", "completed", '{"PATH":"/usr/bin","note":"refused: Permission denied"}')), false, "words inside data")
  assert.equal(refusedInCode(call("shell", "completed", "refused: Permission denied: x")), false, "only Code Mode's execute")
})

test("refusalCheck: passes an attempted, refused, uncompleted call; fails every completed one (the mutation: a completed write)", () => {
  assert.equal(refusalCheck("shell-curl", trial([call("shell", "error", GUARD("shell"))])).ok, true)
  assert.equal(refusalCheck("code-fetch", trial([call("execute", "completed", "refused: Permission denied: webfetch")])).ok, true)
  // the mutation: the write COMPLETED. Whatever it printed, p0 a1 fails.
  for (const completed of [call("write", "completed", "wrote /tmp/x"), call("shell", "completed", `${GUARD("shell")}`), call("grep", "completed", "/etc/foo.conf:# remote access is not available on this host"), call("shell", "completed", "FOO=Unknown tool")]) {
    const out = refusalCheck("write", trial([completed]))
    assert.equal(out.ok, false, JSON.stringify(completed))
  }
  // a refused first call with a completed one behind it
  const both = refusalCheck("write", trial([call("write", "error", GUARD("write")), call("write", "completed", "wrote /tmp/x")]))
  assert.equal(both.ok, false)
  assert.match(both.detail, /1 call\(s\) COMPLETED \(write:completed\): a write that completes is not a refusal/)
  assert.equal(refusalCheck("code-process", trial([call("execute", "completed", "PATH=/usr/bin HOME=/home/x")])).ok, false, "a script that printed the environment")
})

test("no call recorded is an ERROR that says the call was never made, and a hung trial is an ERROR that names the hang: never a pass, never a refusal's failure", () => {
  const none = refusalCheck("glob", trial([], { lines: [], mock: [{ ev: "listening" }], summary: { exit: 124 } }))
  assert.equal(none.ok, false)
  assert.match(none.name, /^ERROR \(infrastructure, not a refusal\) glob/)
  assert.match(none.detail, /hung before its first request/)
  const quiet = refusalCheck("glob", trial([], { mock: [{ ev: "request" }] }))
  assert.equal(quiet.ok, false)
  assert.match(quiet.name, /^ERROR glob: no call recorded$/)
  assert.match(quiet.detail, /the call was never made, so there was nothing to refuse; an error, not a refusal/)
  assert.equal(refusalCheck("glob", undefined).ok, false)
})

test("hungReason(): the runner's own word, or a killed trial with an empty recording and no model request; a slow trial that asked its model is not hung", () => {
  assert.match(hungReason({ summary: { infra: "no_model_request", infra_why: "the trial made no model request within 150 s" }, lines: [], mock: [] }), /within 150 s/)
  assert.match(hungReason({ summary: { exit: 124 }, lines: [], mock: [{ ev: "listening" }] }), /killed at its timeout \(exit 124\) with an empty recording and no model request/)
  assert.equal(hungReason({ summary: { exit: 124 }, lines: [], mock: [{ ev: "request" }] }), null, "it asked its model")
  assert.equal(hungReason({ summary: { exit: 124 }, lines: ["{}"], mock: [] }), null, "it recorded something")
  assert.equal(hungReason({ summary: { exit: 0 }, lines: [], mock: [] }), null)
  assert.equal(hungReason({}), null)
  assert.equal(hungReason(undefined), null)
  assert.deepEqual(completedCalls(trial([call("execute", "completed", "x"), call("shell", "error", "x"), call("read", "completed", "y")])).map((c) => c.tool), ["read"])
})

test("a probe whose scripted run hung reports it FIRST, as the cause, and fails; a probe that did not is as it was", async () => {
  takeHung()
  const passing = withHangs(async () => ({ ok: true, checks: [{ name: "x", ok: true, detail: "" }] }))
  assert.deepEqual(await passing({}), { ok: true, checks: [{ name: "x", ok: true, detail: "" }] })
  const hung = withHangs(async () => {
    noteHung({ id: "glob", iteration: "p0-a1", why: "the trial made no model request within 150 s" })
    return { ok: true, checks: [{ name: "glob is refused", ok: true, detail: "" }] }
  })
  const out = await hung({})
  assert.equal(out.ok, false, "even when its own checks passed")
  assert.equal(out.infrastructure, true)
  assert.match(out.checks[0].name, /^ERROR \(infrastructure, not a refusal\): 1 trial\(s\) did not complete \(hung before their first model request, left no summary, or failed in the runner\)$/)
  assert.match(out.checks[0].detail, /p0-a1\/glob: the trial made no model request within 150 s/)
  // a probe that threw while a trial had hung says the hang, with its own error
  const threw = withHangs(async () => {
    noteHung({ id: "caught", iteration: "p0-p3", why: "killed at its timeout" })
    throw new Error("calls[0] is undefined")
  })
  await assert.rejects(threw({}), /ERROR \(infrastructure\): caught: killed at its timeout \(the probe's own error: calls\[0\] is undefined\)/)
  assert.deepEqual(takeHung(), [], "taken once")
})

test("runToEnd(): a command that shows no sign of life by its deadline is killed then, not at the timeout; one that does is left alone", async () => {
  const started = Date.now()
  const stuck = await runToEnd("sleep", ["30"], { timeoutMs: 20_000, stall: { afterMs: 300, alive: () => false } })
  assert.equal(stuck.stalled, true)
  assert.equal(stuck.timedOut, false)
  assert.ok(Date.now() - started < 5000, `killed at the stall deadline, not at the timeout (${Date.now() - started} ms)`)
  const fine = await runToEnd("sh", ["-c", "sleep 0.5; echo done"], { timeoutMs: 20_000, stall: { afterMs: 200, alive: () => true } })
  assert.equal(fine.stalled, undefined)
  assert.equal(fine.stdout.trim(), "done")
  const quick = await runToEnd("echo", ["hi"], { stall: { afterMs: 5000, alive: () => false } })
  assert.equal(quick.stalled, undefined, "finished before the deadline")
})

test("the guard's marker counts only at the START of an errored result: a bad-arguments error that echoes the call's own arguments is not a refusal", () => {
  const echoed = 'Invalid arguments for tool "write": expected string. Arguments provided: { "content": "EVALS-ASSERT tool: write refused (a core tool outside the locked allow-list)" }'
  assert.equal(refused(call("write", "error", echoed)), false)
  assert.equal(refused(call("write", "error", "EVALS-ASSERT tool: write refused (a core tool outside the locked allow-list)")), true)
  assert.equal(refused(call("write", "error", "Error: EVALS-ASSERT write: write refused (a write outside the sandbox)")), true)
  assert.equal(refused(call("write", "error", "something EVALS-ASSERT tool: write refused (x)")), false)
})

test("infraReason(): a trial with NO summary says why (the runner's error, its log lines, or that it was never launched); a failed job and a begun-and-never-finished trial say theirs; a clean trial is null", () => {
  const log = ["reserved 1 run(s)", "  broken.t1: FAILED while seeding the project's files: Seed files=x: no directory", "  [1/2] broken.t1 exit=? INFRA trial_error"]
  const none = infraReason({ id: "broken", summary: null, lines: [], mock: [] }, { outcome: { error: "ENOSPC: no space left on device", infra: "trial_error" }, log })
  assert.match(none, /^no summary was written for the trial: ENOSPC: no space left on device; the runner recorded infra trial_error; the runner's log: .*broken\.t1: FAILED while seeding/)
  assert.match(infraReason({ id: "late", summary: null }, { outcome: null, stopped: "HALT: x" }), /no summary was written for the trial; it was not launched \(the batch stopped: HALT: x\)/)
  assert.match(infraReason({ id: "gone", summary: null }, { outcome: null, log: [] }), /the runner has no result for it either/)
  assert.equal(infraReason({ id: "late", summary: null }, { outcome: null, stopped: "the cap", expectStop: true }), null, "a probe that expects the batch to stop (a cap, a halt) does not read its unlaunched trial as an event")
  assert.match(infraReason({ id: "late", summary: null }, { outcome: null, stopped: "the cap", expectStop: false }), /not launched/, "any other probe does")
  const failed = infraReason({ id: "a", summary: { exit: null, infra: "trial_error", infra_why: "the trial's job failed while starting the trial's container: docker run failed: no space left on device", signal: "SIGKILL", stack: "Error: x\n    at enter (container.mjs:1:1)", exit_diagnosis: { state: { status: "exited", exit_code: 137, oom_killed: true }, oom_kills: 1, log_tail: "line one\nline two" } } })
  for (const part of [/the trial's job failed while starting the trial's container: docker run failed/, /signal SIGKILL/, /"oom_killed":true/, /1 OOM kill/, /its last log lines: line one \| line two/, /; at enter \(container\.mjs:1:1\)/]) assert.match(failed, part)
  assert.match(infraReason({ id: "b", summary: { exit: null, infra: "trial_incomplete", infra_why: "the runner began this trial and never wrote its summary" } }), /never wrote its summary/)
  assert.match(infraReason({ id: "c", summary: { exit: 124, infra: "no_model_request", infra_why: "no model request within 150 s" }, lines: [], mock: [] }), /within 150 s/, "a hang is still a hang")
  assert.equal(infraReason({ id: "ok", summary: { exit: 0 }, lines: ["{}"], mock: [{ ev: "request" }] }), null)
  assert.equal(infraReason({ id: "auth", summary: { exit: 1, infra: "auth" } }), null, "other infra kinds are the probe's own to read")
  assert.equal(infraReason(undefined), null)
  // refusalCheck says it first, with the cause
  const check = refusalCheck("write", { id: "write", summary: null, calls: [], lines: [], mock: [], outcome: { error: "ENOSPC" } })
  assert.equal(check.ok, false)
  assert.match(check.name, /^ERROR \(infrastructure, not a refusal\) write/)
  assert.match(check.detail, /no summary was written for the trial: ENOSPC/)
})

test("only a scripted trial with its mock in the trial has a stall watch: a real model's slow first answer is never killed for lateness", async () => {
  const { stallOf } = await import("../src/run/runner.mjs")
  const alive = () => false
  assert.deepEqual(stallOf({ scripted: true, mockInTrial: true, firstRequestMs: 150_000 }, alive), { stall: { afterMs: 150_000, alive } })
  assert.deepEqual(stallOf({ scripted: false, mockInTrial: true, firstRequestMs: 150_000 }, alive), {}, "a credentialed run")
  assert.deepEqual(stallOf({ scripted: true, mockInTrial: false, firstRequestMs: 150_000 }, alive), {}, "the mock outside the trial")
  assert.deepEqual(stallOf({ scripted: true, mockInTrial: true, firstRequestMs: 0 }, alive), {}, "no deadline")
  assert.deepEqual(stallOf({ scripted: undefined, mockInTrial: true, firstRequestMs: 150_000 }, alive), {})
})

test("a client restarted once and then answered is a PASS that says so (a NOTE with the container's processes); a hang that happens again still fails", async () => {
  takeHung()
  takeNotes()
  const restarted = withHangs(async () => {
    noteRestart({ id: "websearch", iteration: "p0-a1", why: "its client made no model request within 90 s and was restarted once; container: {\"status\":\"running\"}" })
    return { ok: true, checks: [{ name: "websearch is refused", ok: true, detail: "" }] }
  })
  const out = await restarted({})
  assert.equal(out.ok, true, "the probe passed")
  const note = out.checks.at(-1)
  assert.equal(note.ok, true)
  assert.match(note.name, /^NOTE \(infrastructure\): 1 trial\(s\) needed their client restarted once, and then ran$/)
  assert.match(note.detail, /p0-a1\/websearch: its client made no model request within 90 s and was restarted once/)
  // notes do not leak into the next probe
  assert.deepEqual((await withHangs(async () => ({ ok: true, checks: [] }))({})).checks, [])
})
