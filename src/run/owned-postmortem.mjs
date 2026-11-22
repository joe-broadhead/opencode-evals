// Fixed data-only readers. NEVER import a world, fixture, arm, or code named by output.
import { createHash } from "node:crypto"
import { singleAttemptCost } from "../cost/attempt.mjs"
import { redactor } from "./secrets.mjs"
const sha = bytes => createHash("sha256").update(bytes).digest("hex")
const sameBinding = (a,b) => ["invocation_id", "manifest_sha256", "trial_id"].every(k => typeof a?.[k] === "string" && a[k] === b?.[k])
const negative = native => ["failed", "interrupted"].includes(native) ? native : "unknown"

export async function finalizeOwnedTrial(proof, { read, secrets = [], price = null, nativeSnapshot = null } = {}) {
  // nativeSnapshot is supplied by the parent verifier interface, NEVER taken from the provisional receipt.
  const result = { complete: false, native: sameBinding(nativeSnapshot?.binding, proof?.binding) ? negative(nativeSnapshot?.outcome) : "unknown", observer: "unknown", evidence: "unknown", accounting: { complete: false, ...singleAttemptCost() } }
  if (proof?.cleanup_verified !== true || proof.host_clients_closed !== true || proof.config?.verified !== true || !sameBinding(proof.config, proof.binding) || typeof read !== "function") return result
  try {
    const bytes = await read("provisional.json", 65536)
    if (!Buffer.isBuffer(bytes) || bytes.length > 65536) throw new Error("receipt size")
    const receipt = JSON.parse(bytes.toString("utf8"))
    if (receipt.schema !== "oc-owned-provisional/1" || receipt.complete !== false || receipt.overflow !== false || !sameBinding(receipt.binding, proof.binding) || receipt.container_id !== proof.config.id || !/^[a-f0-9]{64}$/.test(receipt.launch_sha256 ?? "") || receipt.launch_sha256 !== proof.config.launch_sha256 || !Array.isArray(receipt.evidence) || receipt.evidence.length > 128) throw new Error("receipt binding")
    const names = new Set(), files = new Map()
    let total = 0
    for (const entry of receipt.evidence) {
      if (!/^(raw\.jsonl|process-[0-9]{1,3}\.(stdout|stderr))$/.test(entry.path ?? "") || names.has(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 8 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) throw new Error("receipt file")
      total += entry.bytes
      if (total > 32 * 1024 * 1024) throw new Error("receipt total")
      names.add(entry.path)
      const data = await read(entry.path, entry.bytes)
      if (!Buffer.isBuffer(data) || data.length !== entry.bytes || sha(data) !== entry.sha256) throw new Error("receipt digest")
      files.set(entry.path, data)
    }
    const raw = files.get("raw.jsonl")
    if (!raw) throw new Error("missing raw")
    // Raw usage and capture completeness are independent. A missing capture must not erase paid steps.
    result.accounting = { complete: false, ...singleAttemptCost(raw.toString("utf8"), price) }
    result.raw_sha256 = sha(raw)
    const redact = redactor(secrets)
    const artifacts = { raw: redact(raw.toString("utf8")) }
    // Optional fixture capture is a fixed JSON reader, not the world's finalization hook.
    if (receipt.capture !== undefined) {
      if (!/^batch\/runs\/[a-z0-9-]+\.t1\/tmp\/mem-fixture\/capture\.json$/.test(receipt.capture)) throw new Error("capture path")
      const data = await read(receipt.capture, 65536)
      if (data.length > 65536) throw new Error("capture size")
      const capture = JSON.parse(data.toString("utf8"))
      if (capture.schema !== "oc-mem-capture/1" || capture.fixture !== "mem-synthetic-v1") throw new Error("capture schema")
      if ((capture.core ?? capture.discovery)?.case_id !== proof.config.case_id) throw new Error("capture binding")
      artifacts.capture = redact(JSON.stringify(capture))
    }
    artifacts.summary = { ...proof.binding, case: proof.config.case_id, exit: receipt.exit, bootstrap_exit: proof.worker_exit, complete: false, native: result.native, observer: "unknown", cleanup_verified: true, accounting_complete: false }
    return { ...result, evidence: "verified", provisional_sha256: sha(bytes), artifacts, worker_exit: proof.worker_exit }
  } catch { return result }
}
