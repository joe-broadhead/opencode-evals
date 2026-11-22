import fs from "node:fs"
import path from "node:path"
export const CONTROL_TOKEN = "eval-token"

/** Public projection of a space. The fake control plane never returns a container id in these. */
export const CONTROL_SPACES = Object.freeze({
  personal: Object.freeze({
    key: "personal",
    spaceId: "eval-space-personal",
    name: "Personal Workspace",
    kind: "personal",
    role: "owner",
    containerId: "eval-container-personal",
    collectionId: "eval-collection-personal",
    collectionName: "Personal collection",
  }),
  shared: Object.freeze({
    key: "shared",
    spaceId: "eval-space-shared",
    name: "Shared Workspace",
    kind: "shared",
    role: "editor",
    containerId: "eval-container-shared",
    collectionId: "eval-collection-shared",
    collectionName: "Shared collection",
  }),
})

export const LOCAL_SPACE = Object.freeze({
  key: "local",
  spaceId: "",
  name: "local",
  kind: "local",
  role: "",
  containerId: "local",
  collectionId: "",
  collectionName: "",
})

/**
 * A shared space the eval user is NOT a member of (the 0.9.0 handoff and
 * privacy items). The fake control plane never lists it for `eval` and refuses
 * a context for it; scenarios seed records into its container through the
 * records API, and the harness reads them back, so "a non-member gets
 * nothing" is checked against real data.
 */
export const OTHER_SPACE = Object.freeze({
  key: "other",
  spaceId: "eval-space-other",
  name: "Platform Team",
  kind: "shared",
  role: "",
  containerId: "eval-container-other",
  collectionId: "eval-collection-other",
  collectionName: "Platform collection",
})

/**
 * Users the fake control plane knows, for grant principals and member lists.
 * Only `eval` signs in; the others author seeded records or receive grants.
 */
export const CONTROL_USERS = Object.freeze({
  eval: { name: "Eval User", spaces: { personal: "owner", shared: "editor" } },
  casey: { name: "Casey Reviewer", spaces: { shared: "viewer" } },
  ama: { name: "Ama Mensah", spaces: { shared: "editor", other: "owner" } },
  dana: { name: "Dana Okafor", spaces: {} },
})

/**
 * Servers and child processes that must not outlive the harness. The CLI
 * installs signal handlers; library callers can call `cleanupActive` directly.
 */
const activeCleanups = new Set()

export function trackCleanup(cleanup) {
  activeCleanups.add(cleanup)
  return () => activeCleanups.delete(cleanup)
}

/** Stop every tracked server and child process. Safe to call more than once. */
export async function cleanupActive() {
  const cleanups = [...activeCleanups]
  activeCleanups.clear()
  await Promise.allSettled(cleanups.map((cleanup) => cleanup()))
}

/**
 * Every work directory an attempt created and has not yet removed. They are
 * removed synchronously on process exit, so a crash or interrupt leaves none.
 */
const liveWorkDirs = new Set()
let exitHookInstalled = false

export function trackWorkDir(dir) {
  liveWorkDirs.add(dir)
  if (!exitHookInstalled) {
    exitHookInstalled = true
    process.on("exit", removeLiveWorkDirs)
  }
  return () => liveWorkDirs.delete(dir)
}

/** Best effort and synchronous: safe inside an "exit" handler. */
export function removeLiveWorkDirs() {
  // An attempt that never finished counts as failed.
  const keep = shouldKeepWorkDir({ passed: false })
  for (const dir of [...liveWorkDirs]) {
    if (keep) continue
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
    liveWorkDirs.delete(dir)
  }
}

/** Keep an attempt's directory only on request: EVAL_KEEP_TMP=1, or a failure with EVAL_KEEP_FAILED=1. */
export function shouldKeepWorkDir({ passed, keep = false, keepPolicy = "", safety = false, env = process.env }) {
  if (keep || env.EVAL_KEEP_TMP === "1") return true
  if (!passed && env.EVAL_KEEP_FAILED === "1") return true
  // --keep-policy failed-or-safety: the evidence for a failed safety or policy attempt.
  return keepPolicy === "failed-or-safety" && safety && !passed
}

const COMPACT_DROP_DIRS = new Set(["node_modules", "xdg-cache", ".cache", "Cache", "Code Cache", "GPUCache"])
const COMPACT_KEEP_EXT = /\.(db|db-wal|db-shm|sqlite|jsonl|json|txt|log|md)$/i
const COMPACT_MAX_BYTES = 5 * 1024 * 1024

/** Drop caches, node_modules and large binaries; keep the session database and transcripts. */
export function compactWorkDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    try {
      if (entry.isDirectory()) {
        if (COMPACT_DROP_DIRS.has(entry.name)) fs.rmSync(full, { recursive: true, force: true })
        else compactWorkDir(full)
      } else if (!COMPACT_KEEP_EXT.test(entry.name) && fs.statSync(full).size > COMPACT_MAX_BYTES) {
        fs.rmSync(full, { force: true })
      }
    } catch {}
  }
}

/** Total bytes under a directory. */
export function dirSize(dir) {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    try {
      total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size
    } catch {}
  }
  return total
}

/** Install one-shot SIGINT/SIGTERM handlers that stop the sandbox before exit. */
export function installSignalCleanup() {
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    process.once(signal, () => {
      void cleanupActive().finally(() => {
        removeLiveWorkDirs()
        process.exit(code)
      })
    })
  }
}
