// Parent-private transport. Not installed in processAdapter; native qualification remains separate.
import { spawn as spawnProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { OWNED_CONTEXT, validateOwnedPlan } from "./owned-containment.mjs"
import { CONTAINER_PATH, EGRESS_URL } from "./container.mjs"

const fullID = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const path = value => typeof value === "string" && isAbsolute(value) && resolve(value) === value && value !== "/" && !/[\x00\r\n]/.test(value)
const refused = () => new Error("owned-docker-process-refused")
const keys = (value, expected) => value && same(Object.keys(value).sort(), [...expected].sort())
const equalEnv = (a, b) => keys(a, Object.keys(b)) && Object.entries(b).every(([key, value]) => a[key] === value)

// Linux /proc field 22, also used by container.processStart. This is a recheck, NOT an atomic PID capability.
function linuxIdentity(child, readFile) {
  const pid = child.pid
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  const text = readFile(`/proc/${pid}/stat`, "utf8")
  if (typeof text !== "string" || text.length > 8192 || !text.startsWith(`${pid} (`)) return null
  const end = text.lastIndexOf(")")
  if (end < `${pid} (`.length || text[end + 1] !== " ") return null
  const fields = text.slice(end + 2).trim().split(/\s+/)
  if (!/^[RSDTtWI]$/.test(fields[0]) || !/^[1-9][0-9]*$/.test(fields[19] ?? "")) return null
  return { pid, start: fields[19] }
}

// Exact inner environment from containTrial. These are explicit exec pass-through values, not host inheritance.
const innerEnv = password => ({ PATH: CONTAINER_PATH, HOME: "/work/home", TMPDIR: "/work/tmp", EVALS_TMP: "/work/tmp", EVALS_STORE: "/work/store", XDG_CONFIG_HOME: "/work/home/.config", XDG_DATA_HOME: "/work/xdg-data", XDG_STATE_HOME: "/work/xdg-state", XDG_CACHE_HOME: "/work/home/.cache", EVALS_CAPS: "/inputs/caps.json", EVALS_MODELS_CATALOG: "/inputs/models.json", EVALS_MODEL_MAP: "/inputs/model-map.json", EVALS_NODE: "/opt/evals/bin/node", EVALS_OPENCODE_BIN: "/opt/evals/bin/opencode", OPENCODE_BIN_2_2_6: "/opt/evals/bin/opencode", OPENCODE_PASSWORD: password, HTTPS_PROXY: EGRESS_URL, HTTP_PROXY: EGRESS_URL, NO_PROXY: "127.0.0.1,localhost" })

// Closed grammar for owned-containment.mjs, not a general Docker command or option allowlist.
function command(p, a) {
  const name = role => `evals-${p.binding.invocation_id}-${role}`
  if (["inspect", "start", "logs"].includes(a[0])) return a.length === 2 && fullID(a[1])
  if (a[0] === "stop") return same(a.slice(0, 3), ["stop", "--time", "1"]) && a.length === 4 && fullID(a[3])
  if (a[0] === "rm") return same(a.slice(0, 3), ["rm", "-f", "-v"]) && a.length === 4 && fullID(a[3])
  if (a[0] === "network") {
    if (["inspect", "rm"].includes(a[1])) return a.length === 3 && fullID(a[2])
    if (a[1] === "connect") return a.length === 6 && same(a.slice(0, 4), ["network", "connect", "--alias", "egress"]) && a.slice(4).every(fullID)
    return same(a, ["network", "create", "--driver", "bridge", name("egress")]) || same(a, ["network", "create", "--driver", "bridge", "--internal", "-o", "com.docker.network.bridge.gateway_mode_ipv4=isolated", "-o", "com.docker.network.bridge.gateway_mode_ipv6=isolated", name("trial")])
  }
  if (a[0] === "exec") return fullID(a.at(-3)) && same(a, ["exec", "-i", "-w", "/work", ...[...Object.keys(innerEnv("")), ...p.credentialNames].flatMap(n => ["-e", n]), a.at(-3), "/opt/evals/bin/node", "/inputs/harness/scripts/run-contained-trial.mjs"])
  if (a[0] !== "create" || !fullID(a[4])) return false
  const proxy = a[2] === name("proxy"), role = proxy ? "proxy" : "trial", memory = proxy ? "268435456" : "3221225472"
  const fixed = ["create", "--name", name(role), "--network", a[4], "--user", p.user, "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--log-driver", "local", "--log-opt", "max-size=1m", "--log-opt", "max-file=1", "--log-opt", "compress=false", "--pids-limit", proxy ? "128" : "512", "--memory", memory, "--memory-swap", memory, "--cpus", proxy ? "0.25" : "1.5", "--workdir", proxy ? "/" : "/work"]
  const tail = proxy
    ? ["--mount", `type=bind,src=${p.binaries}/node,dst=/opt/evals/bin/node,readonly`, "-e", `EVALS_EGRESS_ALLOW=${p.allow.join(",")}`, "-e", "EVALS_EGRESS_MAX_PER_CLIENT=16", "-e", "EVALS_EGRESS_MAX_TOTAL=16", p.image, "/opt/evals/bin/node", "/opt/evals/egress-proxy.mjs", "3128"]
    : ["--tmpfs", "/tmp:rw,nosuid,nodev,size=256m", "--mount", `type=bind,src=${p.inputs},dst=/inputs,readonly`, "--mount", `type=bind,src=${p.binaries},dst=/opt/evals/bin,readonly`, "--mount", `type=bind,src=${p.work},dst=/work`, p.image, "sleep", "infinity"]
  return same(a, [...fixed, ...tail])
}

function ownedHandle(child, readIdentity, descriptor, identityOwner) {
  const handle = new EventEmitter()
  handle.stdout = child.stdout; handle.stderr = child.stderr
  handle.on("error", () => {}) // A late private error is observed even after a consumer removes listeners.
  let identity = null, spawned = false, exited = false, closed = false, identityLost = false, pending = null
  let input = null, ended = false, inputLost = false, inputFinished = false
  const requested = new Set()
  let generation = 0, controller = null
  const invalidate = () => { generation++; controller?.abort(); controller = null }
  const live = () => !exited && !closed && !identityLost && child.exitCode == null && child.signalCode == null
  const valid = value => Number.isSafeInteger(child.pid) && child.pid > 0 && value?.pid === child.pid && typeof value.start === "string" && value.start.length > 0 && value.start.length <= 256 ? { pid: value.pid, start: value.start } : null
  const observe = fn => { try { Promise.resolve(fn()).catch(error => handle.emit("error", error)) } catch (error) { handle.emit("error", error) } }
  const loseInput = () => {
    if (descriptor === null || inputLost) return
    inputLost = true; input = null
    handle.emit("error", new Error("owned-docker-input-lost"))
  }
  const finishedInput = () => inputFinished || child.stdin?.writableFinished === true
  const checkInput = () => {
    if (input !== null || ended && !finishedInput() && child.stdin?.writableFinished === false) loseInput()
  }
  const flushInput = () => {
    if (!spawned || !identity || identityLost || inputLost || exited || closed || requested.size || input === null) return
    if (child.stdin.destroyed || child.stdin.closed || child.stdin.errored) { loseInput(); return }
    const bytes = input; input = null
    // One bounded end; Node's Writable owns backpressure, never resend on drain.
    try { Promise.resolve(child.stdin.end(bytes, error => { if (error) loseInput(); else inputFinished = true })).catch(loseInput) }
    catch { loseInput() }
  }
  child.stdin?.on("error", loseInput)
  child.stdin?.on("finish", () => { inputFinished = true })
  child.stdin?.on("close", () => { if (!finishedInput()) loseInput() })
  handle.stdin = descriptor === null ? null : Object.freeze({
    on(event, listener) { child.stdin.on(event, listener); return handle.stdin },
    end(value) {
      if (ended || !(typeof value === "string" || Buffer.isBuffer(value)) || Buffer.byteLength(value) > 65536) throw refused()
      ended = true
      let parsed
      try { parsed = JSON.parse(value.toString()) } catch { throw refused() }
      if (!same(parsed, descriptor)) throw refused()
      if (requested.size || exited || closed || identityLost || inputLost) return handle.stdin
      input = Buffer.from(value)
      flushInput()
      return handle.stdin
    },
  })
  const lost = () => {
    if (identityLost) return
    identityLost = true
    input = null
    handle.emit("error", new Error("owned-docker-identity-unavailable"))
  }
  const read = () => {
    try {
      const value = readIdentity(child)
      if (value && typeof value.then === "function") { Promise.resolve(value).catch(() => {}); return null }
      if (!Number.isSafeInteger(child.pid) || child.pid <= 0 || value?.pid !== child.pid || typeof value.start !== "string" || !value.start || value.start.length > 256) return null
      return { pid: value.pid, start: value.start }
    } catch { return null }
  }
  const initialAsync = async () => {
    const token = ++generation, original = child.pid
    controller = new AbortController()
    let value
    try { value = await readIdentity(child, { signal: controller.signal }) } catch { value = null }
    if (token !== generation || !live() || requested.size) return
    identity = child.pid === original && identityOwner.closed() && identityOwner.available() ? valid(value) : null
    if (!identity) lost()
    flushInput()
  }
  const signalAsync = async name => {
    invalidate()
    const token = generation, captured = identity
    const current = () => token === generation && live() && captured && identity === captured && child.pid === captured.pid && (name === "SIGKILL" || !requested.has("SIGKILL"))
    if (!current()) return false
    const reaped = await identityOwner.reconcile()
    if (!current()) return false
    if (!reaped || !identityOwner.available()) { lost(); return false }
    controller = new AbortController()
    let value
    try { value = await readIdentity(child, { signal: controller.signal }) } catch { value = null }
    if (!current()) return false
    const observed = valid(value)
    if (!observed || observed.pid !== captured.pid || observed.start !== captured.start || !identityOwner.closed() || !identityOwner.available()) { lost(); return false }
    // No await after the final original-child/state/stage/tuple checks.
    return child.kill(name)
  }
  const signal = name => {
    if (exited || closed || identityLost || child.exitCode != null || child.signalCode != null) return false
    const current = read()
    if (!identity || !current || current.pid !== identity.pid || current.start !== identity.start) { lost(); return false }
    if (exited || closed || child.pid !== identity.pid) return false
    return child.kill(name) // Original handle only; never process.kill, PID reconstruction, or process groups.
  }
  handle.kill = name => {
    if (!["SIGTERM", "SIGKILL"].includes(name) || requested.has(name) || exited || closed) return false
    requested.add(name)
    input = null
    if (identityOwner) return signalAsync(name)
    if (!spawned) { pending = name; return false }
    return signal(name)
  }
  child.once("spawn", () => {
    spawned = true
    if (identityOwner) {
      handle.emit("spawn")
      if (!requested.size) observe(initialAsync)
      return
    }
    identity = read()
    if (!identity) lost()
    handle.emit("spawn")
    if (pending) {
      const name = pending; pending = null
      observe(() => signal(name))
    }
    flushInput()
  })
  child.on("error", error => { invalidate(); input = null; handle.emit("error", error) })
  child.on("exit", (...values) => { if (exited) return; exited = true; invalidate(); pending = null; checkInput(); input = null; handle.emit("exit", ...values) })
  child.on("close", (...values) => { if (closed) return; closed = true; invalidate(); pending = null; checkInput(); input = null; handle.emit("close", ...values) })
  return handle
}

/** Construct only from parent-owned pins, never a manifest approval flag. */
export function createOwnedDockerProcess({ binary, config, context, plan, credentialValues }, { spawn = spawnProcess, readIdentity, identityOwner, readFile = readFileSync, platform = process.platform } = {}) {
  const p = structuredClone(plan)
  const secrets = { ...credentialValues }
  if (!same(p?.credentialNames, ["OPENCODE_API_KEY"]) || p?.descriptor?.options?.auth !== "env:OPENCODE_API_KEY" || !keys(secrets, ["OPENCODE_API_KEY"]) || typeof secrets.OPENCODE_API_KEY !== "string" || !secrets.OPENCODE_API_KEY || secrets.OPENCODE_API_KEY.includes("\0")) throw new Error("owned-docker-credential-refused")
  validateOwnedPlan(p)
  if (identityOwner !== undefined) {
    if (readIdentity !== undefined || !["register", "readIdentity", "reconcile", "stop", "closed", "available"].every(k => typeof identityOwner?.[k] === "function")) throw refused()
    readIdentity = identityOwner.readIdentity
  }
  if (readIdentity === undefined) {
    if (platform !== "linux") throw new Error("owned-docker-identity-unsupported")
    readIdentity = child => linuxIdentity(child, readFile)
  }
  if (!path(binary) || !path(config) || context !== OWNED_CONTEXT || p.context !== context || p.dockerConfig !== config || typeof spawn !== "function" || typeof readIdentity !== "function") throw refused()
  return Object.freeze({
    qualified: false,
    reason: "native-transport-unqualified",
    identityOwner, // Separate lifetime; Docker client.closed() does not include helpers.
    spawn(file, args, options) {
      if (file !== binary || !Array.isArray(args) || args.length > 256 || !Array.from(args).every(a => typeof a === "string" && a.length <= 8192 && !a.includes("\0")) || !same(args.slice(0, 2), ["--context", context]) || !command(p, args.slice(2))) throw refused()
      const exec = args[2] === "exec", env = exec ? { ...innerEnv(options?.env?.OPENCODE_PASSWORD), ...secrets, DOCKER_CONFIG: config } : { PATH: "/usr/bin:/bin", DOCKER_CONFIG: config }
      if (!keys(options, ["env", "shell", "detached", "stdio"]) || options.shell !== false || options.detached !== false || !same(options.stdio, [exec ? "pipe" : "ignore", "pipe", "pipe"]) || !equalEnv(options.env, env) || exec && !/^[a-f0-9]{48}$/.test(env.OPENCODE_PASSWORD ?? "")) throw refused()
      if (identityOwner && !identityOwner.available()) throw new Error("owned-docker-identity-unavailable")
      let child
      try { child = spawn(binary, [...args], { ...options, env: { ...options.env }, stdio: [...options.stdio] }) }
      catch (cause) { throw new Error("owned-docker-spawn-unavailable", { cause }) }
      const descriptor = exec ? { ...p.descriptor, schema: "oc-owned-launch/1", binding: p.binding, container_id: args.at(-3), context, inputs_sha256: p.inputs_sha256, binaries_sha256: p.binaries_sha256 } : null
      identityOwner?.register(child)
      return ownedHandle(child, readIdentity, descriptor, identityOwner)
    },
  })
}
