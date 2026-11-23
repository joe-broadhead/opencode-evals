// Parent-only, one physical trial. No workload, world or plugin module is imported here.
// Docker, staging, disk checks and finalization are injected; there is no default runtime launch.
import { creationID } from "./container-receipt.mjs"
import { CONTAINER_PATH, EGRESS_URL } from "./container.mjs"
import { parseAllow } from "../../docker/egress-proxy.mjs"
import { isAbsolute, resolve } from "node:path"
import { createHash, randomBytes } from "node:crypto"
import { validateContainedOptions } from "./owned-launch.mjs"

export const OWNED_CONTEXT = "colima-mem-evals-20261122"
export const ownedClock = { now: () => performance.now(), set: (fn, ms) => setTimeout(fn, ms), clear: timer => clearTimeout(timer) }
const beneath = (a, b) => a === b || b.startsWith(`${a}/`)
const cleanPath = p => typeof p === "string" && isAbsolute(p) && resolve(p) === p && !/[,\n\r"\x00]/.test(p)
const unknown = () => ({ complete: false, native: "unknown", observer: "unknown", accounting: { complete: false }, evidence: "unknown" })

export function validateOwnedPlan(p) {
  if (p.context !== OWNED_CONTEXT || !/^sha256:[a-f0-9]{64}$/.test(p.image ?? "") || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(p.user ?? "")) throw new Error("owned container identity/config missing")
  const b = p.binding
  if (!/^[a-f0-9-]{36}$/.test(b?.invocation_id ?? "") || !/^[a-f0-9]{64}$/.test(b?.manifest_sha256 ?? "") || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(b?.trial_id ?? "")) throw new Error("owned binding missing")
  const paths = [p.control, p.store, p.dockerConfig, p.work, p.inputs, p.binaries]
  if (paths.some(p => !cleanPath(p) || p === "/")) throw new Error("owned paths must be canonical")
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) if (beneath(paths[i], paths[j]) || beneath(paths[j], paths[i])) throw new Error("owned mounts overlap control or another root")
  for (const hash of [p.inputs_sha256, p.binaries_sha256]) if (!/^[a-f0-9]{64}$/.test(hash ?? "")) throw new Error("pinned inputs required")
  for (const key of ["timeoutMs", "cleanupMs", "operationMs", "outputBytes"]) if (!Number.isSafeInteger(p[key]) || p[key] <= 0) throw new Error("finite owned bounds required")
  if (p.timeoutMs > 3480000 || p.cleanupMs > 120000 || p.operationMs > 20000 || p.outputBytes > 1048576) throw new Error("owned bounds exceed wave reserve")
  if (!Array.isArray(p.allow) || !p.allow.length || [...parseAllow(p.allow.join(","))].length !== p.allow.length) throw new Error("explicit egress required")
  if (!Array.isArray(p.credentialNames) || p.credentialNames.some(n => !/^[A-Z_][A-Z0-9_]*$/.test(n) || /^(DOCKER|HOME|PATH|NODE|LD_|EVALS|XDG|TMP)/.test(n))) throw new Error("credential names only")
  if (!Array.isArray(p.imageEnv) || p.imageEnv.some(e => !/^PATH=[/a-zA-Z0-9_:-]+$/.test(e)) || p.imageEnv.length !== 1) throw new Error("pinned non-secret image environment required")
  if (!p.descriptor || Object.keys(p.descriptor).some(k => k !== "options")) throw new Error("descriptor options only")
  validateContainedOptions(p.descriptor.options)
  if (p.credentialNames.length !== 1 || `env:${p.credentialNames[0]}` !== p.descriptor.options.auth) throw new Error("descriptor credential name disagrees")
}

/** Strict external Docker inspection. No inner claim is accepted as configuration proof. */
export function verifyOwnedConfig(actual, e) {
  if (actual?.Id !== e.id) return false
  if (e.kind === "network") return actual.Driver === "bridge" && actual.Internal === e.internal && (!e.internal || ["ipv4", "ipv6"].every(v => actual.Options?.[`com.docker.network.bridge.gateway_mode_${v}`] === "isolated"))
  const h = actual.HostConfig, c = actual.Config
  if (!h || !c || actual.Image !== e.image || c.User !== e.user || h.Privileged !== false || h.ReadonlyRootfs !== true || h.NetworkMode !== e.network || h.PidMode || h.IpcMode === "host" || h.UTSMode || h.UsernsMode === "host") return false
  if (JSON.stringify(h.CapDrop) !== '["ALL"]' || h.CapAdd?.length || !h.SecurityOpt?.some(x => /^no-new-privileges(?:=true)?$/.test(x)) || h.SecurityOpt.some(x => /unconfined/.test(x))) return false
  if (h.Memory !== e.memory || h.MemorySwap !== e.memory || h.NanoCpus !== e.cpu || h.PidsLimit !== e.pids || h.Devices?.length || h.DeviceRequests?.length || h.PortBindings && Object.keys(h.PortBindings).length || h.Binds?.length) return false
  if (h.VolumesFrom?.length || h.Links?.length || h.PublishAllPorts || h.AutoRemove || h.OomKillDisable || ![undefined, "", "no"].includes(h.RestartPolicy?.Name) || ![undefined, "", "runc"].includes(h.Runtime)) return false
  if (h.LogConfig?.Type !== "local" || h.LogConfig.Config?.["max-size"] !== "1m" || h.LogConfig.Config?.["max-file"] !== "1") return false
  const networks = Object.values(actual.NetworkSettings?.Networks ?? {}), allowedNetworks = e.networks ?? [e.network]
  if (networks.length !== allowedNetworks.length || networks.some(n => !allowedNetworks.includes(n.NetworkID) && !(e.phase !== "running" && n.NetworkID === ""))) return false
  if (e.phase === "running" && allowedNetworks.some(id => !networks.some(n => n.NetworkID === id))) return false
  if (JSON.stringify(c.Entrypoint) !== JSON.stringify(e.entrypoint) || JSON.stringify(c.Cmd) !== JSON.stringify(e.command) || c.WorkingDir !== e.cwd) return false
  // Exact image environment must be pinned by the caller, not copied from a workload report.
  if (!Array.isArray(e.imageEnv) || JSON.stringify([...(c.Env ?? [])].sort()) !== JSON.stringify([...e.imageEnv].sort())) return false
  const mounts = (actual.Mounts ?? []).filter(m => m.Type !== "tmpfs")
  if ((actual.Mounts ?? []).some(m => m.Type === "tmpfs" && !(m.Destination in e.tmpfs))) return false
  if (mounts.length !== e.mounts.length || mounts.some(m => !e.mounts.some(x => m.Type === "bind" && m.Source === x.source && m.Destination === x.target && m.RW === !x.readonly && ["rprivate", ""].includes(m.Propagation)))) return false
  if (JSON.stringify(h.Tmpfs ?? {}) !== JSON.stringify(e.tmpfs)) return false
  if (actual.State?.Running !== (e.phase === "running") || actual.State?.Status !== (e.phase === "running" ? "running" : "created")) return false
  return true
}

/** All callbacks are parent-owned, bounded, and never loaded from the writable trial root.
 * journal must durably persist before resolving. A pending/unknown create is never cleared by cleanup.
 * finalize receives only this parent's removal proof and must use fixed data-only readers.
 */
export async function containTrial(plan, deps) {
  const p = structuredClone(plan)
  validateOwnedPlan(p)
  const { docker, journal, validateInputs, measure, finalize, inspectConfig = verifyOwnedConfig, clock = ownedClock } = deps
  if (![journal, validateInputs, measure, finalize, docker?.run, docker?.stopClients, docker?.closed].every(f => typeof f === "function")) throw new Error("owned parent interfaces unavailable")
  const started = clock.now(), executionEnd = started + p.timeoutMs, end = executionEnd + p.cleanupMs
  const state = { schema: "oc-evals-owned/1", batch: `b${randomBytes(5).toString("hex")}`, owner: p.binding, context: p.context, resources: [], pending: [], uncertain: false, verified_gone: false }
  let stopped = false, reason = null, worker = null, configProof = null, inputProof = null, final = unknown(), journalOK = true
  const serverPassword = randomBytes(24).toString("hex")
  const timers = new Set()
  const bounded = async (fn, ms, label) => {
    if (!(ms > 0)) throw new Error(`${label}:deadline`)
    const deadline = clock.now() + ms
    let timer
    try {
      const result = await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => { timer = clock.set(() => reject(new Error(`${label}:timeout`)), ms); timers.add(timer) })])
      if (clock.now() > deadline) throw new Error(`${label}:timeout`)
      return result
    }
    finally { clock.clear(timer); timers.delete(timer) }
  }
  const save = async () => {
    try { await bounded(() => journal(structuredClone(state)), Math.min(p.operationMs, end - clock.now()), "journal") }
    catch (e) { journalOK = false; throw e }
  }
  const run = (args, options = {}, cleanup = false) => {
    if (!cleanup && stopped) throw new Error("admission closed")
    const ms = Math.min(options.timeoutMs ?? p.operationMs, (cleanup ? end : executionEnd) - clock.now())
    return bounded(() => docker.run(["--context", p.context, ...args], { ...options, timeoutMs: ms, maxBytes: p.outputBytes }), ms, args[0])
  }
  const create = async (args, expected) => {
    if (stopped) throw new Error("admission closed")
    const pending = `${expected.kind}:${state.resources.length}`
    state.pending.push(pending)
    await save()
    let result
    try { result = await run(args) } catch (e) { state.uncertain = true; throw e }
    const id = creationID(result)
    if (!id) { state.uncertain = true; throw new Error("creation_unknown") }
    state.resources.push({ kind: expected.kind, id, context: p.context })
    // An accepted full own ID is cleanup authority even when client closure/output is uncertain.
    // Retain the pending entry too; no inspect/start/exec may continue from this response.
    if (result.closed !== true || result.overflow === true) {
      state.uncertain = true
      await save()
      throw new Error("creation_unknown")
    }
    state.pending = state.pending.filter(x => x !== pending)
    await save() // record BEFORE inspect, and certainly before start
    const inspected = await run([...(expected.kind === "network" ? ["network"] : []), "inspect", id])
    let data
    try { const list = JSON.parse(inspected.stdout); if (list.length === 1) data = list[0] } catch { /* unknown */ }
    if (inspected.code !== 0 || inspected.closed !== true || !inspectConfig(data, { ...expected, id })) throw new Error("config_rejected")
    return id
  }
  let stopWatch
  const watchdog = new Promise((_, reject) => {
    const fail = code => { stopped = true; reason ??= code; reject(new Error(code)) }
    const cancelled = () => fail("cancelled")
    deps.signal?.addEventListener("abort", cancelled, { once: true })
    if (deps.signal?.aborted) cancelled()
    const deadline = clock.set(() => fail("trial-timeout"), p.timeoutMs)
    let tick
    const check = async () => {
      try { if (await bounded(() => measure(p.work), p.operationMs, "disk") !== true) return fail("disk-limit") }
      catch { return fail("disk-unknown") }
      if (!stopped) tick = clock.set(check, Math.min(1000, p.timeoutMs))
    }
    tick = clock.set(check, 0)
    stopWatch = () => { clock.clear(deadline); clock.clear(tick); deps.signal?.removeEventListener("abort", cancelled) }
  })
  try {
    await Promise.race([watchdog, (async () => {
      if (stopped) throw new Error("admission closed")
      inputProof = await bounded(() => validateInputs(p), p.operationMs, "inputs")
      if (![inputProof?.work?.dev, inputProof?.work?.ino].every(n => Number.isSafeInteger(n) && n >= 0) || inputProof.inputs_sha256 !== p.inputs_sha256 || inputProof.binaries_sha256 !== p.binaries_sha256) throw new Error("inputs_rejected")
      if (await bounded(() => measure(p.work), p.operationMs, "disk") !== true) throw new Error("disk-unknown")
      await save()
      const egress = await create(["network", "create", "--driver", "bridge", `evals-${p.binding.invocation_id}-egress`], { kind: "network", internal: false })
      const network = await create(["network", "create", "--driver", "bridge", "--internal", "-o", "com.docker.network.bridge.gateway_mode_ipv4=isolated", "-o", "com.docker.network.bridge.gateway_mode_ipv6=isolated", `evals-${p.binding.invocation_id}-trial`], { kind: "network", internal: true })
      const makeContainer = async (role, network, mounts, command, cpu, memory, pids, cwd, tmpfs, env = {}) => {
        const expected = { kind: "container", image: p.image, imageEnv: [...(p.imageEnv ?? []), ...Object.entries(env).map(([k,v]) => `${k}=${v}`)], user: p.user, network, mounts, command, entrypoint: ["/usr/bin/tini", "--"], cpu, memory, pids, cwd, tmpfs }
        const id = await create(["create", "--name", `evals-${p.binding.invocation_id}-${role}`, "--network", network, "--user", p.user, "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--log-driver", "local", "--log-opt", "max-size=1m", "--log-opt", "max-file=1", "--log-opt", "compress=false", "--pids-limit", String(pids), "--memory", String(memory), "--memory-swap", String(memory), "--cpus", String(cpu / 1e9), "--workdir", cwd,
          ...Object.entries(tmpfs).flatMap(([target, options]) => ["--tmpfs", `${target}:${options}`]), ...mounts.flatMap(m => ["--mount", `type=bind,src=${m.source},dst=${m.target}${m.readonly ? ",readonly" : ""}`]), ...Object.entries(env).flatMap(([k,v]) => ["-e", `${k}=${v}`]), p.image, ...command], expected)
        return { id, expected }
      }
      const proxy = await makeContainer("proxy", egress, [{ source: `${p.binaries}/node`, target: "/opt/evals/bin/node", readonly: true }], ["/opt/evals/bin/node", "/opt/evals/egress-proxy.mjs", "3128"], 250000000, 268435456, 128, "/", {}, { EVALS_EGRESS_ALLOW: p.allow.join(","), EVALS_EGRESS_MAX_PER_CLIENT: "16", EVALS_EGRESS_MAX_TOTAL: "16" })
      const linked = await run(["network", "connect", "--alias", "egress", network, proxy.id])
      if (linked.code !== 0) throw new Error("proxy-network")
      const proxyStart = await run(["start", proxy.id])
      if (proxyStart.code !== 0) throw new Error("proxy-start")
      const readyBy = Math.min(executionEnd, clock.now() + p.operationMs)
      for (;;) {
        const logs = await run(["logs", proxy.id])
        if (logs.code === 0 && logs.closed === true && logs.stdout.includes('"ev":"listening"')) break
        if (clock.now() >= readyBy) throw new Error("proxy-readiness")
        await bounded(() => new Promise(resolve => { const timer = clock.set(() => { timers.delete(timer); resolve() }, 50); timers.add(timer) }), readyBy - clock.now(), "proxy-readiness")
      }
      const workload = await makeContainer("trial", network, [{ source: p.inputs, target: "/inputs", readonly: true }, { source: p.binaries, target: "/opt/evals/bin", readonly: true }, { source: p.work, target: "/work", readonly: false }], ["sleep", "infinity"], 1500000000, 3221225472, 512, "/work", { "/tmp": "rw,nosuid,nodev,size=256m" })
      configProof = { ...p.binding, id: workload.id, context: p.context, verified: true, expected: workload.expected }
      await save()
      const started = await run(["start", workload.id])
      if (started.code !== 0 || started.closed !== true) throw new Error("start_unknown")
      // Final external proof includes effective network membership after start. A second interface is an escape.
      for (const [resource, networks] of [[proxy, [egress, network]], [workload, [network]]]) {
        const checked = await run(["inspect", resource.id])
        let actual
        try { const list = JSON.parse(checked.stdout); if (list.length === 1) actual = list[0] } catch { /* unknown */ }
        if (checked.code !== 0 || checked.closed !== true || !inspectConfig(actual, { ...resource.expected, id: resource.id, phase: "running", networks })) throw new Error("final-config-rejected")
      }
      const env = { PATH: CONTAINER_PATH, HOME: "/work/home", TMPDIR: "/work/tmp", EVALS_TMP: "/work/tmp", EVALS_STORE: "/work/store", XDG_CONFIG_HOME: "/work/home/.config", XDG_DATA_HOME: "/work/xdg-data", XDG_STATE_HOME: "/work/xdg-state", XDG_CACHE_HOME: "/work/home/.cache", EVALS_CAPS: "/inputs/caps.json", EVALS_MODELS_CATALOG: "/inputs/models.json", EVALS_MODEL_MAP: "/inputs/model-map.json", EVALS_NODE: "/opt/evals/bin/node", EVALS_OPENCODE_BIN: "/opt/evals/bin/opencode", OPENCODE_BIN_2_2_6: "/opt/evals/bin/opencode", OPENCODE_PASSWORD: serverPassword, HTTPS_PROXY: EGRESS_URL, HTTP_PROXY: EGRESS_URL, NO_PROXY: "127.0.0.1,localhost" }
      const descriptor = { ...p.descriptor, schema: "oc-owned-launch/1", binding: p.binding, container_id: workload.id, context: p.context, inputs_sha256: p.inputs_sha256, binaries_sha256: p.binaries_sha256 }
      configProof.launch_sha256 = createHash("sha256").update(JSON.stringify(descriptor)).digest("hex")
      configProof.case_id = descriptor.options.cases
      state.config_proof = structuredClone(configProof)
      state.input_proof = structuredClone(inputProof)
      await save()
      worker = await run(["exec", "-i", "-w", "/work", ...[...Object.keys(env), ...p.credentialNames].flatMap(n => ["-e", n]), workload.id, "/opt/evals/bin/node", "/inputs/harness/scripts/run-contained-trial.mjs"], { env, credentialNames: p.credentialNames, input: JSON.stringify(descriptor), timeoutMs: executionEnd - clock.now() })
      if (worker.closed !== true) throw new Error("worker_exit_unknown")
    })()])
  } catch (error) { reason ??= String(error.message).split(":")[0] }
  finally { stopped = true; stopWatch() }
  // Stop creation before teardown. Exact original client handles, never PID reconstruction.
  let clients = false
  try { clients = await bounded(() => docker.stopClients(), Math.min(p.operationMs, end - clock.now()), "clients") === true } catch { /* unknown */ }
  let removed = true
  for (const r of [...state.resources.filter(r => r.kind === "container").reverse(), ...state.resources.filter(r => r.kind === "network").reverse()]) {
    try {
      if (r.kind === "container") { try { await run(["stop", "--time", "1", r.id], {}, true) } catch { /* still attempt exact removal */ } }
      await run(r.kind === "container" ? ["rm", "-f", "-v", r.id] : ["network", "rm", r.id], {}, true)
      const found = await run([...(r.kind === "network" ? ["network"] : []), "inspect", r.id], {}, true)
      // A daemon error or timeout is never absence. Require the exact missing ID.
      if (found.closed !== true || found.code !== 1 || !new RegExp(`^(?:Error(?: response from daemon)?: )?No such (?:object|container|network): ${r.id}\\s*$`, "i").test(found.stderr)) removed = false
    } catch { removed = false }
  }
  try { clients = await bounded(() => docker.stopClients(), Math.min(p.operationMs, end - clock.now()), "clients") === true && docker.closed() === true } catch { clients = false }
  state.verified_gone = removed && clients && !state.pending.length && !state.uncertain && journalOK
  try { await save() } catch { state.verified_gone = false }
  if (state.verified_gone && configProof) {
    try { final = await bounded(() => finalize({ binding: p.binding, config: configProof, inputs: inputProof, resources: structuredClone(state.resources), cleanup_verified: true, host_clients_closed: true, worker_exit: worker?.code ?? null }, { secrets: [serverPassword] }), Math.min(p.operationMs, end - clock.now()), "finalization") }
    catch { reason ??= "finalization_unknown" }
  }
  for (const timer of timers) clock.clear(timer)
  // Independent native negative evidence may survive a cleanup outage. No output is read to obtain it here.
  if (typeof deps.nativeSnapshot === "function") {
    try { const native = deps.nativeSnapshot(p.binding); if (["failed", "interrupted"].includes(native?.outcome) && Object.keys(p.binding).every(k => native.binding?.[k] === p.binding[k])) final.native = native.outcome } catch { /* unavailable */ }
  }
  // Completion/observer owners are not integrated yet. Cleanup does not imply native success or complete cost.
  return { ...unknown(), ...final, accounting: { ...final.accounting, complete: false }, complete: false, successor_allowed: false, cleanup_verified: state.verified_gone, host_clients_closed: clients, creation_unknown: state.uncertain || !!state.pending.length, reason, worker_exit: worker?.code ?? null, remote_cancellation_guaranteed: false }
}
