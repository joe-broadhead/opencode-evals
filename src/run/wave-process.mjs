import { spawn as spawnProcess } from "node:child_process"

/** Native Node offers no incarnation-bound POSIX group handle. Never fall back to kill(-pgid).
 * groupIdentity is an injected test seam, not an implemented native capability. Its handle must
 * bind both probe and signal atomically to one incarnation, including reparented descendants.
 */
export function processAdapter({ spawn = spawnProcess, groupIdentity = null, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const owned = new Map()
  const clients = new Set()
  const start = (spec, detached) => spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, detached, stdio: ["ignore", "ignore", "ignore", ...(spec.ipc ? ["ipc"] : [])] })
  return {
    supervisionAvailable: typeof groupIdentity === "function",
    unverified: () => [...clients],
    command(spec, timeoutMs) {
      return new Promise(resolve => {
        const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, detached: false, stdio: ["ignore", "pipe", "pipe"] })
        if (child.pid) clients.add(child.pid)
        let stdout = "", stderr = "", done = false, late
        const finish = code => {
          done = true; clients.delete(child.pid); clearTimer(timer); if (late) clearTimer(late)
          resolve({ code, stdout, stderr })
        }
        child.stdout.on("data", b => { stdout = (stdout + b).slice(-65536) })
        child.stderr.on("data", b => { stderr = (stderr + b).slice(-65536) })
        const timer = setTimer(() => {
          if (done) return
          child.kill("SIGKILL")
          late = setTimer(() => resolve({ code: null, stdout: "", stderr: "cleanup client exit unverified" }), Math.min(1000, timeoutMs / 2))
        }, Math.max(1, timeoutMs - Math.min(1000, timeoutMs / 2)))
        child.on("error", () => {
          if (!child.pid) finish(null)
          else resolve({ code: null, stdout: "", stderr: "cleanup client exit unverified" })
        })
        child.on("exit", code => finish(code))
      })
    },
    worker(spec) {
      const child = start(spec, true)
      let exited = false, code = null
      child.on("error", () => { exited = true })
      child.on("exit", value => { code = value; exited = true })
      if (!Number.isInteger(child.pid) || child.pid <= 1) throw new Error("worker did not start")
      owned.set(child.pid, null)
      try { owned.set(child.pid, groupIdentity?.(child) ?? null) } catch { /* Preserve the child handle, but grant no signal authority. */ }
      return { pgid: child.pid, exited: () => exited, finished: () => exited && code === 0, activate: () => { if (spec.ipc) child.send({ type: "start" }) } }
    },
    signal(pgid, signal) {
      const handle = owned.get(pgid)
      if (!handle) return false
      return handle.signal(signal) === true
    },
    alive(pgid) {
      if (!owned.has(pgid)) return false
      const handle = owned.get(pgid)
      if (!handle || handle.probe() !== "gone") return true // Unknown continuity is not verified exit.
      owned.delete(pgid)
      return false
    },
    trial(spec) {
      return new Promise(resolve => {
        const child = start(spec, false)
        child.on("error", () => resolve({ code: null }))
        child.on("exit", code => resolve({ code }))
      })
    },
  }
}
