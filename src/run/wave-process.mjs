import { spawn as spawnProcess } from "node:child_process"

/** No process-name/PID discovery. Only a fresh worker's exclusive PGID grants signal authority. */
export function processAdapter({ spawn = spawnProcess, kill = process.kill.bind(process), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const owned = new Set()
  const clients = new Set()
  const start = (spec, detached) => spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, detached, stdio: ["ignore", "ignore", "ignore", ...(spec.ipc ? ["ipc"] : [])] })
  return {
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
      owned.add(child.pid)
      return { pgid: child.pid, exited: () => exited, finished: () => exited && code === 0, activate: () => { if (spec.ipc) child.send({ type: "start" }) } }
    },
    signal(pgid, signal) {
      if (!owned.has(pgid)) throw new Error("process group is not owned")
      try { kill(-pgid, signal) } catch (error) { if (error.code !== "ESRCH") throw error; owned.delete(pgid) }
    },
    alive(pgid) {
      if (!owned.has(pgid)) return false
      try { kill(-pgid, 0); return true } catch (error) {
        if (error.code !== "ESRCH") throw error
        owned.delete(pgid)
        return false
      }
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
