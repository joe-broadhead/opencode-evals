import { createHash } from "node:crypto"

/** Bounded continuous byte capture. Sink opens fresh no-follow files, never code. */
export function createProvisionalSpool(descriptor, sink, { maxBytes = 32 * 1024 * 1024, perFileBytes = 8 * 1024 * 1024 } = {}) {
  let total = 0, next = 0, sealed = false, overflow = false
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
      if (sealed || next >= 63) throw new Error("spool process limit or sealed")
      const index = ++next, stdout = args?.[0] === "run" ? raw : open(`process-${index}.stdout`), stderr = open(`process-${index}.stderr`)
      return (channel, bytes) => append(channel === "stdout" ? stdout : stderr, bytes)
    },
    finish({ exit = null, capture } = {}) {
      if (sealed) throw new Error("spool sealed")
      sealed = true
      const evidence = [...files.values()].map(f => { f.handle.close(); return { path: f.path, bytes: f.bytes, sha256: f.hash.digest("hex") } })
      const receipt = { schema: "oc-owned-provisional/1", binding: descriptor.binding, container_id: descriptor.container_id, launch_sha256: createHash("sha256").update(JSON.stringify(descriptor)).digest("hex"), complete: false, native: "unknown", observer: "unknown", cleanup: "parent-required", exit: Number.isInteger(exit) ? exit : null, overflow, evidence, ...(capture ? { capture } : {}) }
      const bytes = Buffer.from(JSON.stringify(receipt))
      if (bytes.length > 65536) throw new Error("provisional receipt limit")
      const file = sink.open("provisional.json"); file.append(bytes); file.close()
      return receipt
    },
  }
}
