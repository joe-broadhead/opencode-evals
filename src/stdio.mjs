// A command whose reader is gone (a test that was killed, a terminal that closed, `| head`) must not spin. Writing to a closed pipe raises EPIPE
// as an 'error' on stdout or stderr; with no listener it is an uncaught exception, and a batch's handler for those logs the error, which writes to
// the same closed pipe, which raises it again: found as `evals run` processes left at 100% CPU for twelve hours after their test run was killed,
// which then slowed every later probe.
//
// Only a CLOSED READER is tolerated, and its output is dropped. Any other write error is real (a full disk, a broken device, a bad descriptor): the
// message goes to stderr once per stream, and the command exits non-zero (its work goes on and ends as it would have, so a batch is not abandoned
// with containers up; what it cannot do is exit 0 as if its output had been written).
import { writeSync } from "node:fs"

/** The codes of a reader that went away. */
export const CLOSED_READER = new Set(["EPIPE", "ECONNRESET", "ERR_STREAM_DESTROYED"])

/**
 * Installs the listeners. `proc`, `streams` and `say` are for the test: a process-like object, [name, stream] pairs, and where the one-line message goes
 * (stderr's descriptor by default, written synchronously so it does not depend on the stream that just failed).
 */
export function ignoreStdioErrors({ proc = process, streams = [["stdout", process.stdout], ["stderr", process.stderr]], say = (line) => writeSync(2, line) } = {}) {
  const failed = new Set()
  for (const [name, stream] of streams) {
    stream.on("error", (error) => {
      if (CLOSED_READER.has(error?.code)) return
      proc.exitCode = 1
      if (failed.has(name)) return
      failed.add(name)
      try {
        say(`evals: cannot write to ${name}: ${error?.message ?? error}\n`)
      } catch {
        // stderr is the stream that failed: the exit code is all that is left to say it
      }
    })
  }
  // Whatever the command sets later, a run whose output was lost does not end with 0.
  proc.on("exit", (code) => {
    if (failed.size && !code) proc.exitCode = 1
  })
}
