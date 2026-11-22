import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { finalizeOwnedTrial } from "../src/run/owned-postmortem.mjs"
const sha = bytes => createHash("sha256").update(bytes).digest("hex")
const binding = { invocation_id: "11111111-1111-4111-8111-111111111111", manifest_sha256: "a".repeat(64), trial_id: "trial-a" }
function data() {
  const raw = Buffer.from('{"type":"step_finish","part":{"cost":0.03,"tokens":{"input":2,"output":3,"cache":{"read":0,"write":0}}}}\n')
  const proof = { binding, config: { verified: true, id: "1".repeat(64), launch_sha256: "e".repeat(64), ...binding }, cleanup_verified: true, host_clients_closed: true, worker_exit: 0 }
  const receipt = { schema: "oc-owned-provisional/1", binding, container_id: "1".repeat(64), launch_sha256: "e".repeat(64), complete: false, overflow: false, exit: 0, evidence: [{ path: "raw.jsonl", bytes: raw.length, sha256: sha(raw) }], native: "succeeded", observer: "succeeded" }
  let reads = 0
  const read = async path => { reads++; if (path === "provisional.json") return Buffer.from(JSON.stringify(receipt)); if (path === "raw.jsonl") return raw; throw new Error("unexpected read") }
  return { raw, proof, receipt, read, reads: () => reads }
}
test("postmortem refuses to read any workload output until external absence AND original client closure", async () => {
  for (const key of ["cleanup_verified", "host_clients_closed"]) {
    const f = data(); f.proof[key] = false
    const r = await finalizeOwnedTrial(f.proof, { read: f.read })
    assert.equal(r.evidence, "unknown"); assert.equal(f.reads(), 0)
  }
})
test("data-only finalization keeps exact raw digest, redacts output, accounts lower bounds, ignores unqualified successes", async () => {
  const f = data(), r = await finalizeOwnedTrial(f.proof, { read: f.read })
  assert.equal(r.evidence, "verified")
  assert.equal(r.raw_sha256, sha(f.raw))
  assert.equal(r.artifacts.raw, f.raw.toString())
  assert.equal(r.native, "unknown")
  assert.equal(r.observer, "unknown")
  assert.equal(r.accounting.known_billed_usd, 0.03)
  assert.equal(r.accounting.billed_usd, null)
  assert.equal(r.complete, false)
})
test("malformed, tampered, unbound, oversized and path-injected provisional data fail closed", async () => {
  for (const change of [r => r.binding.trial_id = "other", r => r.container_id = "2".repeat(64), r => r.evidence[0].sha256 = "0".repeat(64), r => r.evidence[0].bytes++, r => r.evidence[0].path = "../plugin.mjs", r => r.complete = true]) {
    const f = data(); f.receipt.binding = { ...binding }; change(f.receipt)
    const r = await finalizeOwnedTrial(f.proof, { read: f.read })
    assert.equal(r.evidence, "unknown")
    assert.equal(r.accounting.billed_usd, null)
  }
  for (const bytes of [Buffer.from("not json"), Buffer.alloc(65537)]) {
    const f = data(), r = await finalizeOwnedTrial(f.proof, { read: async () => bytes })
    assert.equal(r.evidence, "unknown")
  }
})

test("missing capture does not erase independently verified partial billing; known native failure survives cleanup unknown", async () => {
  const f = data(); f.receipt.capture = "batch/runs/core-a.t1/tmp/mem-fixture/capture.json"
  const r = await finalizeOwnedTrial(f.proof, { read: f.read })
  assert.equal(r.evidence, "unknown")
  assert.equal(r.accounting.known_billed_usd, 0.03)
  assert.equal(r.accounting.complete, false)
  f.proof.cleanup_verified = false
  const failed = await finalizeOwnedTrial(f.proof, { read: () => assert.fail("no reads"), nativeSnapshot: { binding, outcome: "failed" } })
  assert.equal(failed.native, "failed")
  assert.equal(failed.accounting.billed_usd, null)
})

test("parent redacts known credentials even when raw chunks contain a value", async () => {
  const f = data(), raw = Buffer.from('{"type":"text","part":{"text":"synthetic-private-value"}}\n')
  f.receipt.evidence = [{ path: "raw.jsonl", bytes: raw.length, sha256: sha(raw) }]
  const read = path => path === "raw.jsonl" ? raw : Buffer.from(JSON.stringify(f.receipt))
  const r = await finalizeOwnedTrial(f.proof, { read, secrets: ["synthetic-private-value"] })
  assert.equal(r.raw_sha256, sha(raw))
  assert.equal(r.artifacts.raw.includes("synthetic-private-value"), false)
})

test("parent accepts only bounded exit metadata without erasing independently verified cost", async () => {
  const secret = "synthetic-private-value"
  for (const exit of [secret, { diagnostic: secret }, [], -1, 256, 0.5, 1e100]) {
    const f = data(); f.receipt.exit = exit
    const r = await finalizeOwnedTrial(f.proof, { read: f.read, secrets: [secret], nativeSnapshot: { binding, outcome: "failed" } })
    assert.equal(r.evidence, "unknown")
    assert.equal(r.native, "failed")
    assert.equal(r.accounting.known_billed_usd, 0.03)
    assert.equal(r.accounting.complete, false)
    assert.equal(JSON.stringify(r).includes(secret), false)
  }
  for (const exit of [null, 0, 255]) {
    const f = data(); f.receipt.exit = exit
    const r = await finalizeOwnedTrial(f.proof, { read: f.read })
    assert.equal(r.evidence, "verified")
    assert.equal(r.artifacts.summary.exit, exit)
  }
})

test("summary exports only explicit typed parent identity fields and bounded bootstrap status", async () => {
  const secret = "synthetic-private-value", f = data()
  f.proof.binding = { ...binding, diagnostic: { secret } }
  let r = await finalizeOwnedTrial(f.proof, { read: f.read, secrets: [secret] })
  assert.equal(r.evidence, "verified")
  assert.equal(JSON.stringify(r).includes(secret), false)
  assert.equal(r.artifacts.summary.diagnostic, undefined)
  for (const change of [p => p.worker_exit = { secret }, p => p.worker_exit = -1, p => p.config.case_id = { secret }, p => p.config.case_id = "a".repeat(201)]) {
    const f = data(); change(f.proof)
    r = await finalizeOwnedTrial(f.proof, { read: f.read, secrets: [secret] })
    assert.equal(r.evidence, "unknown")
    assert.equal(r.accounting.known_billed_usd, 0.03)
    assert.equal(JSON.stringify(r).includes(secret), false)
  }
})

test("bound raw billing survives missing or damaged auxiliary files regardless of manifest order", async () => {
  for (const first of [true, false]) for (const missing of [true, false]) {
    const f = data(), extra = Buffer.from("stderr"), entry = { path: "process-1.stderr", bytes: extra.length, sha256: sha(extra) }
    if (first) f.receipt.evidence.unshift(entry); else f.receipt.evidence.push(entry)
    const read = path => path === entry.path ? missing ? Promise.reject(new Error("missing")) : Buffer.from("broken") : f.read(path)
    const r = await finalizeOwnedTrial(f.proof, { read, nativeSnapshot: { binding, outcome: "interrupted" } })
    assert.equal(r.evidence, "unknown")
    assert.equal(r.native, "interrupted")
    assert.equal(r.accounting.known_billed_usd, 0.03)
    assert.equal(r.accounting.receipts.length, 1)
    assert.equal(r.accounting.billed_usd, null)
    assert.equal(r.accounting.complete, false)
  }
})

test("unbound, duplicate or damaged raw evidence never supplies billing even with valid auxiliary data", async () => {
  for (const change of [f => f.receipt.binding = { ...binding, trial_id: "foreign" }, f => f.receipt.evidence.push({ ...f.receipt.evidence[0] }), f => f.receipt.evidence[0].sha256 = "0".repeat(64), f => f.receipt.evidence = []]) {
    const f = data(); change(f)
    const r = await finalizeOwnedTrial(f.proof, { read: f.read })
    assert.equal(r.evidence, "unknown")
    assert.equal(r.accounting.known_billed_usd, null)
    assert.deepEqual(r.accounting.receipts, [])
  }
})
