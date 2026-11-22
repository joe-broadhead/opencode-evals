// Original ChildProcess handles are the ONLY host-client signal authority.
// Deliberately no default spawn: native use must supply the qualified pinned transport.
import { redactor } from "./secrets.mjs"
import { OWNED_CONTEXT, ownedClock } from "./owned-containment.mjs"

export function createOwnedDockerClient({ binary, context, config, credentialValues = {} }, { spawn, clock = ownedClock, graceMs = 100 } = {}) {
  if (typeof spawn !== "function" || !binary?.startsWith("/") || !config?.startsWith("/") || context !== OWNED_CONTEXT) throw new Error("pinned Docker transport required")
  const handles = new Set(), scrub = redactor(Object.values(credentialValues))
  const stop = item => {
    if (item.closed || item.stopping) return
    item.stopping = true
    clock.clear(item.timer)
    if (!item.exited) { try { item.child.kill("SIGTERM") } catch { /* unknown */ } }
    item.escalation = clock.set(() => {
      if (!item.exited) { try { item.child.kill("SIGKILL") } catch { /* unknown */ } }
      item.finish(false)
    }, graceMs)
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
      const item = { child, exited: false, closed: false, stopping: false, code: null, signal: null, size: 0, stdout: [], stderr: [], overflow: false }
      let settle
      item.result = new Promise(resolve => { settle = resolve })
      item.finish = closed => {
        clock.clear(item.timer)
        // exec stdout/stderr may contain arbitrary plugin output, including unknown secrets: never export it here.
        const text = key => args[2] === "exec" ? "" : scrub(Buffer.concat(item[key]).toString("utf8"))
        settle({ code: item.code, signal: item.signal, closed, overflow: item.overflow, stdout: text("stdout"), stderr: text("stderr") })
      }
      handles.add(item)
      for (const key of ["stdout", "stderr"]) child[key].on("data", data => {
        if (item.stopping) return
        const bytes = Buffer.from(data)
        item.size += bytes.length
        if (item.size > maxBytes) { item.overflow = true; stop(item); return }
        item[key].push(bytes)
      })
      const done = () => {
        if (!item.exited || !item.closed) return
        handles.delete(item)
        clock.clear(item.escalation)
        item.finish(true)
      }
      child.on("exit", (code, signal) => { item.exited = true; item.code = code; item.signal = signal; done() })
      child.on("close", () => { item.closed = true; done() })
      child.on("error", () => stop(item)) // no error string (can carry env/output); require exit+close
      item.timer = clock.set(() => stop(item), timeoutMs)
      if (input !== null) { child.stdin.on("error", () => stop(item)); child.stdin.end(input) }
      return item.result
    },
  }
}
