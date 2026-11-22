import { spawn as spawnProcess } from "node:child_process"

/** One sequential completion check on the worker's existing parent channel. */
export function requestTrialVerification(channel, trialId) {
  return new Promise(resolve => {
    const finish = verified => {
      channel.removeListener("message", onMessage)
      channel.removeListener("disconnect", onDisconnect)
      resolve(verified)
    }
    const onMessage = message => finish(message?.type === "trial-verification" && message.trial_id === trialId && message.verified === true)
    const onDisconnect = () => finish(false)
    if (!channel.connected) return resolve(false)
    channel.once("message", onMessage)
    channel.once("disconnect", onDisconnect)
    try { channel.send({ type: "verify-trial", trial_id: trialId }, error => { if (error) finish(false) }) } catch { finish(false) }
  })
}

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
      let handle = null
      try {
        const acquired = groupIdentity?.(child)
        if (acquired && typeof acquired === "object" && !Array.isArray(acquired) && typeof acquired.probe === "function" && typeof acquired.signal === "function") {
          handle = Object.freeze({ probe: acquired.probe.bind(acquired), signal: acquired.signal.bind(acquired) })
        }
      } catch { /* Preserve the started child as unresolved; malformed handles grant no authority. */ }
      owned.set(child.pid, handle)
      let activated = false
      const onMessage = message => {
        if (!activated || message?.type !== "verify-trial") return
        let verified = false
        try { verified = typeof message.trial_id === "string" && spec.verifyTrial?.(message.trial_id) === true } catch { /* Ownership errors deny admission. */ }
        try { child.send({ type: "trial-verification", trial_id: message.trial_id, verified }, () => {}) } catch { /* Disconnection cannot authorize another trial. */ }
      }
      child.on("message", onMessage)
      child.once("exit", () => child.removeListener("message", onMessage))
      child.once("disconnect", () => child.removeListener("message", onMessage))
      return { pgid: child.pid, supervisionReady: handle !== null, exited: () => exited, finished: () => exited && code === 0, activate: () => {
        if (!handle) throw new Error("worker incarnation handle unavailable")
        if (activated) throw new Error("worker already activated")
        activated = true
        if (spec.ipc) child.send({ type: "start" })
      } }
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
