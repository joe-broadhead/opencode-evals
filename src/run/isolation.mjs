// Filesystem isolation for live runs. The sandbox (sandbox.mjs) isolates the environment: HOME, the XDG tree, TMPDIR,
// the config and the database are the run's own. It does not confine the filesystem: an agent with a shell or a write
// tool can still reach any path the user running the harness can, an absolute path included. An eval run has done
// exactly that, overwriting a real file outside its sandbox. So a live run needs a backend that confines what the
// run's processes can see and write, and `evals run` refuses to launch one without it.
//
// A backend is
//   { name, confines, maxParallel?, prepare({ batchRoot, caller, binaries, log }), enter({ name, sandbox, mounts, cwd }),
//     teardown(), describe(), egress()? }
// and a trial, what enter() returns, is
//   { wrap({ command, args, cwd, env }), port(attempt), ready({ url, password, directory, timeoutMs, exited }),
//     oomKills(), leave({ reason }), describe(), killed }
//   confines   true when the run's processes cannot reach the host filesystem outside what the backend mounts;
//   wrap       turns a host command (serve, run, auth import, --version) into the command that runs it confined;
//   ready      polls a server of the trial until it answers 200, from wherever the trial's loopback is reachable;
//   leave      ends everything the trial started; idempotent, never throws. teardown() leaves every trial.
//
//   none       env isolation only; refused for every run unless --unsafe-no-isolation says so in so many words: any run
//              can execute tools, the harness's scripted model included (`[[mock:tool:shell:…]]` runs a real shell)
//   container  one Docker container per trial, on a network whose only way out is an allow-listing proxy (container.mjs)

import { freePort } from "../t1/http.mjs"
import { containerBackend, containerConfig } from "./container.mjs"
import { SCRIPTED_PROVIDER, SCRIPTED_MODEL } from "./sandbox.mjs"

/** Polls a loopback URL from the host until it answers 200. */
async function hostReady({ url, password = null, directory = null, timeoutMs = 60_000, exited = () => false } = {}) {
  const headers = {}
  if (password) headers.authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  if (directory) headers["x-opencode-directory"] = directory
  const deadline = Date.now() + timeoutMs
  let last = ""
  while (!exited() && Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(2000) })
      if (response.ok) return { ok: true }
      last = `HTTP ${response.status}`
    } catch (error) {
      last = String(error.message ?? error)
    }
    await new Promise((done) => setTimeout(done, 200))
  }
  return { ok: false, last: exited() ? "the server exited" : `no answer in ${timeoutMs} ms (${last})` }
}

const none = () => ({
  name: "none",
  confines: false,
  async prepare() {},
  async enter() {
    return {
      killed: null,
      wrap: (spec) => spec,
      port: () => freePort(),
      ready: hostReady,
      async oomKills() {
        return null
      },
      async leave() {},
      // Unconfined, a run's processes are its process groups, ended before anything is removed.
      async gone() {
        return true
      },
      describe: () => null,
    }
  },
  async teardown() {},
  async allGone() {
    return true
  },
  describe: () => ({ backend: "none" }),
  egress: () => null,
})

export const BACKENDS = {
  none,
  container: (config) => containerBackend(config ?? containerConfig()),
}

/**
 * Is this a live run, one where a real model can drive real tools? Only one thing is not: no credential at all
 * (`--auth none`) and the harness's own scripted model, registered by the harness in the sealed config. A model that
 * is merely called `mock` can come from the plugin under test and be backed by anything; a credential means a real
 * model can be reached. Everything else is live. "Not live" is not "confined": the scripted model can call any tool,
 * so it decides only what the batch record says, never whether a run may go unconfined.
 */
export function isLive({ auth, model, config }) {
  const scripted = model === SCRIPTED_MODEL && (config?.plugins ?? []).some((plugin) => plugin.package === SCRIPTED_PROVIDER)
  return !(auth === "none" && scripted)
}

/** The backend when none is named: `container`, for every run, the scripted model's included. */
export const defaultIsolation = () => "container"

/**
 * The backend a batch runs under. Throws, before anything is created, imported or reserved, for any run on a backend
 * that does not confine the filesystem, unless `unsafe` (--unsafe-no-isolation) was given.
 */
export function selectIsolation({ name, live = true, unsafe = false, config = null } = {}) {
  const chosen = name ?? defaultIsolation()
  const make = BACKENDS[chosen]
  if (!make) throw new Error(`unknown --isolation ${JSON.stringify(chosen)}: use ${Object.keys(BACKENDS).join(" or ")}`)
  if (unsafe && chosen !== "none") throw new Error(`--unsafe-no-isolation means --isolation none; it says nothing with --isolation ${chosen}`)
  const backend = make(config)
  if (!backend.confines && !unsafe) {
    throw new Error(
      `refusing a${live ? " live" : ""} run with --isolation ${backend.name}: the sandbox isolates the environment, not the filesystem, so the agent under test${live ? "" : " (even the scripted model, which can call a shell tool)"} can read and write anything this user can, by absolute path. Use --isolation container (the default), or pass --unsafe-no-isolation on a machine you are prepared to lose`,
    )
  }
  return Object.assign(backend, { live, unsafe: !backend.confines })
}
