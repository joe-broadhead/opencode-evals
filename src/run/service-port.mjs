// The evals profile's own background service (EVALS-232 G0 review 4.1). OpenCode starts a managed service on a fixed local port per
// user; the evals profile has its own HOME and XDG tree but, left alone, asks for the same port as the owner's real service, which
// is already listening: `opencode auth list` in the profile then fails with "Managed service port … is already in use by PID …", and
// sign-in, the keeper, check-real and every `+profile` batch fail with it. So the profile is given its own port (the plan's 47950 when it
// is free, else the next free one), set with `opencode service set port`, and nothing that talks to the profile runs on the real
// service's port. Standalone on purpose (node builtins only): the profile scripts are copied out of the repository.

import { spawnSync } from "node:child_process"

/** The plan's port for the evals profile's service. */
export const EVALS_PORT = 47950

/** The real service's port when it cannot be read (the one the host reported in use on the owner's machine); EVALS_REAL_SERVICE_PORT overrides it. */
export const REAL_DEFAULT_PORT = 49374

const SEARCH_SPAN = 50

/** Runs a command: { code, stdout, stderr }. Never throws. */
export function runCommand(command, args, { env, timeoutMs = 30_000 } = {}) {
  const out = spawnSync(command, args, { env, encoding: "utf8", timeout: timeoutMs })
  return { code: out.status, stdout: out.stdout ?? "", stderr: out.stderr ?? "" }
}

/** Is nothing listening on 127.0.0.1:<port>? Tried by listening on it, in a child process, so the answer is the kernel's. */
export function portIsFree(port) {
  const probe = "const s=require('node:net').createServer();s.once('error',()=>process.exit(1));s.listen(Number(process.argv[1]),'127.0.0.1',()=>s.close(()=>process.exit(0)))"
  return spawnSync(process.execPath, ["-e", probe, String(port)], { timeout: 10_000 }).status === 0
}

/** The service port a profile's configuration names, or null when it names none. */
export function getServicePort({ opencode, env, exec = runCommand }) {
  const out = exec(opencode, ["service", "get", "port"], { env })
  const n = Number(String(out.stdout ?? "").trim().split(/\s+/)[0])
  return out.code === 0 && Number.isInteger(n) && n > 0 && n < 65536 ? n : null
}

/** Is the profile's own service up (so its port being busy is its own doing)? */
export function serviceRunning({ opencode, env, exec = runCommand }) {
  const out = exec(opencode, ["service", "status"], { env })
  return out.code === 0 && /running|started|active|listening/i.test(String(out.stdout)) && !/not running|stopped/i.test(String(out.stdout))
}

/** The real service's port: its configuration, else EVALS_REAL_SERVICE_PORT, else the default the host reports. */
export function realServicePort({ opencode, realEnv, exec = runCommand, env = process.env }) {
  const fromConfig = getServicePort({ opencode, env: realEnv, exec })
  if (fromConfig) return fromConfig
  const given = Number(env.EVALS_REAL_SERVICE_PORT)
  return Number.isInteger(given) && given > 0 ? given : REAL_DEFAULT_PORT
}

/**
 * Gives the profile a port of its own: kept when it has one that is not the real service's and is free or is its own service's; else
 * 47950 if that is free, else the next free port above it. Returns { port, real, changed }.
 */
export function ensureServicePort({ opencode, profileEnv, realEnv, exec = runCommand, isFree = portIsFree, preferred = EVALS_PORT, env = process.env }) {
  const real = realServicePort({ opencode, realEnv, exec, env })
  const mine = getServicePort({ opencode, env: profileEnv, exec })
  if (mine && mine !== real && (isFree(mine) || serviceRunning({ opencode, env: profileEnv, exec }))) return { port: mine, real, changed: false }
  let port = null
  for (let candidate = preferred; candidate < preferred + SEARCH_SPAN; candidate++) {
    if (candidate === real || candidate === mine) continue
    if (isFree(candidate)) {
      port = candidate
      break
    }
  }
  if (port === null) throw new Error(`no free port from ${preferred} to ${preferred + SEARCH_SPAN - 1} for the evals profile's service (the real service is on ${real})`)
  const set = exec(opencode, ["service", "set", "port", String(port)], { env: profileEnv })
  if (set.code !== 0) throw new Error(`\`opencode service set port ${port}\` failed in the evals profile (exit ${set.code}): ${String(set.stderr).trim().slice(0, 160)}`)
  return { port, real, changed: true }
}

/** Refuses a profile that would talk to the real service: its port must be set and not the real one's. Throws; returns the port. */
export function assertDistinctPort({ opencode, profileEnv, realEnv, exec = runCommand, env = process.env }) {
  const real = realServicePort({ opencode, realEnv, exec, env })
  const mine = getServicePort({ opencode, env: profileEnv, exec })
  if (!mine) throw new Error(`the evals profile has no service port of its own: run evals-profile.sh once (it sets one with \`opencode service set port\`); the real service is on ${real}`)
  if (mine === real) throw new Error(`the evals profile's service port (${mine}) is the real service's: it would talk to the owner's own sign-ins. Run evals-profile.sh to give it another`)
  return mine
}
