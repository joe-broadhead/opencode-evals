// The arguments of every tool call in a recording, as the model wrote them: for the arguments a case declares
// `Checkable:`, which the grader may compare from the private recording at grade time. They are never written into a
// trace, which keeps only their shape.
//
// The order is the trace's own (normalise.mjs `events`): each outer call, and after an `execute` call the calls its
// code makes, so the n-th entry here belongs to the n-th `tool_call` event of the trace.

import { summarize } from "./analyse.mjs"
import { extractInnerCalls } from "./innerArgs.mjs"

export function rawCallArgs(rawLines) {
  const out = []
  for (const call of summarize(rawLines).calls) {
    out.push(call.inputRaw ?? {})
    if (call.via !== "execute") continue
    for (const site of extractInnerCalls(call.inputRaw?.code)) out.push(site.args ?? {})
  }
  return out
}
