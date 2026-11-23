// Dispatch-time native qualification binding for the wave's owned path.
// execution_qualified is never a self-set, manifest or environment boolean: this module
// validates the owner-supplied pinned record against the LIVE profile and constructs the
// reviewed Darwin identity reader only on an exact match. Any mismatch or missing record
// refuses native dispatch with zero native construction; there is no fallback, no partial
// match and no override. Each call binds exactly one run and shares no state across runs.
import { spawnSync } from "node:child_process"
import { readFileSync, lstatSync, realpathSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, isAbsolute, resolve } from "node:path"
import { sha256, validateNativeQualificationRecord } from "./wave-manifest.mjs"
import { createDarwinIdentityReader } from "./darwin-process-identity.mjs"

const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)

/** Live macOS profile facts: bounded read-only local queries. No network, no credentials. */
export function darwinSystemProfile({ exec = spawnSync } = {}) {
  const read = (file, args) => {
    try {
      const result = exec(file, args, { encoding: "utf8", timeout: 5000, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } })
      return result.status === 0 && typeof result.stdout === "string" ? result.stdout.trim() : null
    } catch { return null }
  }
  return {
    version: read("/usr/bin/sw_vers", ["-productVersion"]),
    build: read("/usr/bin/sw_vers", ["-buildVersion"]),
    sdk: read("/usr/bin/xcrun", ["--show-sdk-version"]),
  }
}

const gitBlob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")

function pinnedFile(pin, { readFile, lstat, realpath }) {
  if (!digest(pin?.sha256) || typeof pin?.path !== "string" || !isAbsolute(pin.path) || resolve(pin.path) !== pin.path) return { reason: "unreadable" }
  try {
    if (realpath(pin.path) !== pin.path || !lstat(pin.path).isFile()) return { reason: "unreadable" }
    const bytes = readFile(pin.path)
    return sha256(bytes) === pin.sha256 ? { bytes } : { reason: "hash-mismatch" }
  } catch { return { reason: "unreadable" } }
}

/** Binds one owned run. Returns {matched:true, identityOwner, profile} on an exact live
 * match, otherwise {matched:false, reason}. The reason vocabulary is closed: no raw error
 * text, host path or credential is reported. The constructed reader is the adapter's
 * identityOwner for that run alone; a refused binding constructs nothing native.
 */
export async function bindNativeQualification(wave, {
  runId, sourcePath,
  platform = process.platform, arch = process.arch, nodeVersion = process.version, execPath = process.execPath,
  systemProfile = darwinSystemProfile, readFile = readFileSync, lstat = lstatSync, realpath = realpathSync,
  spawn, clock, createReader = createDarwinIdentityReader,
} = {}) {
  const refuse = reason => ({ matched: false, reason })
  const pin = wave?.native_qualification
  if (pin === undefined || pin === null) return refuse("record-missing")
  if (typeof runId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(runId) || typeof sourcePath !== "string" || !isAbsolute(sourcePath)) return refuse("record-invalid")
  if (typeof pin.path !== "string" || !isAbsolute(pin.path) || resolve(pin.path) !== pin.path || !digest(pin.sha256)) return refuse("record-unreadable")
  // The record lives outside the compared packages, pinned by its own SHA-256.
  for (const arm of [wave?.arms?.baseline?.directory, wave?.arms?.candidate?.directory]) {
    if (typeof arm === "string" && (pin.path === arm || pin.path.startsWith(`${arm}/`))) return refuse("record-in-compared-package")
  }
  const file = pinnedFile(pin, { readFile, lstat, realpath })
  if (file.reason === "unreadable") return refuse("record-unreadable")
  if (file.reason === "hash-mismatch") return refuse("record-hash-mismatch")
  let record
  try { record = JSON.parse(file.bytes.toString("utf8")) } catch { return refuse("record-invalid") }
  try { validateNativeQualificationRecord(record) } catch { return refuse("record-invalid") }
  const os = record.os_profile
  // Live OS profile: exact platform, architecture, product version, build and SDK match.
  if (platform !== os.platform || arch !== os.arch) return refuse("os-profile-mismatch")
  const live = systemProfile()
  if (live?.version !== os.version || live?.build !== os.build || live?.sdk !== os.sdk) return refuse("os-profile-mismatch")
  // Live parent Node: canonical realpath, running version, mode 0755 and exact bytes.
  try {
    if (realpath(execPath) !== record.node.path || nodeVersion !== record.node.version) return refuse("node-mismatch")
    const stat = lstat(record.node.path)
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o755) return refuse("node-mismatch")
    if (sha256(readFile(record.node.path)) !== record.node.sha256) return refuse("node-mismatch")
  } catch { return refuse("node-mismatch") }
  // Live helper source: the harness tree's blob must be the qualified source blob.
  let sourceBytes
  try { sourceBytes = readFile(sourcePath) } catch { return refuse("source-mismatch") }
  if (gitBlob(sourceBytes) !== record.helper.source_blob) return refuse("source-mismatch")
  // Live deployed helper: canonical path, exact size, mode 0555, exact bytes, canonical 0700 cwd.
  const helperPath = record.helper.binary.path, cwd = dirname(helperPath)
  try {
    if (realpath(helperPath) !== helperPath || realpath(cwd) !== cwd) return refuse("helper-mismatch")
    const stat = lstat(helperPath), dir = lstat(cwd)
    if (!stat.isFile() || stat.size !== record.helper.binary.size || (stat.mode & 0o7777) !== 0o555) return refuse("helper-mismatch")
    if (!dir.isDirectory() || (dir.mode & 0o7777) !== 0o700) return refuse("helper-mismatch")
    if (sha256(readFile(helperPath)) !== record.helper.binary.sha256) return refuse("helper-mismatch")
  } catch { return refuse("helper-mismatch") }
  // Live qualification evidence reference: the pinned report must be present with its hash.
  const evidence = pinnedFile(record.evidence, { readFile, lstat, realpath })
  if (evidence.reason) return refuse("evidence-mismatch")
  // Exact match: construct the reviewed reader with the record's pins as the adapter's identityOwner.
  const pins = {
    schema: "qmac-owner/1", platform: os.platform, arch: os.arch, runId, cwd,
    helper: { path: helperPath, sha256: record.helper.binary.sha256, size: record.helper.binary.size, mode: 0o555, arch: os.arch },
    sourceSha256: sha256(sourceBytes),
    buildManifestSha256: record.helper.build_manifest_sha256,
    platformProfileSha256: sha256(Buffer.from(JSON.stringify({ platform: os.platform, arch: os.arch, version: os.version, build: os.build, sdk: os.sdk }))),
    nodeSha256: record.node.sha256,
    lookupMs: record.budgets.lookup_ms, cleanupMs: record.budgets.cleanup_ms,
  }
  let identityOwner
  try {
    identityOwner = createReader(pins, { platform: os.platform, arch: os.arch, readFile, lstat, realpath, ...(spawn !== undefined ? { spawn } : {}), ...(clock !== undefined ? { clock } : {}) })
  } catch { return refuse("helper-mismatch") } // Construction re-validates the live asset; refusal is a mismatch.
  // The adapter's identityOwner contract does not include ready(); a seam owner that
  // throws here fails closed through the same warm-up refusal. The real reader never throws.
  let ready
  try { ready = await identityOwner.ready() } catch { return refuse("warmup-failed") }
  if (ready !== true || identityOwner.available() !== true) return refuse("warmup-failed")
  return {
    matched: true, identityOwner,
    profile: {
      os_profile: { ...os },
      node: { version: record.node.version, sha256: record.node.sha256, mode: record.node.mode },
      helper: { sha256: record.helper.binary.sha256, size: record.helper.binary.size, mode: record.helper.binary.mode },
      budgets: { ...record.budgets },
      evidence: { sha256: record.evidence.sha256 },
      qualified_scope: record.qualified_scope,
    },
  }
}
