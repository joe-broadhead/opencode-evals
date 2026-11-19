// A command whose reader is gone (a test that was killed, a terminal that closed, `| head`) must not spin. Writing to a closed pipe raises EPIPE
// as an 'error' on stdout or stderr; with no listener it is an uncaught exception, and a batch's handler for those logs the error, which writes to
// the same closed pipe, which raises it again: found as `evals run` processes left at 100% CPU for twelve hours after their test run was killed,
// which then slowed every later probe. Output nobody reads is dropped; the work goes on and ends as it would have.
export function ignoreStdioErrors(streams = [process.stdout, process.stderr]) {
  for (const stream of streams) stream.on("error", () => {})
}
