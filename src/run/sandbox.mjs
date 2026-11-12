// One sandbox per (case, trial): its own HOME, XDG tree, TMPDIR and OpenCode database, a sealed config, and a minimal
// environment, the same isolation T1 uses (src/t1/harness.mjs). Nothing of the caller's OpenCode, its plugins, MCP
// servers, agents or provider keys reaches a run unless a credential profile passes it on purpose.

import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync, lstatSync, readlinkSync, unlinkSync } from "node:fs"
import { join, resolve, dirname, sep } from "node:path"
import { randomBytes } from "node:crypto"

const mkdir = (dir) => mkdirSync(dir, { recursive: true, mode: 0o700 })

export function makeSandbox(root) {
  const home = join(root, "home")
  const tmp = join(root, "tmp")
  for (const dir of [join(home, ".config", "opencode"), join(home, ".local", "share"), join(home, ".local", "state"), join(home, ".cache"), tmp]) mkdir(dir)
  return { root, home, tmp, project: join(root, "project") }
}

/** The run's config, as the host reads it: the plugin under test (or none) and the model. Nothing else. */
export function sealedConfig({ armDir, options, model }) {
  return {
    plugins: armDir ? [{ package: armDir, ...(options ? { options } : {}) }] : [],
    model,
  }
}

const PASS_THROUGH = ["LANG", "TZ", "TERM", "HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"]

/**
 * The environment of every process in a run. Built from nothing: PATH (the host and a provider's own CLI must be
 * found), locale and the network settings a machine may need, then the sandbox's own directories and switches.
 */
export function sandboxEnv({ sandbox, config, password, caller = process.env, extra = {} }) {
  const env = {}
  env.PATH = caller.PATH ?? "/usr/bin:/bin"
  for (const key of PASS_THROUGH) if (caller[key]) env[key] = caller[key]
  // The client reaches its own server on loopback, never through a proxy.
  const noProxy = [caller.NO_PROXY ?? caller.no_proxy, "127.0.0.1,localhost"].filter(Boolean).join(",")
  Object.assign(env, {
    HOME: sandbox.home,
    OPENCODE_TEST_HOME: sandbox.home,
    XDG_CONFIG_HOME: join(sandbox.home, ".config"),
    XDG_DATA_HOME: join(sandbox.home, ".local", "share"),
    XDG_CACHE_HOME: join(sandbox.home, ".cache"),
    XDG_STATE_HOME: join(sandbox.home, ".local", "state"),
    TMPDIR: sandbox.tmp,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_CONFIG_DIR: join(sandbox.home, ".config", "opencode"),
    OPENCODE_PASSWORD: password,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    OPENCODE_DISABLE_FILEWATCHER: "1",
    ...extra,
  })
  return env
}

export const newPassword = () => `eval-${randomBytes(12).toString("hex")}`

/** Writes the sealed config where a host would look too, so the file and the variable cannot disagree. */
export function writeConfig(sandbox, config) {
  writeFileSync(join(sandbox.home, ".config", "opencode", "opencode.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
}

/**
 * Every process group this runner started and has not seen end. A group outlives its leader when the leader leaves
 * children behind (a provider's CLI under a server), so a group is dropped only once nothing in it is left.
 */
const groups = new Set()

const signalGroup = (pgid, signal) => {
  try {
    process.kill(-pgid, signal)
    return true
  } catch {
    return false
  }
}

const reap = () => {
  for (const pgid of groups) if (!signalGroup(pgid, 0)) groups.delete(pgid)
}

/** The groups still alive: for a test, and for the interrupt handler. */
export const liveGroups = () => (reap(), [...groups])

/** TERM to every group this runner started, a grace period, then KILL. Used on an interrupt. */
export async function killAll({ graceMs = 1500 } = {}) {
  reap()
  for (const pgid of groups) signalGroup(pgid, "SIGTERM")
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline && liveGroups().length) await new Promise((done) => setTimeout(done, 50))
  for (const pgid of groups) signalGroup(pgid, "SIGKILL")
  await new Promise((done) => setTimeout(done, 50))
  reap()
}

/** A process in its own group, so a timeout or a stop reaches what it started (a provider's CLI included). */
export function start(command, args, { cwd, env, input = null } = {}) {
  const child = spawn(command, args, { cwd, env, stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"], detached: true })
  if (child.pid) groups.add(child.pid)
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (data) => (stdout += data))
  child.stderr.on("data", (data) => (stderr += data))
  if (input !== null) {
    child.stdin.on("error", () => {})
    child.stdin.end(input)
  }
  const exited = new Promise((resolve) => {
    child.on("error", (error) => resolve({ code: null, error: String(error.message ?? error) }))
    child.on("exit", (code, signal) => resolve({ code, signal }))
  })
  return {
    child,
    exited,
    output: () => ({ stdout, stderr }),
    kill: (signal = "SIGTERM") => {
      try {
        process.kill(-child.pid, signal)
      } catch {
        try {
          child.kill(signal)
        } catch {
          // gone
        }
      }
    },
  }
}

/** Runs to completion, or kills the group after `timeoutMs`. */
export async function runToEnd(command, args, { cwd, env, input = null, timeoutMs = 0 } = {}) {
  const proc = start(command, args, { cwd, env, input })
  let timedOut = false
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true
        proc.kill("SIGKILL")
      }, timeoutMs)
    : null
  const exit = await proc.exited
  if (timer) clearTimeout(timer)
  // Nothing a finished command started is left running.
  proc.kill("SIGKILL")
  reap()
  return { ...exit, ...proc.output(), timedOut }
}

/** TERM, a grace period, then KILL: only the group this run started. */
export async function stop(proc, { graceMs = 2000 } = {}) {
  if (!proc) return
  proc.kill("SIGTERM")
  const done = await Promise.race([proc.exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), graceMs))])
  if (!done) proc.kill("SIGKILL")
  // A provider's CLI can outlive the server it was started by; the group signal reaches it, this makes sure.
  proc.kill("SIGKILL")
  reap()
}

/**
 * Removes every symlink near the top of the sandbox home that points outside the sandbox: a world's home copied from a
 * lab sandbox carries links to the caller's ~/.claude or ~/.local/bin, and a run must not reach through them.
 */
export function stripForeignLinks(sandbox, { depth = 3 } = {}) {
  const removed = []
  const root = resolve(sandbox.root)
  const walk = (dir, left) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        const target = resolve(dirname(path), readlinkSync(path))
        if (target !== root && !target.startsWith(`${root}${sep}`)) {
          unlinkSync(path)
          removed.push(path.slice(root.length + 1))
        }
      } else if (entry.isDirectory() && left > 0) walk(path, left - 1)
    }
  }
  walk(sandbox.home, depth)
  return removed
}

export const removeSandbox = (root) => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
}
