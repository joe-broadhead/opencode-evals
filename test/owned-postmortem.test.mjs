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
