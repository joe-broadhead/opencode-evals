import { authorizeOwnedLaunch, ownedSession } from "./owned-launch.mjs"
import { createProvisionalSpool } from "./owned-spool.mjs"
import { setProcessGroupMode, setProcessRecorder } from "./sandbox.mjs"

/** One inner execution, no successor, no cleanup certificate, no aggregate ledger access. */
export async function runContainedEntry(bytes, { observation, sink, caller, execute, prepare = () => {}, drainMs, clock } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 65536) throw new Error("bounded parent descriptor required")
  const descriptor = JSON.parse(bytes.toString("utf8"))
  const capability = authorizeOwnedLaunch(descriptor, observation)
  const session = ownedSession(capability)
  await prepare()
  const spool = createProvisionalSpool(descriptor, sink, { drainMs, clock })
  const previous = setProcessGroupMode("inherited")
  setProcessRecorder(spool)
  try {
    // This fixed import is inside the already-bound inner entry, never a postmortem import.
    const run = execute ?? (await import("./runner.mjs")).runBatch
    await run({ ...session.options, ownedSession: capability }, { caller, log: () => {} })
  } catch {
    if (!session.execution) session.recordExecution({ exit: null })
  } finally {
    try { await spool.drain() }
    finally {
      setProcessRecorder(null)
      setProcessGroupMode(previous)
    }
  }
  return spool.finish(session.execution ?? { exit: null })
}
