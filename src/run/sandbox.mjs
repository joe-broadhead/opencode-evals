// One sandbox per (case, trial): its own HOME, XDG tree, TMPDIR and OpenCode database, a sealed config, and a minimal
// environment, the same isolation T1 uses (src/t1/harness.mjs). Nothing of the caller's OpenCode, its plugins, MCP
// servers, agents or provider keys reaches a run unless a credential profile passes it on purpose.

import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync, lstatSync, readlinkSync, unlinkSync, chmodSync, openSync, closeSync, fstatSync, constants } from "node:fs"
import { join, resolve, dirname, basename, sep } from "node:path"
import { randomBytes } from "node:crypto"
import { inside, real } from "./paths.mjs"

const mkdir = (dir) => mkdirSync(dir, { recursive: true, mode: 0o700 })

export function makeSandbox(root) {
  const home = join(root, "home")
  const tmp = join(root, "tmp")
  for (const dir of [join(home, ".config", "opencode"), join(home, ".local", "share"), join(home, ".local", "state"), join(home, ".cache"), tmp]) mkdir(dir)
  return { root, home, tmp, project: join(root, "project") }
}

/** The harness's own scripted model: T1's mock provider plugin, which serves `mock/m1` from a loopback server. */
export const SCRIPTED_PROVIDER = resolve(import.meta.dirname, "..", "t1", "mock", "provider")
export const SCRIPTED_MODEL = "mock/m1"

/**
 * The run's config, as the host reads it: the plugin under test (or none), the harness's scripted model when asked for,
 * and the model. Nothing else. The scripted provider comes last: the host applies plugins in order, so a plugin under
 * test that registers a provider called `mock` of its own is overridden by the harness's, never the reverse.
 */
export function sealedConfig({ armDir, options, model, scripted = false, scriptedProvider = SCRIPTED_PROVIDER }) {
  return {
    plugins: [...(armDir ? [{ package: armDir, ...(options ? { options } : {}) }] : []), ...(scripted ? [{ package: scriptedProvider }] : [])],
    model,
  }
}

const PASS_THROUGH = ["LANG", "TZ", "TERM", "HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"]

/**
 * The variables only the harness sets: where the run lives (HOME, XDG_*, TMPDIR, PATH), its sealed config and switches
 * (OPENCODE_*), the provider's credential and settings (CLAUDE_*, ANTHROPIC_*), the scripted model's endpoint, the
 * network, and what would load code into the host (NODE_OPTIONS, LD_PRELOAD, BUN_*). A world's `env` may set anything
 * else; these it may not, and the harness's own values are applied after it, so they win.
 */
export const SEALED_ENV = /^(HOME|PATH|TMPDIR|TMP|TEMP|USER|LOGNAME|SHELL|SPIKE_MOCK_URL|NO_PROXY|no_proxy|HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS|NODE_OPTIONS|NODE_PATH|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*|BUN_.*|OPENCODE_.*|XDG_.*|CLAUDE_.*|ANTHROPIC_.*|DOCKER_.*)$/

/** A world's environment, without the harness's own variables: { env, dropped } (the names it tried to set). */
export function worldEnv(env = {}) {
  const kept = {}
  const dropped = []
  for (const [key, value] of Object.entries(env ?? {})) {
    if (SEALED_ENV.test(key)) dropped.push(key)
    else if (value !== undefined && value !== null) kept[key] = String(value)
  }
  return { env: kept, dropped: dropped.sort() }
}

/**
 * The environment of every process in a run. Built from nothing: a world's own variables first (never the sealed
 * ones), then PATH (the host and a provider's own CLI must be found), locale and the network settings a machine may
 * need, the sandbox's own directories and switches, and last the harness's `extra` (the credential, the scripted
 * model's endpoint), so nothing a world sets can replace the sealed config after the checks that read it.
 */
export function sandboxEnv({ sandbox, config, password, caller = process.env, world = {}, extra = {} }) {
  const env = { ...worldEnv(world).env }
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
 * Removes every symlink anywhere in the sandbox that points outside it: a world's home copied from a lab sandbox carries
 * links to the caller's ~/.claude or ~/.local/bin, and a run must not reach through them. Links are not followed.
 */
export function stripForeignLinks(sandbox, { depth = Infinity } = {}) {
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
  walk(root, depth)
  return removed
}

/** Linux's O_PATH: a descriptor naming an inode without opening it, which works on a directory the owner cannot read. */
const O_PATH = constants.O_PATH ?? 0o10000000
const PROC_FD = "/proc/self/fd"

/**
 * Gives the owner back read, write and search on every directory under `root`, so a sandbox whose directories a run
 * locked (`chmod 000`) can be removed. Only ever called once nothing of the run is left (its container removed, its
 * processes ended), and even then through descriptors, never by path: each entry is opened with O_NOFOLLOW (a link is
 * opened as the link itself, and skipped), its mode changed through /proc/self/fd/<n>, which names exactly the inode
 * that was opened, and its children looked up inside that inode. A directory swapped for a link between a check and a
 * change therefore cannot aim the change outside the sandbox. Only the permission bits are set: setuid, setgid and the
 * sticky bit are dropped, never added. Without /proc (not Linux), nothing is changed.
 */
export function repairPermissions(root) {
  if (!existsSync(PROC_FD)) return
  const visit = (fd, depth) => {
    let stat
    try {
      stat = fstatSync(fd)
    } catch {
      return
    }
    if (!stat.isDirectory() || depth > 256) return
    const at = `${PROC_FD}/${fd}`
    if ((stat.mode & 0o700) !== 0o700 || (stat.mode & 0o7000) !== 0) {
      try {
        chmodSync(at, (stat.mode & 0o777) | 0o700)
      } catch {
        return
      }
    }
    let names
    try {
      names = readdirSync(at)
    } catch {
      return
    }
    for (const name of names) {
      let child
      try {
        child = openSync(`${at}/${name}`, O_PATH | constants.O_NOFOLLOW)
      } catch {
        continue
      }
      try {
        visit(child, depth + 1)
      } finally {
        closeSync(child)
      }
    }
  }
  let fd
  try {
    fd = openSync(root, O_PATH | constants.O_NOFOLLOW)
  } catch {
    return
  }
  try {
    visit(fd, 0)
  } finally {
    closeSync(fd)
  }
}

export const removeSandbox = (root) => {
  if (!existsSync(root)) return
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    repairPermissions(root)
    rmSync(root, { recursive: true, force: true })
  }
}

/**
 * Removes one file of a sandbox the run may have tampered with: only once nothing of the run is left (`gone`, which
 * the caller confirms: under `container`, `docker inspect` of the trial says there is no such container), so nothing
 * can swap a link in between the check and the removal; and only when the path, every link in it resolved, is still
 * inside the sandbox, so a run that turned `home/.claude` into a link cannot have the runner delete a file outside it.
 */
export function removeInside(root, path, { gone = false } = {}) {
  if (gone !== true) return false
  // The file's directory, every link in it resolved (a dangling one followed), must still be inside the sandbox.
  if (!inside(root, dirname(path))) return false
  try {
    rmSync(join(real(dirname(path)), basename(path)), { force: true })
  } catch {
    // a directory of that name holds nothing of a sign-in
  }
  return true
}
