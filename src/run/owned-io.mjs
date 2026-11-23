// Bounded regular-file I/O. These readers never evaluate content, follow links, or invoke tools.
import * as fs from "node:fs"
import { resolve, join, relative, isAbsolute } from "node:path"
import { createHash } from "node:crypto"
import { statfs } from "node:fs/promises"
import { measureSandbox, DEFAULT_LIMITS } from "./container.mjs"
const sha = bytes => createHash("sha256").update(bytes).digest("hex")
const same = (a,b) => a.dev === b.dev && a.ino === b.ino

function rootStat(root, io) {
  if (!isAbsolute(root) || resolve(root) !== root || io.realpathSync(root) !== root) throw new Error("unsafe root")
  const stat = io.lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe root")
  return stat
}
export function createBoundedReader(root, identity, io = fs) {
  return (name, maxBytes) => {
    if (!same(rootStat(root, io), identity) || !Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 512 * 1024 * 1024 || typeof name !== "string" || !name || isAbsolute(name) || name.split("/").some(x => !x || x === "." || x === "..")) throw new Error("unsafe data path or limit")
    const path = join(root, name), rel = relative(root, path)
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("outside root")
    let at = root
    for (const part of name.split("/")) {
      at = join(at, part)
      const stat = io.lstatSync(at)
      if (stat.isSymbolicLink() || (at !== path && !stat.isDirectory())) throw new Error("unsafe data ancestor")
    }
    const fd = io.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
    try {
      const stat = io.fstatSync(fd)
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw new Error("unsafe data file")
      const bytes = io.readFileSync(fd)
      if (bytes.length > maxBytes || bytes.length !== stat.size) throw new Error("changed/oversized data")
      return bytes
    } finally { io.closeSync(fd) }
  }
}

export function createOwnedSink(root, io = fs) {
  const identity = rootStat(root, io)
  return { open(name) {
    if (!/^(raw\.jsonl|provisional\.json|process-[0-9]{1,3}\.(stdout|stderr))$/.test(name) || !same(rootStat(root, io), identity)) throw new Error("unsafe spool path")
    const fd = io.openSync(join(root, name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
    let closed = false
    return {
      append(bytes) { if (closed) throw new Error("closed spool"); io.writeFileSync(fd, bytes) },
      close() { if (!closed) { try { io.fsyncSync(fd) } finally { io.closeSync(fd); closed = true } } },
    }
  } }
}

/** Already-staged input trees only. No downloads, installs, source collection or mutation.
 * Parent must make the empty work root exclusively before calling; all identities stay outside it.
 */
export function validateOwnedInputs(plan, io = fs) {
  const work = rootStat(plan.work, io)
  if (io.readdirSync(plan.work).length) throw new Error("work root is not fresh")
  let count = 0, total = 0
  const tree = (root, binaries = false) => {
    const stat = rootStat(root, io), read = createBoundedReader(root, stat, io), hash = createHash("sha256")
    const visit = dir => {
      for (const name of io.readdirSync(join(root, dir)).sort()) {
        if (++count > 100000 || /^(\.git|\.env|\.docker|auth\.json|credentials(?:\.json)?|opencode\.db)$/.test(name)) throw new Error("unapproved staged content")
        const path = dir ? `${dir}/${name}` : name, st = io.lstatSync(join(root, path))
        if (st.isSymbolicLink()) throw new Error("staged symlink")
        if (st.isDirectory()) { visit(path); continue }
        const bytes = read(path, 512 * 1024 * 1024)
        total += bytes.length
        if (total > 2 * 1024 * 1024 * 1024) throw new Error("staging size limit")
        if (binaries || path.endsWith(".node")) {
          const machine = plan.architecture === "arm64" ? 183 : plan.architecture === "x64" ? 62 : null
          if (!machine || bytes.length < 20 || bytes.subarray(0,4).toString("hex") !== "7f454c46" || bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== machine) throw new Error("pinned Linux binary architecture required")
        }
        hash.update(`${path}\0${st.mode & 0o777}\0${bytes.length}\0${sha(bytes)}\n`)
      }
    }
    const top = io.readdirSync(root)
    // The owned composition's in-container condition proof reads its dossier
    // attachments as basename copies beneath an optional top-level attachments root.
    if (binaries ? top.length !== 2 || !["node", "opencode"].every(n => top.includes(n)) : top.some(n => !["harness", "arm", "cases", "caps.json", "conditions.json", "models.json", "model-map.json", "attachments", "targets.json", "commit-plan.json"].includes(n))) throw new Error("minimal staged roots required")
    if (!binaries) {
      if (!["harness", "arm", "cases", "caps.json", "models.json", "model-map.json", ...(plan.descriptor?.options?.condition ? ["conditions.json"] : [])].every(n => top.includes(n))) throw new Error("complete minimal staged roots required")
      // A mis-staged attachments entry (a regular file at that name) surfaces here, at
      // staging validation, instead of failing later at the in-container proof time.
      if (["harness", "arm", "cases"].some(n => !io.lstatSync(join(root,n)).isDirectory()) || top.includes("attachments") && !io.lstatSync(join(root, "attachments")).isDirectory()) throw new Error("minimal staged directories required")
    }
    if (binaries && top.some(n => { const s = io.lstatSync(join(root,n)); return !s.isFile() || !(s.mode & 0o111) })) throw new Error("executable regular Linux binaries required")
    visit("")
    return hash.digest("hex")
  }
  return { work: { dev: work.dev, ino: work.ino }, inputs_sha256: tree(plan.inputs), binaries_sha256: tree(plan.binaries, true) }
}

/** Reuse the existing disk/inode limits over ALL per-trial staging, logs and work. */
export async function measureOwnedWork(root, { measure = measureSandbox, statfs: filesystem = statfs } = {}) {
  try {
    const m = await measure(root, { deadlineMs: DEFAULT_LIMITS.measure_s * 1000, maxBytes: DEFAULT_LIMITS.disk_mb * 1048576, maxInodes: DEFAULT_LIMITS.inodes })
    const f = await filesystem(root)
    return m.unmeasurable === null && Number.isFinite(m.bytes) && m.bytes <= DEFAULT_LIMITS.disk_mb * 1048576 && Number.isFinite(m.inodes) && m.inodes <= DEFAULT_LIMITS.inodes && Number.isFinite(f.bavail * f.bsize) && f.bavail * f.bsize >= DEFAULT_LIMITS.disk_floor_mb * 1048576 && (f.files === 0 || Number.isFinite(f.ffree) && f.ffree >= DEFAULT_LIMITS.inode_floor)
  } catch { return false }
}
