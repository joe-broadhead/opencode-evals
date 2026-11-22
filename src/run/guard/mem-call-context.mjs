// A permission decision uses the same validated invocation as execute.before.
import { validMemoryBinding } from "./mem-targets.mjs"
import { activeIntentMatches } from "./mem-intents.mjs"
const normalize = (name) => String(name).replace(/^mem\./, "mem_")
const ACTIONS = new Set(["mem_remember", "mem_revise", "mem_page", "mem_wiki", "mem_commitments", "memory.revise", "memory.forget", "page.write", "page.delete", "wiki.write", "wiki.delete"])

export function memoryActionMatches(call, action) {
  const family = call.classification?.family ?? normalize(call.tool).slice(4)
  if (normalize(action) === `mem_${family}`) return true
  if (!call.classification?.write) return false
  const internal = family === "revise" ? (call.input.action === "forget" ? "memory.forget" : "memory.revise")
    : family === "page" ? (call.input.action === "delete" ? "page.delete" : "page.write")
      : family === "wiki" ? (call.input.action === "delete" ? "wiki.delete" : "wiki.write") : null
  return internal !== null && action === internal
}

export function activeMemoryCall(active, event) {
  if (event.source !== undefined) {
    if (event.source?.type !== "tool") return null
    const call = active.get(`${event.sessionID}:${event.source.id}`)
    return call && memoryActionMatches(call, event.action) ? call : null
  }
  // Older host evaluations omit source. Only one active matching invocation can identify them.
  const matches = [...active.values()].filter((c) => c.sessionID === event.sessionID && memoryActionMatches(c, event.action))
  return matches.length === 1 ? matches[0] : null
}

export function memoryPermissionContext(policy, event, active, closed = false) {
  if (!validMemoryBinding(policy.memoryBinding) || !ACTIONS.has(normalize(event.action))) return null
  const call = closed ? null : activeMemoryCall(active, event)
  return { call, pass: Boolean(call?.pass && !call.classification?.error && activeIntentMatches(policy,call,event.sessionID)), write: call?.classification?.write ?? true }
}
