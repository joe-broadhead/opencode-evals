import { createHash } from "node:crypto"

/** Bounded continuous byte capture. Sink opens fresh no-follow files, never code. */
export function createProvisionalSpool(descriptor, sink, { maxBytes = 32 * 1024 * 1024, perFileBytes = 8 * 1024 * 1024, drainMs = 1000, clock = { now: () => performance.now(), set: (fn, ms) => setTimeout(fn, ms), clear: timer => clearTimeout(timer) } } = {}) {
  if (!Number.isSafeInteger(drainMs) || drainMs <= 0 || drainMs > 2000) throw new Error("bounded recorder drain required")
  let total = 0, next = 0, sealed = false, overflow = false
  let draining = false, drainPromise, closeDrain
  const openChildren = new Set()
  const files = new Map()
  const open = path => {
    const file = { path, bytes: 0, hash: createHash("sha256"), handle: sink.open(path) }
    files.set(path, file)
    return file
  }
  const raw = open("raw.jsonl")
  const append = (file, chunk) => {
    if (sealed) throw new Error("spool sealed")
    const bytes = Buffer.from(chunk)
    if (overflow || total + bytes.length > maxBytes || file.bytes + bytes.length > perFileBytes) { overflow = true; throw new Error("spool output limit") }
    file.handle.append(bytes)
    file.hash.update(bytes); file.bytes += bytes.length; total += bytes.length
  }
  return {
    incomplete() { overflow = true },
    start({ args }) {
      if (sealed || draining || next >= 63) throw new Error("spool process limit or sealed")
      const index = ++next, stdout = args?.[0] === "run" ? raw : open(`process-${index}.stdout`), stderr = open(`process-${index}.stderr`)
      openChildren.add(index)
      const record = (channel, bytes) => append(channel === "stdout" ? stdout : stderr, bytes)
      // ChildProcess close follows closure of its stdio, unlike exit. This grants no process/descendant authority.
      record.close = () => { openChildren.delete(index); if (!openChildren.size) closeDrain?.() }
      return record
    },
    drain() {
      if (drainPromise) return drainPromise
      draining = true // Do not admit new recorded children while waiting for the existing pipes.
      drainPromise = new Promise(resolve => {
        if (!openChildren.size) { resolve(true); return }
        const deadline = clock.now() + drainMs
        const finish = closed => {
          const complete = closed && clock.now() <= deadline
          if (!complete) overflow = true
          clock.clear(timer); closeDrain = null
          resolve(complete)
        }
        const timer = clock.set(() => finish(false), drainMs)
        closeDrain = () => finish(true)
      })
      return drainPromise
    },
    finish({ exit = null, capture } = {}) {
      if (sealed) throw new Error("spool sealed")
      if (openChildren.size) overflow = true
      sealed = true
      const evidence = [...files.values()].map(f => { f.handle.close(); return { path: f.path, bytes: f.bytes, sha256: f.hash.digest("hex") } })
      const receipt = { schema: "oc-owned-provisional/1", binding: descriptor.binding, container_id: descriptor.container_id, launch_sha256: createHash("sha256").update(JSON.stringify(descriptor)).digest("hex"), complete: false, native: "unknown", observer: "unknown", cleanup: "parent-required", exit: Number.isInteger(exit) ? exit : null, overflow, streams_closed: openChildren.size === 0, evidence, ...(capture ? { capture } : {}) }
      const bytes = Buffer.from(JSON.stringify(receipt))
      if (bytes.length > 65536) throw new Error("provisional receipt limit")
      const file = sink.open("provisional.json"); file.append(bytes); file.close()
      return receipt
    },
  }
}
