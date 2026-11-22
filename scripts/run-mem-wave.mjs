#!/usr/bin/env node
// Opt-in only. Importing this module never starts a process.
import { readFileSync, writeFileSync, mkdirSync, realpathSync, rmSync, existsSync } from "node:fs"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { qualifyWave, sha256 } from "../src/run/wave-manifest.mjs"
import { launchWave, runTrials, trialComplete, cleanupOwned, writeJSON, systemClock } from "../src/run/wave-launcher.mjs"
import { processAdapter } from "../src/run/wave-process.mjs"

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

export async function main(argv, { env = process.env, adapter = processAdapter(), identity = checkIdentity, qualify = qualifyWave, clock = systemClock } = {}) {
  if (typeof env.OPENCODE_API_KEY !== "string" || !env.OPENCODE_API_KEY.trim()) throw new Error("OPENCODE_API_KEY is required")
  const worker = argv[0] === "--worker"
  if (argv.length !== 2 || !["--manifest", "--worker"].includes(argv[0])) throw new Error("usage: run-mem-wave.mjs --manifest /absolute/reviewed-wave.json")
  if (worker && !process.connected) throw new Error("worker requires its supervising parent IPC channel")
  // The parent releases this gate only after persisting the exact new PGID.
  if (worker) await new Promise((resolve, reject) => {
    process.once("message", value => value?.type === "start" ? resolve() : reject(new Error("invalid worker start")))
    process.once("disconnect", () => reject(new Error("supervisor disconnected before start")))
  })
  const bytes = readFileSync(argv[1]), manifestSha = sha256(bytes), wave = JSON.parse(bytes)
  if (bytes.includes(Buffer.from(env.OPENCODE_API_KEY))) throw new Error("credential must not occur in manifest")
  if (worker && env.MEM_WAVE_MANIFEST_SHA !== manifestSha) throw new Error("frozen manifest changed")
  let stop = false
  const onSignal = () => { stop = true }
  process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal)
  const verify = () => {
    if (sha256(readFileSync(argv[1])) !== manifestSha) throw new Error("manifest changed")
    const qualified = qualify(wave, identity())
    if (qualified.execution_qualified !== true) throw new Error("native recorder handshake is not qualified")
    return qualified
  }
  try {
    if (worker) {
      const stamp = JSON.parse(readFileSync(join(wave.control, "wave.json"), "utf8"))
      if (stamp.manifest_sha256 !== manifestSha || stamp.store !== wave.store) throw new Error("wave lease mismatch")
      const elapsedAtStart = Math.max(0, clock.wall() - stamp.started_wall), mono = clock.monotonic()
      const lease = { elapsed: () => Math.max(clock.wall() - stamp.started_wall, elapsedAtStart + clock.monotonic() - mono) }
      const { plan } = verify()
      const report = await runTrials(wave, plan, { harness: HARNESS, caller: env, lease, verify, stopRequested: () => stop,
        save: value => writeJSON(join(wave.control, "progress.json"), value),
        execute: async (spec, trial) => ({ ...await adapter.trial(spec), complete: trialComplete(wave, trial) }),
      })
      process.disconnect()
      return report
    }
    let runtimeOwned = false
    const runtime = join(wave.control, "runtime"), frozen = join(wave.control, "manifest.json")
    return await launchWave(wave, {
      manifestSha, clock, singleton: join(wave.docker_config, ".oc-mem-wave.lock"), stopRequested: () => stop,
      verify: async () => {
        verify()
        writeFileSync(frozen, bytes, { flag: "wx", mode: 0o600 })
        mkdirSync(runtime, { mode: 0o700 }); runtimeOwned = true
        for (const dir of ["home", "tmp", "sandboxes"]) mkdirSync(join(runtime, dir), { mode: 0o700 })
        mkdirSync(join(wave.control, "resources"), { mode: 0o700 })
      },
      spawnWorker: () => adapter.worker({ command: wave.runtime.launcher_node.path, args: [import.meta.filename, "--worker", frozen], cwd: HARNESS, ipc: true,
        env: { PATH: env.PATH ?? "/usr/bin:/bin", HOME: join(runtime, "home"), TMPDIR: join(runtime, "tmp"), OPENCODE_API_KEY: env.OPENCODE_API_KEY, MEM_WAVE_MANIFEST_SHA: manifestSha } }),
      alive: adapter.alive, signal: adapter.signal,
      cleanup: async remaining => {
        const clean = await cleanupOwned(wave, wave.control, (args, timeout) => adapter.command({ command: wave.runtime.docker.path, args, env: { PATH: env.PATH ?? "/usr/bin:/bin", DOCKER_CONFIG: wave.docker_config } }, timeout), remaining)
        writeJSON(join(wave.control, "cleanup-clients.json"), { unverified_pids: adapter.unverified() })
        if (!clean || adapter.unverified().length) return false
        if (runtimeOwned && realpathSync(runtime) === resolve(runtime)) rmSync(runtime, { recursive: true })
        return !existsSync(runtime)
      },
    })
  } finally {
    if (worker && process.connected) process.disconnect()
    process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(report => { process.exitCode = report.complete === true || process.argv[2] === "--worker" && !report.stop_reason ? 0 : 1 }).catch(() => {
    // Exception text and child output may contain credentials. Neither is a reporting channel.
    console.error("Memory wave refused or incomplete; inspect the owned control report. No automatic retry.")
    process.exitCode = 1
  })
}
