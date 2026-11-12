// Filesystem isolation for live runs. The sandbox (sandbox.mjs) isolates the environment: HOME, the XDG tree, TMPDIR,
// the config and the database are the run's own. It does not confine the filesystem: an agent with a shell or a write
// tool can still reach any path the user running the harness can, an absolute path included. An eval run has done
// exactly that, overwriting a real file outside its sandbox. So a live run needs a backend that confines what the
// run's processes can see and write, and `evals run` refuses to launch one without it.
//
// A backend is { name, confines, prepare({ batchRoot, caller }), wrap({ command, args, cwd, env, sandbox }), teardown() }:
//   confines   true when the run's processes cannot reach the host filesystem outside what the backend mounts;
//   wrap       turns a host command (serve, run, auth import, --version) into the command that runs it confined.
//
//   none       env isolation only; refused for a live run unless --unsafe-no-isolation says so in so many words
//   container  confined in a container; designed elsewhere, not implemented here yet

const none = () => ({
  name: "none",
  confines: false,
  async prepare() {},
  wrap: (spec) => spec,
  async teardown() {},
})

export const BACKENDS = {
  none,
  container: () => {
    throw new Error("--isolation container is not implemented yet: no live run can be launched until a filesystem-isolation backend exists")
  },
}

/** Is this a live run, one where a real model drives real tools? The scripted mock model of T1 is not. */
export const isLive = (model) => String(model ?? "").split("/")[0] !== "mock"

/**
 * The backend a batch runs under. Throws, before anything is created or reserved, for a live run on a backend that
 * does not confine the filesystem, unless `unsafe` (--unsafe-no-isolation) was given.
 */
export function selectIsolation({ name = "none", model, unsafe = false } = {}) {
  const make = BACKENDS[name]
  if (!make) throw new Error(`unknown --isolation ${JSON.stringify(name)}: use ${Object.keys(BACKENDS).join(" or ")}`)
  const backend = make()
  if (!backend.confines && isLive(model) && !unsafe) {
    throw new Error(
      `refusing a live run with --isolation ${backend.name}: the sandbox isolates the environment, not the filesystem, so the agent under test can read and write anything this user can, by absolute path. Configure a filesystem-isolation backend (--isolation container, not implemented yet), or pass --unsafe-no-isolation on a machine you are prepared to lose`,
    )
  }
  return { ...backend, unsafe: !backend.confines && isLive(model) }
}
