#!/usr/bin/env node
// Opt-in only. Importing this module never starts a process.
import { readFileSync, writeFileSync, mkdirSync, realpathSync, rmSync, existsSync, lstatSync } from "node:fs"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { qualifyWave, sha256 } from "../src/run/wave-manifest.mjs"
import { bindNativeQualification } from "../src/run/native-qualification.mjs"
import { launchWave, runTrials, cleanupOwned, writeJSON, systemClock } from "../src/run/wave-launcher.mjs"
import { processAdapter, requestTrialVerification } from "../src/run/wave-process.mjs"

const HARNESS = resolve(import.meta.dirname, "..")
function checkIdentity() {
  const git = args => {
    const result = spawnSync("git", args, { cwd: HARNESS, encoding: "utf8", timeout: 5000, env: { PATH: process.env.PATH, GIT_OPTIONAL_LOCKS: "0" } })
    if (result.status !== 0) throw new Error("cannot verify harness identity")
    return result.stdout.trim()
  }
  if (git(["status", "--porcelain"])) throw new Error("wave requires a clean committed harness")
  return { harnessSha: git(["rev-parse", "HEAD"]), launcherNodeSha: sha256(readFileSync(realpathSync(process.execPath))) }
}

export async function main(argv, { env = process.env, adapter = processAdapter(), identity = checkIdentity, qualify = qualifyWave, clock = systemClock, nativeQualification = bindNativeQualification } = {}) {
  if (typeof env.OPENCODE_API_KEY !== "string" || !env.OPENCODE_API_KEY.trim()) throw new Error("OPENCODE_API_KEY is required")
  const worker = argv[0] === "--worker"
  const owned = !worker && adapter.owned
  if (argv.length !== 2 || !["--manifest", "--worker"].includes(argv[0])) throw new Error("usage: run-mem-wave.mjs --manifest /absolute/reviewed-wave.json")
  let stop = false, channelLost = false
  const cancellation = new AbortController()
  const channelBound = worker || owned && typeof process.send === "function"
  const onSignal = () => { stop = true; cancellation.abort() }
  const onDisconnect = () => { channelLost = true; cancellation.abort() }
  const stopRequested = () => {
    if (channelBound && !process.connected) onDisconnect()
    return stop || channelLost
  }
  if (channelBound) process.on("disconnect", onDisconnect)
  try {
    if (worker && stopRequested()) throw new Error("worker requires its supervising parent IPC channel")
    // The start gate is temporary; channel loss remains sticky until the worker exits.
    if (worker) await new Promise((resolve, reject) => {
      const finish = error => {
        process.removeListener("message", onStart)
        process.removeListener("disconnect", beforeStartDisconnect)
        if (error) reject(error)
        else resolve()
      }
      const onStart = value => finish(value?.type === "start" ? null : new Error("invalid worker start"))
      const beforeStartDisconnect = () => finish(new Error("supervisor disconnected before start"))
      process.once("message", onStart)
      process.once("disconnect", beforeStartDisconnect)
    })
    process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal)
    const bytes = readFileSync(argv[1]), manifestSha = sha256(bytes), wave = JSON.parse(bytes)
    if (bytes.includes(Buffer.from(env.OPENCODE_API_KEY))) throw new Error("credential must not occur in manifest")
    if (worker && env.MEM_WAVE_MANIFEST_SHA !== manifestSha) throw new Error("frozen manifest changed")
    // The owned path's execution_qualified comes only from the dispatch-time live
    // qualification binding of the owner-supplied record — never from a manifest or
    // environment boolean. Pure manifest validation precedes any native consideration.
    let native = null
    if (owned) {
      try { qualify(wave, { harnessSha: wave.harness_sha, launcherNodeSha: sha256(readFileSync(realpathSync(process.execPath))) }) }
      catch { native = { matched: false, reason: "manifest-unqualified" } }
      if (!native) native = await nativeQualification(wave, { runId: `wave-${wave.id}`, sourcePath: join(HARNESS, "native", "darwin-process-identity.c") })
    }
    const verify = () => {
      if (sha256(readFileSync(argv[1])) !== manifestSha) throw new Error("manifest changed")
      // Pure qualification must finish before even the Git identity subprocess is considered.
      const qualified = qualify(wave, { harnessSha: wave.harness_sha, launcherNodeSha: sha256(readFileSync(realpathSync(process.execPath))) })
      if (owned ? native?.matched !== true : qualified.execution_qualified !== true) throw new Error("native recorder handshake is not qualified")
      if (owned ? typeof owned.snapshot !== "function" || typeof owned.spawn !== "function" : adapter.supervisionAvailable === false) throw new Error("native supervision or approved staging is unavailable")
      const checked = qualify(wave, identity())
      if (!owned && checked.execution_qualified !== true) throw new Error("runtime qualification changed")
      return checked
    }
    if (owned) return await launchWave(wave, {
      manifestSha, singleton: join(wave.docker_config, ".oc-mem-wave.lock"), verify, native, stopRequested, clock, owned, caller: env, abortSignal: cancellation.signal,
      allocate: () => writeFileSync(join(wave.control, "manifest.json"), bytes, { flag: "wx", mode: 0o600 }),
    })
    if (worker) {
      const stamp = JSON.parse(readFileSync(join(wave.control, "wave.json"), "utf8"))
      if (stamp.manifest_sha256 !== manifestSha || stamp.store !== wave.store) throw new Error("wave lease mismatch")
      const elapsedAtStart = Math.max(0, clock.wall() - stamp.started_wall), mono = clock.monotonic()
      const lease = { elapsed: () => Math.max(clock.wall() - stamp.started_wall, elapsedAtStart + clock.monotonic() - mono) }
      const { plan } = verify()
      const report = await runTrials(wave, plan, { harness: HARNESS, caller: env, lease, verify, stopRequested,
        verifyTrial: trial => requestTrialVerification(process, trial.id),
        save: value => writeJSON(join(wave.control, "progress.json"), value),
        execute: async (spec, trial) => {
          if (stopRequested()) return { code: null, complete: false }
          writeFileSync(join(wave.control, "resources", `${trial.id}.started.json`), JSON.stringify({ owner: JSON.parse(spec.env.EVALS_CONTAINER_OWNER) }), { flag: "wx", mode: 0o600 })
          return { ...await adapter.trial(spec), complete: true } // Parent checks artifacts and its original scope before admission.
        },
      })
      return report
    }
    let runtimeOwned = null
    const runtime = join(wave.control, "runtime"), frozen = join(wave.control, "manifest.json")
    return await launchWave(wave, {
      manifestSha, clock, singleton: join(wave.docker_config, ".oc-mem-wave.lock"), stopRequested,
      verify,
      allocate: async () => {
        writeFileSync(frozen, bytes, { flag: "wx", mode: 0o600 })
        mkdirSync(runtime, { mode: 0o700 }); runtimeOwned = lstatSync(runtime)
        for (const dir of ["home", "tmp", "sandboxes"]) mkdirSync(join(runtime, dir), { mode: 0o700 })
      },
      spawnWorker: (_lease, scope, verifyTrial) => adapter.worker({ command: wave.runtime.launcher_node.path, args: [import.meta.filename, "--worker", frozen], cwd: HARNESS, ipc: true, verifyTrial,
        env: { PATH: env.PATH ?? "/usr/bin:/bin", HOME: join(runtime, "home"), TMPDIR: join(runtime, "tmp"), OPENCODE_API_KEY: env.OPENCODE_API_KEY, MEM_WAVE_MANIFEST_SHA: manifestSha, MEM_WAVE_OWNER: JSON.stringify(scope.owner) } }),
      alive: adapter.alive, signal: adapter.signal,
      cleanup: async (remaining, scope) => {
        const clean = await cleanupOwned(scope, (args, timeout) => adapter.command({ command: wave.runtime.docker.path, args, env: { PATH: env.PATH ?? "/usr/bin:/bin", DOCKER_CONFIG: wave.docker_config } }, timeout), remaining)
        writeJSON(join(wave.control, "cleanup-clients.json"), { unverified_pids: adapter.unverified() })
        if (!clean || adapter.unverified().length) return false
        if (runtimeOwned) {
          const current = lstatSync(runtime)
          if (!current.isDirectory() || current.dev !== runtimeOwned.dev || current.ino !== runtimeOwned.ino || realpathSync(runtime) !== resolve(runtime)) return false
          rmSync(runtime, { recursive: true })
        }
        return !existsSync(runtime)
      },
    })
  } finally {
    process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal)
    if (channelBound) process.removeListener("disconnect", onDisconnect)
    if (worker && process.connected) process.disconnect()
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(report => { process.exitCode = report.complete === true || process.argv[2] === "--worker" && !report.stop_reason ? 0 : 1 }).catch(() => {
    // Exception text and child output may contain credentials. Neither is a reporting channel.
    console.error("Memory wave refused or incomplete. Reports exist only after qualified allocation. No automatic retry.")
    process.exitCode = 1
  })
}
