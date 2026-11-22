// A space binding proves containment, never user intent. Intent is sealed by the native runner per case/trial.
import {spacesDiscoveryIntent} from "./mem-discovery-intents.mjs"
const key = (v) => JSON.stringify(v && typeof v === "object" ? Array.isArray(v) ? v.map((x) => JSON.parse(key(x))) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, JSON.parse(key(v[k]))])) : v)
export function validIntent(intent) {
  return intent?.schema === "oc-mem-intent/1" && typeof intent.case_id === "string" && typeof intent.trial_id === "string" && Number.isFinite(intent.expires_at) && Array.isArray(intent.turns) && intent.turns.every((t, i) => t.index === i + 1 && Array.isArray(t.calls) && t.calls.every((c) => ["remember", "revise", "page", "wiki", "commitments", "spaces"].includes(c.family) && c.args && typeof c.args === "object" && !Array.isArray(c.args)))
}
export function intentContext(policy, session, now = Date.now()) {
  const i = policy.memoryIntent, c = policy.memoryContext
  return validIntent(i) && i.expires_at > now && c?.active === true && c.case_id === i.case_id && c.trial_id === i.trial_id && Number.isInteger(c.turn) && i.turns.some((t) => t.index === c.turn) && typeof session === "string" && c.session === session
}
export function activeIntentMatches(policy, call, session) {
  if (!policy.memoryIntent) return true
  const current=policy.memoryContext, bound=call?.context
  return intentContext(policy,session) && bound?.trial_id===current.trial_id && bound?.case_id===current.case_id && bound?.turn===current.turn && bound?.session===session
}
function resolveArgs(args, policy) {
  const out = structuredClone(args)
  for (const [k, value] of Object.entries(out)) {
    if (typeof value !== "string" || !value.startsWith("@created.")) continue
    const creator = policy.memoryCreators?.find((c) => c.alias === value && c.case_id === policy.memoryIntent.case_id && c.trial_id === policy.memoryIntent.trial_id && c.turn <= policy.memoryContext.turn && c.status === "stored")
    // Authority contains the independently observed backend operation and its exact authorized creation arguments.
    const requested = policy.memoryIntent.turns.find((t) => t.index === creator?.turn)?.calls.find((c) => c.creates === value && key(c.args) === key(creator.args))
    if (!creator || !requested || creator.family !== requested.family || key(creator.args) !== key(requested.args) || typeof creator.id !== "string") return null
    out[k] = creator.id
  }
  return out
}
export function memoryIntentAllows(policy, call, input, session) {
  if (!intentContext(policy, session)) return false
  if(call.family==="spaces"&&call.write&&key(spacesDiscoveryIntent(policy.memoryIntent.case_id))!==key(input))return false
  const turn = policy.memoryIntent.turns.find((t) => t.index === policy.memoryContext.turn)
  return turn.calls.some((c) => c.family === call.family && key(resolveArgs(c.args, policy)) === key(input))
}
