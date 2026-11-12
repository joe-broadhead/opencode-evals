// The `container` isolation backend: one Docker container per trial, on its own internal network with no gateway, whose
// only way out is the batch's CONNECT-only egress proxy. The design, its threat model and its proof of concept are in
// docs/running.md#isolation; in short:
//
//   batch   an egress network (an ordinary bridge) and the proxy on it (docker/egress-proxy.mjs, as nobody, read-only,
//           no capabilities), allowing CONNECT to port 443 of the allow-list and nothing else;
//   trial   a network `--internal` with the gateway in `isolated` mode (no host address on the bridge, no route out),
//           the proxy joined to it as `egress`, and a container on it: the caller's uid (never root), read-only root,
//           a small tmpfs /tmp, --cap-drop ALL, no-new-privileges, Docker's default seccomp and AppArmor, pids, memory
//           and CPU limits; the trial sandbox bind-mounted read-write at the same absolute path, the build under test
//           and the harness's scripted-model files read-only at theirs, the host binaries read-only under
//           /opt/evals/bin. Nothing else of the host: no home, no Docker socket.
//
// Every command of a trial runs through `docker exec`, its environment passed by NAME only (`-e NAME`; the values
// travel in the docker client's own environment, never in an argv, and never in `docker run`, so `docker inspect`
// does not show them). Killing a `docker exec` client does not kill what it started inside, so a trial ends with
// `docker rm -f`, on every path: success, failure, timeout, interrupt; a batch whose runner died is swept by the next.

import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { createReadStream, existsSync, readFileSync, realpathSync, statSync, accessSync, constants } from "node:fs"
import { statfs } from "node:fs/promises"
import { delimiter, isAbsolute, join, resolve } from "node:path"
import { parseAllow } from "../../docker/egress-proxy.mjs"
import { repairPermissions } from "./sandbox.mjs"

export const DOCKER_DIR = resolve(import.meta.dirname, "..", "..", "docker")
export const IMAGE_REPO = "opencode-evals-sandbox"
export const DEFAULT_ALLOW = ["api.anthropic.com", "platform.claude.com", "console.anthropic.com", "claude.ai"]
export const DEFAULT_LIMITS = { memory_mb: 4096, cpus: 2, pids: 512, tmpfs_mb: 256, disk_mb: 2048, disk_floor_mb: 2048, max_parallel: 8 }
export const CONTAINER_BIN = "/opt/evals/bin"
export const CONTAINER_PATH = `${CONTAINER_BIN}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`
export const PROXY_PORT = 3128
export const EGRESS_URL = `http://egress:${PROXY_PORT}`
const SERVER_PORT = 4100
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
// The docker client's own settings: never forwarded into a trial, and never taken from one.
const CLIENT_ONLY = /^(DOCKER_|BUILDKIT_|COMPOSE_)/

/** The image tag: a digest of the docker/ directory's two files, so an edit to either makes a new image. */
export function imageTag(dir = DOCKER_DIR) {
  const hash = createHash("sha256")
  for (const file of ["Dockerfile", "egress-proxy.mjs"]) hash.update(`${file}\u0000`).update(readFileSync(join(dir, file))).update("\u0000")
  return `${IMAGE_REPO}:${hash.digest("hex").slice(0, 16)}`
}

const positiveNumber = (value, what) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${what} must be a positive number, not ${JSON.stringify(value)}`)
  return n
}

/**
 * The backend's settings: the egress allow-list and the limits. They come from the owner only, `caps.json`'s
 * `container` section and the environment (which wins), never from a case, an arm or a world.
 *
 *   { "container": { "egress_allow": ["api.anthropic.com", …], "memory_mb": 4096, "cpus": 2, "pids": 512,
 *                    "tmpfs_mb": 256, "disk_mb": 2048, "disk_floor_mb": 2048, "max_parallel": 8, "image": "…" } }
 */
export function containerConfig({ store, env = process.env } = {}) {
  const file = env.EVALS_CAPS ?? (store ? join(store, "caps.json") : null)
  const fromFile = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).container ?? {} : {}
  const limits = { ...DEFAULT_LIMITS }
  const ENV = { memory_mb: "EVALS_CONTAINER_MEMORY_MB", cpus: "EVALS_CONTAINER_CPUS", pids: "EVALS_CONTAINER_PIDS", tmpfs_mb: "EVALS_CONTAINER_TMPFS_MB", disk_mb: "EVALS_CONTAINER_DISK_MB", disk_floor_mb: "EVALS_DISK_FLOOR_MB", max_parallel: "EVALS_CONTAINER_MAX_PARALLEL" }
  for (const [key, name] of Object.entries(ENV)) {
    if (fromFile[key] !== undefined) limits[key] = positiveNumber(fromFile[key], `caps.json container.${key}`)
    if (env[name] !== undefined && env[name] !== "") limits[key] = positiveNumber(env[name], name)
  }
  for (const key of ["memory_mb", "pids", "tmpfs_mb", "disk_mb", "disk_floor_mb", "max_parallel"]) limits[key] = Math.floor(limits[key])
  let allow = DEFAULT_ALLOW
  if (fromFile.egress_allow !== undefined) {
    if (!Array.isArray(fromFile.egress_allow)) throw new Error("caps.json container.egress_allow must be a list of host names")
    allow = fromFile.egress_allow
  }
  if (env.EVALS_EGRESS_ALLOW !== undefined && env.EVALS_EGRESS_ALLOW !== "") allow = env.EVALS_EGRESS_ALLOW.split(",")
  const hosts = [...parseAllow(allow.join(","))].sort()
  return { allow: hosts, limits, image: env.EVALS_CONTAINER_IMAGE ?? fromFile.image ?? null, docker: env.EVALS_DOCKER ?? "docker", source: Object.keys(fromFile).length ? file : null }
}

/** A command on a PATH, as its real absolute path, or null. */
export function findBinary(command, path = process.env.PATH ?? "") {
  if (!command) return null
  const candidates = command.includes("/") ? [resolve(command)] : path.split(delimiter).filter(Boolean).map((dir) => join(dir, command))
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
      const real = realpathSync(candidate)
      if (statSync(real).isFile()) return real
    } catch {
      // not here
    }
  }
  return null
}

const sha256File = (file) =>
  new Promise((done, fail) => {
    const hash = createHash("sha256")
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", fail).on("end", () => done(hash.digest("hex")))
  })

/** A process's start time (Linux /proc), so a reused pid is not taken for a live runner. */
export function processStart(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null
  } catch {
    return null
  }
}

const alive = (pid, start) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
  } catch (error) {
    if (error.code !== "EPERM") return false
  }
  return !start || processStart(pid) === null || processStart(pid) === start
}

/** Runs the docker client. Resolves { code, stdout, stderr }; never rejects. */
export function dockerRun(docker, args, { env, input = null, timeoutMs = 120_000 } = {}) {
  return new Promise((done) => {
    const child = spawn(docker, args, { env, stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (data) => (stdout += data))
    child.stderr.on("data", (data) => (stderr += data))
    if (input !== null) {
      child.stdin.on("error", () => {})
      child.stdin.end(input)
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs)
    child.on("error", (error) => {
      clearTimeout(timer)
      done({ code: null, stdout, stderr: String(error.message ?? error) })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      done({ code, stdout, stderr })
    })
  })
}

/** Disk use of a tree in bytes, not following links or crossing filesystems; null when it cannot be measured. */
export async function diskUse(root, docker = null) {
  const measure = () =>
    new Promise((done) => {
      const child = spawn("du", ["-s", "-k", "-x", root], { stdio: ["ignore", "pipe", "pipe"] })
      let out = ""
      let err = ""
      child.stdout.on("data", (d) => (out += d))
      child.stderr.on("data", (d) => (err += d))
      child.on("error", () => done({ bytes: null, denied: false }))
      child.on("close", (code) => {
        const kb = Number((/^(\d+)/.exec(out) ?? [])[1])
        done({ bytes: Number.isFinite(kb) ? kb * 1024 : null, denied: code !== 0 && /denied/i.test(err) })
      })
    })
  let result = await measure()
  // A directory the agent made unreadable (chmod 000) hides what is under it: give the owner back access and measure again.
  if (result.denied) {
    repairPermissions(root)
    result = await measure()
  }
  return result.bytes
}

/**
 * The backend. `config` is containerConfig()'s result; `exec` replaces the docker client in a unit test.
 */
export function containerBackend(config = containerConfig()) {
  const id = `b${randomBytes(5).toString("hex")}`
  const labels = { "evals.batch": id, "evals.pid": String(process.pid), "evals.pidstart": processStart(process.pid) ?? "" }
  const labelArgs = (extra = {}) => Object.entries({ ...labels, ...extra }).flatMap(([key, value]) => ["--label", `${key}=${value}`])
  const proxyName = `evals-${id}-proxy`
  const egressNet = `evals-${id}-egress`
  const trials = new Set()
  const state = { prepared: false, tornDown: false, docker: null, dockerEnv: null, image: null, imageId: null, version: null, binaries: new Map(), shas: {}, batchRoot: null, egress: null, log: () => {} }
  let counter = 0

  const docker = (args, options = {}) => dockerRun(state.docker, args, { env: state.dockerEnv, ...options })
  const must = async (args, what, options) => {
    const result = await docker(args, options)
    if (result.code !== 0) throw new Error(`${what} failed: ${(result.stderr || result.stdout).trim().slice(-400)}`)
    return result.stdout.trim()
  }

  /** Removes everything a batch whose runner is gone left behind, and everything labelled with this batch when `own`. */
  async function sweep({ own = false } = {}) {
    const removed = { containers: 0, networks: 0 }
    for (const kind of ["container", "network"]) {
      const listed = kind === "container" ? ["ps", "-a"] : ["network", "ls"]
      const out = await docker([...listed, "--filter", "label=evals.batch", "--format", '{{.ID}}\t{{.Label "evals.batch"}}\t{{.Label "evals.pid"}}\t{{.Label "evals.pidstart"}}'])
      if (out.code !== 0) continue
      for (const line of out.stdout.split("\n").filter(Boolean)) {
        const [ref, batch, pid, start] = line.split("\t")
        const mine = batch === id
        if (mine ? !own : alive(Number(pid), start)) continue
        const result = kind === "container" ? await docker(["rm", "-f", "-v", ref]) : await docker(["network", "rm", ref])
        if (result.code === 0) removed[`${kind}s`]++
      }
    }
    return removed
  }

  async function proxyLog() {
    const out = await docker(["logs", proxyName], { timeoutMs: 20_000 })
    if (out.code !== 0) return null
    const report = { allow: config.allow, allowed: {}, refused: {}, failed: {} }
    let distinct = 0
    for (const line of out.stdout.split("\n")) {
      let entry
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      const bucket = { allowed: report.allowed, refused: report.refused, failed: report.failed }[entry.ev]
      if (!bucket || typeof entry.host !== "string") continue
      const host = entry.host.slice(0, 253) || "(none)"
      if (!bucket[host]) {
        // A refused name can carry data (a secret in a subdomain): the record keeps at most 200 distinct names, and is
        // scrubbed of every known secret like everything else the runner writes.
        if (++distinct > 200) continue
        bucket[host] = entry.ev === "allowed" ? 0 : { count: 0, why: [] }
      }
      if (entry.ev === "allowed") bucket[host]++
      else {
        bucket[host].count++
        if (entry.why && !bucket[host].why.includes(entry.why)) bucket[host].why.push(String(entry.why).slice(0, 40))
      }
    }
    return report
  }

  const backend = {
    name: "container",
    confines: true,
    batchLabel: id,
    config,
    maxParallel: config.limits.max_parallel,

    /** Finds the docker client and its own settings. The client reads its config from DOCKER_CONFIG, never from a
     * trial's HOME, which the agent controls. */
    client(caller = process.env) {
      state.docker = findBinary(config.docker, caller.PATH)
      if (!state.docker) throw new Error(`--isolation container: no docker client (${config.docker}) on PATH`)
      state.dockerEnv = { PATH: caller.PATH ?? "/usr/bin:/bin", DOCKER_CONFIG: caller.DOCKER_CONFIG ?? join(caller.HOME ?? "/nonexistent", ".docker") }
      for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) if (caller[key]) state.dockerEnv[key] = caller[key]
      return { docker: state.docker, env: state.dockerEnv }
    },

    /** Removes what batches whose runner is gone left behind (`evals isolation sweep`, and every prepare). */
    sweep: () => sweep(),

    /**
     * Checks Docker and the image, sweeps what dead batches left, records the binaries, and starts the egress proxy.
     * `binaries` maps a name (opencode, claude, bun) to a host command; a missing one that is required throws.
     */
    async prepare({ batchRoot, caller = process.env, binaries = {}, log = () => {} } = {}) {
      if (state.prepared) return backend.describe()
      state.log = log
      state.batchRoot = batchRoot
      if (typeof process.getuid === "function" && process.getuid() === 0) throw new Error("--isolation container: refusing to run trials as root; run the harness as an ordinary user in the docker group")
      if (/[,\n"]/.test(batchRoot ?? "")) throw new Error(`--isolation container: the batch directory ${JSON.stringify(batchRoot)} has a comma, quote or newline, which a bind mount cannot name: set EVALS_TMP to a plainer path`)
      backend.client(caller)
      const version = await docker(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 20_000 })
      if (version.code !== 0) throw new Error(`--isolation container: Docker is not usable by this user (${(version.stderr || "no answer").trim().slice(-200)}); is the daemon running, and is this user in the docker group?`)
      state.version = version.stdout.trim()
      const major = Number((/^(\d+)/.exec(state.version) ?? [])[1])
      if (!(major >= 28)) throw new Error(`--isolation container: Docker ${state.version} is too old; the isolated gateway mode a trial network needs is Docker 28 or later`)
      state.image = config.image ?? imageTag()
      const image = await docker(["image", "inspect", "--format", "{{.Id}}", state.image], { timeoutMs: 20_000 })
      if (image.code !== 0) throw new Error(`--isolation container: no image ${state.image}; build it with \`evals isolation build\` (from docker/Dockerfile, no secrets)`)
      state.imageId = image.stdout.trim()
      for (const [name, command] of Object.entries(binaries)) {
        if (!command) continue
        const real = findBinary(command, caller.PATH)
        if (!real) throw new Error(`--isolation container: no ${name} binary (${command}) to mount into the trials`)
        state.binaries.set(name, { host: real, command, inside: `${CONTAINER_BIN}/${name}` })
        state.shas[name] = await sha256File(real)
      }
      const swept = await sweep()
      if (swept.containers || swept.networks) log(`isolation: removed ${swept.containers} container(s) and ${swept.networks} network(s) left by a batch whose runner is gone`)
      state.prepared = true
      await must(["network", "create", "--driver", "bridge", ...labelArgs({ "evals.role": "egress" }), egressNet], "creating the egress network")
      await must(
        ["run", "-d", "--name", proxyName, ...labelArgs({ "evals.role": "proxy" }), "--network", egressNet, "--user", "65534:65534", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "256m", "--cpus", "1", "-e", `EVALS_EGRESS_ALLOW=${config.allow.join(",")}`, state.image, "node", "/opt/evals/egress-proxy.mjs", String(PROXY_PORT)],
        "starting the egress proxy",
      )
      const deadline = Date.now() + 15_000
      for (;;) {
        const logs = await docker(["logs", proxyName], { timeoutMs: 5000 })
        if (logs.stdout.includes('"ev":"listening"')) break
        if (Date.now() > deadline) throw new Error(`the egress proxy did not start: ${(logs.stderr || logs.stdout).trim().slice(-300)}`)
        await new Promise((done) => setTimeout(done, 100))
      }
      return backend.describe()
    },

    /** A trial: its own network and container, with the sandbox (rw) and `mounts` (ro) at their own paths. */
    async enter({ name, sandbox, mounts = [], cwd }) {
      if (!state.prepared || state.tornDown) throw new Error("the container backend is not prepared")
      const root = resolve(sandbox.root)
      for (const path of [root, ...mounts.map((m) => m.host)]) if (/[,\n"]/.test(path)) throw new Error(`a bind mount cannot name ${JSON.stringify(path)}`)
      const n = ++counter
      const ref = `evals-${id}-t${n}`
      const enteredAt = Date.now()
      const trial = {
        name,
        ref,
        container: null,
        network: null,
        killed: null,
        timings: { setup_ms: null, teardown_ms: null },
        left: false,
        watchdog: null,
      }
      trials.add(trial)
      const leave = async ({ reason = "end" } = {}) => {
        if (trial.left) return
        trial.left = true
        if (trial.watchdog) clearInterval(trial.watchdog)
        const at = Date.now()
        if (trial.container) await docker(["rm", "-f", "-v", trial.container], { timeoutMs: 60_000 })
        if (trial.network) {
          await docker(["network", "disconnect", "-f", trial.network, proxyName], { timeoutMs: 30_000 })
          await docker(["network", "rm", trial.network], { timeoutMs: 30_000 })
        }
        trial.timings.teardown_ms = Date.now() - at
        trial.leftFor = reason
        trials.delete(trial)
      }
      trial.leave = leave
      try {
        await must(["network", "create", "--internal", "-o", "com.docker.network.bridge.gateway_mode_ipv4=isolated", "-o", "com.docker.network.bridge.gateway_mode_ipv6=isolated", ...labelArgs({ "evals.role": "trial", "evals.trial": name }), ref], "creating the trial network")
        trial.network = ref
        await must(["network", "connect", "--alias", "egress", ref, proxyName], "joining the proxy to the trial network")
        const { memory_mb, cpus, pids, tmpfs_mb } = config.limits
        const binds = [
          ["--mount", `type=bind,src=${root},dst=${root}`],
          ...mounts.map((m) => ["--mount", `type=bind,src=${resolve(m.host)},dst=${resolve(m.host)},readonly`]),
          ...[...state.binaries.values()].map((b) => ["--mount", `type=bind,src=${b.host},dst=${b.inside},readonly`]),
        ].flat()
        const uid = typeof process.getuid === "function" ? `${process.getuid()}:${process.getgid()}` : "1000:1000"
        const created = await must(
          ["run", "-d", "--name", ref, ...labelArgs({ "evals.role": "trial", "evals.trial": name }), "--network", ref, "--hostname", "evals", "--user", uid, "--read-only", "--tmpfs", `/tmp:rw,nosuid,nodev,size=${tmpfs_mb}m`, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", String(pids), "--memory", `${memory_mb}m`, "--memory-swap", `${memory_mb}m`, "--cpus", String(cpus), ...binds, "--workdir", root, state.image],
          "starting the trial container",
        )
        trial.container = created.split("\n").pop()
      } catch (error) {
        await leave({ reason: "failed to start" })
        throw error
      }
      trial.timings.setup_ms = Date.now() - enteredAt

      // The disk watchdog: the sandbox is on the host's disk, which no quota bounds without root, so a trial that
      // grows past its limit, or leaves the filesystem short, is removed and recorded as killed.
      const diskLimit = config.limits.disk_mb * 1024 * 1024
      const floor = config.limits.disk_floor_mb * 1024 * 1024
      let measuring = false
      trial.checkDisk = async () => {
        if (measuring || trial.left) return
        measuring = true
        try {
          const bytes = await diskUse(root)
          if (bytes !== null && bytes > diskLimit) {
            trial.killed = { reason: "disk", bytes, limit_bytes: diskLimit }
            state.log(`  ${name}: the sandbox reached ${Math.round(bytes / 1048576)} MB, over its ${config.limits.disk_mb} MB: the trial is stopped`)
            await leave({ reason: "disk" })
            return
          }
          const fs = await statfs(root).catch(() => null)
          if (fs && fs.bavail * fs.bsize < floor) {
            trial.killed = { reason: "disk-floor", free_bytes: fs.bavail * fs.bsize, floor_bytes: floor }
            state.log(`  ${name}: the filesystem under the sandboxes has less than ${config.limits.disk_floor_mb} MB free: the trial is stopped`)
            await leave({ reason: "disk-floor" })
          }
        } finally {
          measuring = false
        }
      }
      trial.watchdog = setInterval(() => trial.checkDisk(), config.watchMs ?? 2000)
      trial.watchdog.unref?.()

      /** The command that runs `spec` inside the container; secrets and everything else by name only. */
      trial.wrap = ({ command, args = [], cwd: dir, env = {} }) => {
        const mapped = [...state.binaries.values()].find((b) => b.command === command || b.host === command || (isAbsolute(command) && existsSync(command) && realpathSync(command) === b.host))
        const inside = mapped ? mapped.inside : command
        const containerEnv = trialEnv(env)
        const names = Object.keys(containerEnv)
        const bad = names.filter((key) => !NAME.test(key))
        if (bad.length) throw new Error(`refusing to pass ${bad.map((k) => JSON.stringify(k)).join(", ")} into a trial: not a variable name`)
        return {
          command: state.docker,
          args: ["exec", "-i", "-w", dir ?? cwd ?? root, ...names.flatMap((key) => ["-e", key]), trial.container, inside, ...args],
          // The docker client runs in the batch directory, outside every sandbox, with its own settings.
          cwd: state.batchRoot ?? undefined,
          env: { ...containerEnv, ...state.dockerEnv, PATH: containerEnv.PATH },
        }
      }

      trial.port = (attempt = 0) => SERVER_PORT + attempt

      /**
       * Polls a URL from inside the container (the host has no route to it) until it answers 200. The password, when
       * there is one, goes to curl on its standard input, never in an argv.
       */
      trial.ready = async ({ url, password = null, directory = null, timeoutMs = 60_000, exited = () => false } = {}) => {
        const deadline = Date.now() + timeoutMs
        let last = ""
        while (!exited() && !trial.left && Date.now() < deadline) {
          const args = ["exec", "-i", trial.container, "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "2", "--noproxy", "*", "--config", "-", ...(directory ? ["-H", `x-opencode-directory: ${directory}`] : []), url]
          const result = await docker(args, { input: password ? `user = "opencode:${password}"\n` : "", timeoutMs: 10_000 })
          if (result.stdout.trim() === "200") return { ok: true }
          last = result.stdout.trim() ? `HTTP ${result.stdout.trim()}` : (result.stderr.trim().slice(-200) || `curl exit ${result.code}`)
          await new Promise((done) => setTimeout(done, 200))
        }
        return { ok: false, last: trial.left ? `the trial was stopped (${trial.leftFor ?? "left"})` : exited() ? "the server exited" : `no answer in ${timeoutMs} ms (${last})` }
      }

      /** How many processes the memory limit killed (cgroup v2 memory.events), or null when it cannot be read. */
      trial.oomKills = async () => {
        if (trial.left) return null
        const result = await docker(["exec", trial.container, "cat", "/sys/fs/cgroup/memory.events"], { timeoutMs: 10_000 })
        const kills = (/^oom_kill (\d+)/m.exec(result.stdout) ?? [])[1]
        return kills === undefined ? null : Number(kills)
      }

      trial.describe = () => ({ container: trial.ref, setup_ms: trial.timings.setup_ms, teardown_ms: trial.timings.teardown_ms, ...(trial.killed ? { killed: trial.killed } : {}) })
      return trial
    },

    /** Leaves every trial still up, collects the proxy's decisions, removes the proxy, its network and every label. */
    async teardown() {
      if (state.tornDown) return
      state.tornDown = true
      if (!state.docker) return
      await Promise.all([...trials].map((trial) => trial.leave({ reason: "teardown" })))
      if (state.prepared) state.egress = await proxyLog()
      await docker(["rm", "-f", "-v", proxyName], { timeoutMs: 60_000 })
      await docker(["network", "rm", egressNet], { timeoutMs: 30_000 })
      await sweep({ own: true })
    },

    /** What the proxy allowed and refused, by host name: after teardown. */
    egress: () => state.egress,

    describe: () => ({
      backend: "container",
      batch_label: id,
      docker: state.version,
      image: state.image,
      image_id: state.imageId,
      network: "per-trial --internal network, isolated gateway; egress only through the batch's CONNECT proxy",
      egress_allow: config.allow,
      limits: config.limits,
      binaries: state.shas,
    }),
  }
  return backend
}

/**
 * A trial's environment from the sandbox's: the container's PATH, the proxy, loopback never proxied, no host path that
 * does not exist inside (CA files), no docker client setting, and no models.dev fetch (the proxy would refuse it).
 */
export function trialEnv(env) {
  const out = {}
  for (const [key, value] of Object.entries(env)) if (!CLIENT_ONLY.test(key) && value !== undefined && value !== null) out[key] = String(value)
  delete out.SSL_CERT_FILE
  delete out.NODE_EXTRA_CA_CERTS
  out.PATH = CONTAINER_PATH
  for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) out[key] = EGRESS_URL
  out.NO_PROXY = out.no_proxy = "127.0.0.1,localhost"
  out.OPENCODE_DISABLE_MODELS_FETCH = "1"
  return out
}

/** Builds the sandbox image from docker/ (its only build context: nothing else of the machine reaches it). */
export async function buildImage({ caller = process.env, config = containerConfig({ env: caller }), log = (line) => console.log(line) } = {}) {
  const backend = containerBackend(config)
  const { docker, env } = backend.client(caller)
  const tag = config.image ?? imageTag()
  log(`building ${tag} from ${DOCKER_DIR}`)
  const status = await new Promise((done) => {
    const child = spawn(docker, ["build", "--pull=false", "-t", tag, DOCKER_DIR], { env, stdio: ["ignore", "inherit", "inherit"] })
    child.on("error", () => done(null))
    child.on("close", (code) => done(code))
  })
  if (status !== 0) throw new Error(`docker build failed (exit ${status})`)
  return tag
}

/** Docker, its version, the image and the settings, without starting anything. */
export async function checkIsolation({ caller = process.env, config = containerConfig({ env: caller }) } = {}) {
  const backend = containerBackend(config)
  const { docker, env } = backend.client(caller)
  const version = await dockerRun(docker, ["version", "--format", "{{.Server.Version}}"], { env, timeoutMs: 20_000 })
  const tag = config.image ?? imageTag()
  const image = version.code === 0 ? await dockerRun(docker, ["image", "inspect", "--format", "{{.Id}}", tag], { env, timeoutMs: 20_000 }) : { code: 1 }
  return {
    docker: version.code === 0 ? version.stdout.trim() : null,
    docker_error: version.code === 0 ? null : (version.stderr || "no answer").trim().slice(-200),
    image: tag,
    image_id: image.code === 0 ? image.stdout.trim() : null,
    egress_allow: config.allow,
    limits: config.limits,
    settings: config.source,
  }
}
