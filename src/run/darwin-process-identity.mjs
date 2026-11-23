// Parent-private platform asset. No default wiring and no native qualification.
import { spawn as spawnProcess } from "node:child_process"
import { readFileSync, lstatSync, realpathSync } from "node:fs"
import { createHash } from "node:crypto"
import { isAbsolute, resolve } from "node:path"

const path = p => typeof p === "string" && isAbsolute(p) && resolve(p) === p && p !== "/" && !/[\x00\r\n]/.test(p)
const hash = h => typeof h === "string" && /^[a-f0-9]{64}$/.test(h)
const pid = n => Number.isSafeInteger(n) && n >= 2 && n <= 2147483647
const clockDefault = { now: () => performance.now(), set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) }

/** Pins are supplied by the owner, outside trial data. Digests are not qualification evidence. */
export function createDarwinIdentityReader(ownerPins, { spawn = spawnProcess, clock = clockDefault, platform = process.platform, arch = process.arch, readFile = readFileSync, lstat = lstatSync, realpath = realpathSync } = {}) {
  const p = structuredClone(ownerPins)
  const refuse = () => { throw new Error("darwin-identity-pins-refused") }
  if (p?.schema !== "qmac-owner/1" || platform !== "darwin" || p.platform !== platform || !["arm64", "x64"].includes(p.arch) || p.arch !== arch || !/^[a-zA-Z0-9_-]{1,128}$/.test(p.runId ?? "") || !path(p.cwd) || !path(p.helper?.path) || p.helper.arch !== p.arch || !hash(p.helper.sha256) || !Number.isSafeInteger(p.helper.size) || p.helper.size < 1 || p.helper.size > 1048576 || p.helper.mode !== 0o555 || ![p.sourceSha256, p.buildManifestSha256, p.platformProfileSha256, p.nodeSha256].every(hash) || p.lookupMs !== 100 || p.cleanupMs !== 100) refuse()
  const asset = () => {
    try {
      const dir = lstat(p.cwd), s = lstat(p.helper.path)
      if (!dir.isDirectory() || (dir.mode & 0o7777) !== 0o700) return false
      if (!s.isFile() || s.size !== p.helper.size || (s.mode & 0o7777) !== p.helper.mode || realpath(p.helper.path) !== p.helper.path || realpath(p.cwd) !== p.cwd) return false
      const bytes = readFile(p.helper.path)
      return Buffer.isBuffer(bytes) && bytes.length === p.helper.size && createHash("sha256").update(bytes).digest("hex") === p.helper.sha256
    } catch { return false }
  }
  if (!asset()) refuse()
  const targets = new WeakMap()
  let active = null, stopped = false
  const live = (child, original) => pid(child?.pid) && child.pid === original && child.exitCode == null && child.signalCode == null && targets.get(child)?.live
  const available = () => !stopped && active === null
  const register = child => {
    if (stopped || !child || typeof child.once !== "function" || targets.has(child)) return false
    const state = { live: true }; targets.set(child, state)
    const end = () => { state.live = false; if (active?.target === child) active.cancel() }
    child.once("exit", end); child.once("close", end); child.once("error", end)
    return true
  }
  const readIdentity = (target, { signal } = {}) => {
    const original = target?.pid
    if (!available() || !live(target, original) || signal?.aborted || !asset()) return Promise.resolve(null)
    let complete
    const result = new Promise(resolve => { complete = resolve })
    const a = { target, cancel: () => complete(null) }
    active = a
    let helper
    try { helper = spawn(p.helper.path, [String(original)], { cwd: p.cwd, env: {}, shell: false, detached: false, stdio: ["ignore", "pipe", "ignore"] }) }
    catch { active = null; complete(null); return result }
    let output = Buffer.alloc(64), length = 0, exit = false, close = false, failed = false, invalid = false, reconciled = false, code = null, exitSignal = null
    const established = pid(helper.pid)
    const waiters = new Set()
    const cancel = () => { invalid = true; output = null; complete(null) }
    a.cancel = cancel
    const deadline = clock.now() + p.lookupMs
    const timer = clock.set(cancel, p.lookupMs)
    const reconcile = () => {
      if (reconciled || !close || !(established ? exit : failed)) return
      reconciled = true
      clock.clear(timer); signal?.removeEventListener("abort", cancel)
      active = null
      let identity = null
      if (!invalid && !stopped && !failed && established && code === 0 && exitSignal == null && clock.now() < deadline && live(target, original)) {
        const text = output.subarray(0, length).toString("ascii")
        const m = /^QMAC1 ([1-9][0-9]{0,9}) ([1-9][0-9]{0,19}) ([0-9]{6})\n$/.exec(text)
        if (m && Number(m[1]) === original && BigInt(m[2]) <= 18446744073709551615n) identity = { pid: original, start: `darwin-bsd-v1:${m[2]}:${m[3]}` }
      }
      output = null; complete(identity)
      for (const done of waiters) done(true)
      waiters.clear()
    }
    a.observe = () => new Promise(resolve => {
      const done = value => { clock.clear(t); waiters.delete(done); resolve(value) }
      const t = clock.set(() => done(false), p.cleanupMs)
      waiters.add(done)
    })
    helper.on("error", () => { failed = true; cancel(); reconcile() })
    helper.on("exit", (c, s) => { exit = true; code = c; exitSignal = s; reconcile() })
    helper.on("close", () => { close = true; reconcile() })
    helper.stdout?.on("data", chunk => {
      if (invalid || reconciled) return
      if (!Buffer.isBuffer(chunk) || chunk.length > 64 - length || chunk.some(b => b > 127)) { cancel(); return }
      chunk.copy(output, length); length += chunk.length
    })
    helper.stdout?.on("error", cancel)
    signal?.addEventListener("abort", cancel, { once: true })
    if (signal?.aborted) cancel()
    return result
  }
  const reconcile = () => active ? active.observe() : Promise.resolve(true)
  return Object.freeze({ register, readIdentity, available, closed: () => active === null, reconcile, stop() { stopped = true; active?.cancel(); return reconcile() } })
}
