// Original ChildProcess handles are the ONLY host-client signal authority.
// Deliberately no default spawn: native use must supply the qualified pinned transport.
import { redactor } from "./secrets.mjs"
import { OWNED_CONTEXT, ownedClock } from "./owned-containment.mjs"

export function createOwnedDockerClient({ binary, context, config, credentialValues = {} }, { spawn, clock = ownedClock, graceMs = 100 } = {}) {
  if (typeof spawn !== "function" || !binary?.startsWith("/") || !config?.startsWith("/") || context !== OWNED_CONTEXT) throw new Error("pinned Docker transport required")
  const handles = new Set(), scrub = redactor(Object.values(credentialValues))
  const signal = (item, name) => {
    if (item.exited) return
    try { Promise.resolve(item.child.kill(name)).catch(() => {}) } catch { /* unknown; never evidence of exit */ }
  }
  const stop = item => {
    if (item.reaped || item.stopping) return
    item.stopping = true
    clock.clear(item.timer)
    item.escalation = clock.set(() => {
      signal(item, "SIGKILL")
      item.finish(false)
    }, graceMs)
    signal(item, "SIGTERM")
  }
  return {
    closed: () => handles.size === 0,
    async stopClients() {
      const current = [...handles]
      for (const item of current) stop(item)
      await Promise.all(current.map(item => item.result))
      return handles.size === 0
    },
    run(args, { env = {}, credentialNames = [], input = null, timeoutMs, maxBytes } = {}) {
      if (args[0] !== "--context" || args[1] !== context || args.slice(2).includes("--context")) throw new Error("foreign context refused")
      if (![timeoutMs, maxBytes].every(n => Number.isFinite(n) && n > 0)) throw new Error("bounded Docker operation required")
      const clientEnv = { PATH: "/usr/bin:/bin", DOCKER_CONFIG: config }
      for (const [key, value] of Object.entries(env)) {
        if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || /^(DOCKER|BUILDKIT|COMPOSE|NODE_OPTIONS|NODE_PATH|LD_|DYLD_)/.test(key) || key in credentialValues) throw new Error("unsafe client environment")
        clientEnv[key] = String(value)
      }
      if (credentialNames.length && args[2] !== "exec") throw new Error("credentials only reach exec")
      for (const name of credentialNames) {
        if (!/^[A-Z_][A-Z0-9_]*$/.test(name) || typeof credentialValues[name] !== "string" || !args.some((a,i) => a === "-e" && args[i+1] === name)) throw new Error("missing named credential")
        clientEnv[name] = credentialValues[name]
      }
      const child = spawn(binary, args, { env: clientEnv, shell: false, detached: false, stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"] })
      const item = { child, exited: false, closed: false, reaped: false, settled: false, stopping: false, code: null, signal: null, size: 0, stdout: [], stderr: [], overflow: false, truncated: false }
      let settle
      item.result = new Promise(resolve => { settle = resolve })
      item.finish = closed => {
        if (item.settled) return
        item.settled = true
        clock.clear(item.timer)
        clock.clear(item.escalation)
        // exec stdout/stderr may contain arbitrary plugin output, including unknown secrets: never export it here.
        const text = key => args[2] === "exec" ? "" : scrub(Buffer.concat(item[key]).toString("utf8"))
        settle({ code: item.code, signal: item.signal, closed, overflow: item.overflow, truncated: item.truncated, stdout: text("stdout"), stderr: text("stderr") })
        item.stdout = []; item.stderr = []
      }
      handles.add(item)
      const lost = () => { if (!item.settled) item.truncated = true; stop(item) }
      for (const key of ["stdout", "stderr"]) {
        let ended = false
        child[key].on("end", () => { ended = true })
        child[key].on("close", () => { if (!ended) lost() })
        child[key].on("error", lost)
        child[key].on("data", data => {
          if (item.settled) return // A bounded unknown result is immutable; late data cannot upgrade it.
          const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
          const count = Math.min(bytes.length, maxBytes - item.size)
          if (count > 0) { item[key].push(Buffer.from(bytes.subarray(0, count))); item.size += count }
          if (ended) item.truncated = true
          if (count < bytes.length) item.overflow = true
          if (ended || count < bytes.length) stop(item)
        })
      }
      const done = () => {
        if (!item.exited || !item.closed) return
        item.reaped = true
        handles.delete(item)
        clock.clear(item.escalation)
        item.finish(true)
      }
      child.on("exit", (code, signal) => { if (item.exited) return; item.exited = true; item.code = code; item.signal = signal; done() })
      child.on("close", () => { item.closed = true; done() })
      child.on("error", lost) // no error string (can carry env/output); require exit+close
      item.timer = clock.set(() => stop(item), timeoutMs)
      if (input !== null) {
        child.stdin.on("error", lost)
        try { Promise.resolve(child.stdin.end(input)).catch(lost) } catch { lost() }
      }
      return item.result
    },
  }
}
