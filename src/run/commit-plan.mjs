// The commit plan, tied to `targets.json` (G0 review 1.6): the commit set's writes are confined to the aliases the owner's targets file
// names, so a plan cannot carry a value someone typed into it. A plan is
//   { "actions": [<permission action>...],
//     "writes":  { <permission action>: { "extract": "args.channel_id", "allow": ["@slack.sandbox_channel"] } | { "local": true } },
//     "plans":   { ..., "allow": ["@gws.sandbox_folder"] } }
// `allow` holds `@alias` only: each is resolved here, at run time, from `$EVALS_STORE/targets.json`, and a literal value, an alias the
// targets file lacks, or an `actions` list that does not name exactly the actions `writes` declares is an error. The guard receives the
// resolved values and nothing else.

const ALIAS = /^@[A-Za-z0-9_.-]+$/

function resolveList(list, targets, where) {
  if (!Array.isArray(list) || !list.length) throw new Error(`commit plan: ${where} must be a list of @aliases`)
  const out = []
  for (const entry of list) {
    if (typeof entry !== "string" || !ALIAS.test(entry)) throw new Error(`commit plan: ${where} holds ${JSON.stringify(entry)}, a literal: write the @alias of a sandbox target from targets.json, never a value`)
    const values = targets?.get(entry.slice(1))
    if (!values?.length) throw new Error(`commit plan: ${where} names ${entry}, which targets.json does not have`)
    out.push(...values.map(String))
  }
  return out
}

/** The plan with every alias resolved to its values; throws for anything that does not hold. */
export function resolveCommitPlan(plan, targets) {
  if (!plan || typeof plan !== "object") throw new Error("commit plan: not an object")
  const actions = plan.actions ?? []
  const writes = plan.writes ?? {}
  const declared = Object.keys(writes)
  const missing = declared.filter((a) => !actions.includes(a))
  const extra = actions.filter((a) => !declared.includes(a))
  if (missing.length || extra.length) throw new Error(`commit plan: \`actions\` and \`writes\` must name the same actions${missing.length ? `; in writes only: ${missing.join(", ")}` : ""}${extra.length ? `; in actions only: ${extra.join(", ")}` : ""}`)
  const resolved = {}
  for (const [action, write] of Object.entries(writes)) {
    if (write?.local === true) {
      if (write.allow || write.extract) throw new Error(`commit plan: ${action} is local: it takes no extract or allow`)
      resolved[action] = { local: true }
      continue
    }
    if (typeof write?.extract !== "string" || !write.extract) throw new Error(`commit plan: ${action} needs an \`extract\` path (or \`local: true\` if it touches only the trial's own sandbox)`)
    resolved[action] = { extract: write.extract, allow: resolveList(write.allow, targets, `${action}.allow`) }
  }
  const out = { ...plan, actions: [...actions], writes: resolved }
  if (plan.plans) out.plans = { ...plan.plans, allow: resolveList(plan.plans.allow, targets, "plans.allow") }
  return out
}
