// A process-local capability, not a caller-controlled boolean or a claim of external absence.
// The parent descriptor arrives on bootstrap stdin. Only the parent's inspect proof can qualify it.
const sessions = new WeakMap()
export function authorizeOwnedLaunch(descriptor, { platform, mounts, password } = {}) {
  if (platform !== "linux") throw new Error("owned-container requires Linux bootstrap")
  const mounted = new Map(String(mounts).split("\n").map(line => line.split(" ")))
  if (!["/", "/inputs", "/opt/evals/bin"].every(p => mounted.get(p) === "ro") || mounted.get("/work") !== "rw") throw new Error("parent read-only mount layout required")
  const d = structuredClone(descriptor), b = d?.binding, o = d?.options
  if (d?.schema !== "oc-owned-launch/1" || !/^[a-f0-9]{64}$/.test(d.container_id ?? "") || d.context !== "colima-mem-evals-20261122" || !/^[a-f0-9-]{36}$/.test(b?.invocation_id ?? "") || !/^[a-f0-9]{64}$/.test(b?.manifest_sha256 ?? "") || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(b?.trial_id ?? "") || ![d.inputs_sha256, d.binaries_sha256].every(x => /^[a-f0-9]{64}$/.test(x ?? ""))) throw new Error("parent-bound descriptor required")
  validateContainedOptions(o)
  if (typeof password !== "string" || password.length < 8) throw new Error("parent server password required")
  const capability = Object.freeze({})
  sessions.set(capability, { descriptor: d, options: o, password, execution: null, recordExecution(value) { this.execution = value } })
  return capability
}
export function validateContainedOptions(o) {
  const allowed = ["plugin", "iteration", "model", "auth", "cases", "casesDir", "set", "trials", "parallel", "arm", "world", "host", "timeout", "stale", "tools", "isolation", "harnessRetries", "processGroup", "condition", "conditionQualification", "commitPlan"]
  if (!o || Object.keys(o).some(k => !allowed.includes(k)) || o.plugin !== "mem" || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(o.iteration ?? "") || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(o.cases ?? "") || o.trials !== 1 || o.parallel !== 1 || o.harnessRetries !== 0 || o.processGroup !== "inherited" || o.isolation !== "owned-container" || o.stale !== "refuse" || o.tools !== "locked" || o.host !== "2.2.6" || o.model !== "opencode/deepseek-v4.1-flash#low" || !/^env:[A-Z_][A-Z0-9_]*$/.test(o.auth ?? "") || typeof o.timeout !== "number" || !(o.timeout > 0 && o.timeout <= 3480) || o.casesDir !== "/inputs/cases" || o.arm !== "/inputs/arm" || o.world !== "/inputs/harness/worlds/mem/index.mjs" || o.conditionQualification && o.conditionQualification !== "/inputs/conditions.json" || o.commitPlan !== undefined && (o.commitPlan === null || Object.keys(o.commitPlan ?? {}).some(k => !["path", "sha256"].includes(k)) || o.commitPlan.path !== "/inputs/commit-plan.json" || !/^[a-f0-9]{64}$/.test(o.commitPlan.sha256 ?? ""))) throw new Error("single contained trial options required")
}
export function ownedSession(capability) {
  const session = sessions.get(capability)
  if (!session) throw new Error("owned-container requires a parent-bound bootstrap; ordinary CLI invocation refused")
  return session
}

/** Normalize kernel mountinfo; never infer containment from /.dockerenv. */
export function ownedMountLayout(text) {
  return String(text).split("\n").flatMap(line => {
    const fields = line.split(" "), sep = fields.indexOf("-")
    if (sep < 0 || !["/", "/inputs", "/opt/evals/bin", "/work"].includes(fields[4])) return []
    const mode = fields[5].split(",").includes("ro") ? "ro" : "rw"
    return [`${fields[4]} ${mode}`]
  }).join("\n")
}
