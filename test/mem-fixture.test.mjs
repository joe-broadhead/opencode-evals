import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openFixture } from "../worlds/mem/fixture.mjs"

test("synthetic gateway persists a raw document across reopen, independent of its receipt", () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-fixture-"))
  try {
    const fixture = openFixture(dir)
    const result = fixture.call("wiki.raw.write", { wiki_id: "wiki-eval-personal", filename: "design.md", content: "Synthetic design." })
    assert.equal(result.status, "stored")
    const restarted = openFixture(dir)
    assert.equal(restarted.call("wiki.raw.read", { wiki_id: "wiki-eval-personal", filename: "design.md" }).content, "Synthetic design.")
    const capture = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8"))
    assert.equal(capture.after.personal.raw["design.md"], "Synthetic design.")
    assert.equal(capture.after.shared.raw["design.md"], undefined)
    assert.equal(capture.before.personal.raw["design.md"], undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("only reserved aliases route; unsupported operations and traversal leave state unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-fixture-"))
  try {
    const fixture = openFixture(dir)
    const before = fixture.snapshot().after
    for (const [method, input] of [
      ["wiki.raw.write", { wiki_id: "production", filename: "design.md", content: "x" }],
      ["wiki.raw.write", { wiki_id: "wiki-eval-personal", filename: "../design.md", content: "x" }],
      ["wiki.versions", { wiki_id: "wiki-eval-personal" }],
      ["sources.bind", { source: "mail" }],
    ]) assert.throws(() => fixture.call(method, input), /reserved|flat|unsupported/)
    assert.deepEqual(fixture.snapshot().after, before)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("record writes use typed input, pagination is explicit, reads come from durable records", () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-fixture-"))
  try {
    const fixture = openFixture(dir)
    assert.throws(() => fixture.call("records.put", { record: { kind: "page", body: "x" }, extra: true }), /unsupported/)
    const a = fixture.call("records.put", { record: { kind: "memory", type: "fact", body: "The synthetic marker is QUARTZ-92." } })
    fixture.call("records.put", { record: { kind: "page", path: "projects/quartz", body: "Synthetic project." } })
    const page1 = fixture.call("records.list", { limit: 1 })
    assert.equal(page1.records.length, 1)
    assert.equal(page1.more, true)
    assert.equal(fixture.call("records.list", { limit: 1, cursor: page1.cursor }).more, false)
    assert.equal(openFixture(dir).call("records.get", { id: a.record.id }).records[0].body, "The synthetic marker is QUARTZ-92.")
    assert.throws(() => fixture.call("records.list", { limit: 2, cursor: page1.cursor }), /cursor/)
    assert.throws(() => fixture.call("records.put", { record: { kind: "page", path: "../escape", body: "x" } }), /path/)
    const changed = fixture.call("records.revise", { id: a.record.id, action: "retire" })
    assert.equal(changed.record.status, "retired")
    assert.equal(fixture.call("records.revise", { id: a.record.id, action: "restore" }).record.status, "current")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
