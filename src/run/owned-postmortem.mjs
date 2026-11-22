// Fixed data-only readers. NEVER import a world, fixture, arm, or code named by output.
import { createHash } from "node:crypto"
import { singleAttemptCost } from "../cost/attempt.mjs"
import { redactor } from "./secrets.mjs"
const sha = bytes => createHash("sha256").update(bytes).digest("hex")
const sameBinding = (a,b) => ["invocation_id", "manifest_sha256", "trial_id"].every(k => typeof a?.[k] === "string" && a[k] === b?.[k])
const negative = native => ["failed", "interrupted"].includes(native) ? native : "unknown"
const exitCode = value => value === null || Number.isInteger(value) && value >= 0 && value <= 255
const identifier = value => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,199}$/.test(value)

export async function finalizeOwnedTrial(proof, { read, secrets = [], price = null, nativeSnapshot = null } = {}) {
  // nativeSnapshot is supplied by the parent verifier interface, NEVER taken from the provisional receipt.
  const result = { complete: false, native: sameBinding(nativeSnapshot?.binding, proof?.binding) ? negative(nativeSnapshot?.outcome) : "unknown", observer: "unknown", evidence: "unknown", accounting: { complete: false, ...singleAttemptCost() } }
  if (proof?.cleanup_verified !== true || proof.host_clients_closed !== true || proof.config?.verified !== true || !sameBinding(proof.config, proof.binding) || typeof read !== "function") return result
  try {
    const bytes = await read("provisional.json", 65536)
    if (!Buffer.isBuffer(bytes) || bytes.length > 65536) throw new Error("receipt size")
    const receipt = JSON.parse(bytes.toString("utf8"))
    if (receipt.schema !== "oc-owned-provisional/1" || receipt.complete !== false || typeof receipt.overflow !== "boolean" || !sameBinding(receipt.binding, proof.binding) || receipt.container_id !== proof.config.id || !/^[a-f0-9]{64}$/.test(receipt.launch_sha256 ?? "") || receipt.launch_sha256 !== proof.config.launch_sha256 || !Array.isArray(receipt.evidence) || receipt.evidence.length > 128) throw new Error("receipt binding")
    const entries = new Map()
    let total = 0
    for (const entry of receipt.evidence) {
      if (!/^(raw\.jsonl|process-[0-9]{1,3}\.(stdout|stderr))$/.test(entry.path ?? "") || entries.has(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 8 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) throw new Error("receipt file")
      total += entry.bytes
      if (total > 32 * 1024 * 1024) throw new Error("receipt total")
      entries.set(entry.path, entry)
    }
    const verifiedRead = async entry => {
      if (!entry) throw new Error("missing raw")
      const data = await read(entry.path, entry.bytes)
      if (!Buffer.isBuffer(data) || data.length !== entry.bytes || sha(data) !== entry.sha256) throw new Error("receipt digest")
      return data
    }
    const raw = await verifiedRead(entries.get("raw.jsonl"))
    // Verify raw first regardless of manifest order. Auxiliary failures cannot erase its lower bound.
    result.accounting = { complete: false, ...singleAttemptCost(raw.toString("utf8"), price) }
    result.raw_sha256 = sha(raw)
    if (receipt.overflow || receipt.streams_closed !== undefined && receipt.streams_closed !== true) throw new Error("incomplete spool")
    for (const entry of entries.values()) if (entry.path !== "raw.jsonl") await verifiedRead(entry)
    const bootstrapExit = proof.worker_exit === undefined ? null : proof.worker_exit
    const caseID = proof.config.case_id === undefined ? null : proof.config.case_id
    // Writable receipt metadata has no producer authenticity. Validate here, after independent cost recovery.
    if (!exitCode(receipt.exit) || !exitCode(bootstrapExit) || caseID !== null && !identifier(caseID)) throw new Error("summary metadata")
    if (!/^[a-f0-9-]{36}$/.test(proof.binding.invocation_id) || !/^[a-f0-9]{64}$/.test(proof.binding.manifest_sha256) || !identifier(proof.binding.trial_id)) throw new Error("summary identity")
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
    artifacts.summary = { invocation_id: redact(proof.binding.invocation_id), manifest_sha256: redact(proof.binding.manifest_sha256), trial_id: redact(proof.binding.trial_id), case: caseID === null ? null : redact(caseID), exit: receipt.exit, bootstrap_exit: bootstrapExit, complete: false, native: result.native, observer: "unknown", cleanup_verified: true, accounting_complete: false }
    return { ...result, evidence: "verified", provisional_sha256: sha(bytes), artifacts, worker_exit: bootstrapExit }
  } catch { return result }
}
