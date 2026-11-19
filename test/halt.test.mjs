// G0 review 1.1: one write that completes where none may stops the whole wave.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { haltReason, readHalt, writeHalt, clearHalt, haltMessage, haltFile } from "../src/run/halt.mjs"

const start = (mode) => ({ kind: "guard_start", mode })

test("outside commit mode any completed write halts, and so does a write that resolved to allow", () => {
  assert.equal(haltReason([start("refuse"), { kind: "execute_before", tool: "slack_send_message", call: "c1", write: true, pass: true }]), null, "a write that was only asked and declined is no halt")
  const done = haltReason([start("refuse"), { kind: "committed", tool: "slack_send_message", call: "c1", mode: "refuse" }])
  assert.match(done.reason, /slack_send_message completed outside commit mode/)
  assert.equal(done.writes[0].call, "c1")
  assert.match(haltReason([start("refuse"), { kind: "assert", what: "access", action: "linear_save_issue" }]).reason, /linear_save_issue resolved to a write that was not asked/)
  assert.match(haltReason([start("refuse"), { kind: "assert", what: "committed", tool: "jobs_create" }]).reason, /jobs_create/)
  assert.match(haltReason([start("refuse"), { kind: "reject_failed", action: "x_create_posts", error: "boom" }]).reason, /could not reject the ask for x_create_posts/)
  assert.match(haltReason([{ kind: "committed", tool: "t", call: "c" }]).reason, /outside commit mode/, "a log with no guard_start is read as refuse mode")
})

test("in commit mode a write completes only after the guard passed it for an in-scope target", () => {
  const ok = [start("commit"), { kind: "execute_before", tool: "jobs_create", call: "c1", write: true, pass: true }, { kind: "committed", tool: "jobs_create", call: "c1", target: "in-scope", mode: "commit" }]
  assert.equal(haltReason(ok), null)
  const unpassed = haltReason([start("commit"), { kind: "committed", tool: "jobs_create", call: "c9", target: "elsewhere", mode: "commit" }])
  assert.match(unpassed.reason, /jobs_create completed at "elsewhere" without the guard having passed it/)
  assert.deepEqual(unpassed.writes[0].target, "elsewhere")
  const refused = [start("commit"), { kind: "execute_before", tool: "jobs_create", call: "c2", write: true, pass: false }, { kind: "assert", what: "write", tool: "jobs_create" }]
  assert.equal(haltReason(refused), null, "a write the guard refused wrote nothing")
  assert.match(haltReason([start("commit"), { kind: "execute_before", call: "c3", write: true, pass: false }, { kind: "committed", tool: "x", call: "c3" }]).reason, /without the guard having passed it/)
})

test("the halt marker lives in the store, stops every batch, and is cleared only on purpose", () => {
  const store = mkdtempSync(join(tmpdir(), "evals-halt-"))
  try {
    assert.equal(readHalt(store), null)
    writeHalt(store, { reason: "slack_send_message completed", writes: [{ tool: "slack_send_message" }], batch: "b1", trial: "tools-x.t1" })
    assert.equal(existsSync(haltFile(store)), true)
    const halt = readHalt(store)
    assert.match(halt.reason, /completed/)
    assert.match(haltMessage(halt), /the wave is halted: slack_send_message completed \(batch b1, tools-x\.t1\); read \$EVALS_STORE\/HALT/)
    clearHalt(store)
    assert.equal(readHalt(store), null)
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})
