// A space binding proves containment, never user intent. Intent is sealed by the native runner per case/trial.
import {spacesDiscoveryIntent} from "./mem-discovery-intents.mjs"
import {coreWikiIntentPayloadMatches} from "../mem-intent-plan.mjs"
const key = (v) => JSON.stringify(v && typeof v === "object" ? Array.isArray(v) ? v.map((x) => JSON.parse(key(x))) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, JSON.parse(key(v[k]))])) : v)
const payloadMatches=(policy,family,expected,actual)=>key(expected)===key(actual)||(policy.memoryIntent.case_id==="core-wiki-write"&&family==="wiki"&&coreWikiIntentPayloadMatches(expected,actual))
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
  return intentContext(policy,session) && bound?.trial_id===current.trial_id && bound?.case_id===current.case_id && bound?.turn===current.turn && bound?.session===session && bound?.incarnation===current.incarnation && bound?.activation_id===current.activation_id
}
function resolveArgs(args, policy) {
  const out = structuredClone(args)
  for (const [k, value] of Object.entries(out)) {
    if (typeof value !== "string" || !value.startsWith("@created.")) continue
    const creator = policy.memoryCreators?.find((c) => c.alias === value && c.case_id === policy.memoryIntent.case_id && c.trial_id === policy.memoryIntent.trial_id && c.turn <= policy.memoryContext.turn && c.status === "stored")
    // Authority contains the independently observed backend operation and its exact authorized creation arguments.
    const requested = policy.memoryIntent.turns.find((t) => t.index === creator?.turn)?.calls.find((c) => c.creates === value && c.family===creator.family && payloadMatches(policy,c.family,c.args,creator.args))
    const scopes=creator?.family==="wiki"?policy.memoryBinding.wiki_spaces:policy.memoryBinding.record_spaces
    if (!creator || !requested || creator.family !== requested.family || typeof creator.id !== "string" || scopes?.[creator.id]!=="spc-eval-personal" || typeof creator.session!=="string" || typeof creator.call_id!=="string" || !creator.call_id) return null
    if(policy.memoryOperationPlan){
      const use=policy.memoryOperationPlan.turns.find(t=>t.index===creator.turn)?.uses.find(u=>u.id===creator.operation_id)
      if(creator.schema!=="oc-mem-native-creator/1"||creator.trial!==policy.memoryContext.trial||!Number.isSafeInteger(creator.incarnation)||creator.incarnation<1||creator.incarnation>policy.memoryContext.incarnation||!["activation_id","generation","invocation_id","reservation_id"].every(k=>typeof creator[k]==="string"&&creator[k])||creator.grant_id!==JSON.stringify([creator.case_id,creator.trial_id,creator.turn,creator.operation_id])||!use?.alternatives.some(a=>a.creates===value&&a.family===creator.family&&payloadMatches(policy,a.family,a.args,creator.args)))return null
    }
    out[k] = creator.id
  }
  return out
}
export function memoryIntentAllows(policy, call, input, session) {
  if (!intentContext(policy, session)) return false
  if(call.family==="spaces"&&call.write&&key(spacesDiscoveryIntent(policy.memoryIntent.case_id))!==key(input))return false
  const turn = policy.memoryIntent.turns.find((t) => t.index === policy.memoryContext.turn)
  return turn.calls.some((c) => c.family === call.family && payloadMatches(policy,c.family,resolveArgs(c.args, policy),input))
}

// An operation-use alternative is checked by the same sealed payload/creator rules.
export function memoryIntentAlternativeMatches(policy, alternative, call, input, session) {
  return memoryIntentAllows(policy,call,input,session) && alternative.family===call.family && payloadMatches(policy,call.family,resolveArgs(alternative.args,policy),input)
}
