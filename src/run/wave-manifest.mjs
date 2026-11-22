// Reviewed inputs, not discovery: this module performs no runtime or network operations.
import { createHash } from "node:crypto"
import { readFileSync, realpathSync, lstatSync, accessSync, constants } from "node:fs"
import { isAbsolute, resolve, dirname, basename } from "node:path"
import { memoryArtifact } from "./mem-arm.mjs"
import { tierOf } from "../cost/budget.mjs"

export const WAVE_MODEL = "opencode/deepseek-v4.1-flash#low"
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex")
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
export function pinnedBytes(pin) {
  if (!pin || !isAbsolute(pin.path ?? "") || !digest(pin.sha256)) throw new Error("absolute file pin and SHA-256 required")
  if (pin.path !== resolve(pin.path) || realpathSync(pin.path) !== pin.path || !lstatSync(pin.path).isFile()) throw new Error("file pin must be a canonical regular file without symlinks")
  const bytes = readFileSync(pin.path)
  if (sha256(bytes) !== pin.sha256) throw new Error("file pin digest mismatch")
  return bytes
}
export const pinnedJSON = pin => JSON.parse(pinnedBytes(pin))

export function completeTrials(plan) {
  if (plan?.schema !== "oc-mem-wave-plan/1" || !Array.isArray(plan.cases) || !plan.cases.length) throw new Error("complete accepted plan required")
  const seen = new Set(), trials = []
  for (const c of plan.cases) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(c.id ?? "") || seen.has(c.id)) throw new Error("invalid or duplicate case")
    seen.add(c.id)
    if (!Array.isArray(c.conditions) || !c.conditions.length || new Set(c.conditions).size !== c.conditions.length || c.conditions.some(mode => !["direct", "search"].includes(mode))) throw new Error("accepted case condition applicability required")
    for (const arm of ["baseline", "candidate"]) for (const condition of c.conditions) for (const repetition of [1, 2, 3]) trials.push({ id: `${arm}-${condition}-${c.id}-r${repetition}`, case: c.id, arm, condition, repetition })
  }
  return trials
}

export function validateWave(wave, { harnessSha } = {}) {
  if (wave?.schema !== "oc-mem-wave/1" || !/^[a-z0-9-]{1,40}$/.test(wave.id ?? "")) throw new Error("wave schema/id required")
  if (wave.model !== WAVE_MODEL) throw new Error("exact model and low variant required; no aliases")
  if (wave.target_usd !== 10 || wave.total_ms !== 3600000 || wave.cleanup_ms !== 120000 || wave.docker_context !== "colima-mem-evals-20261122") throw new Error("wave target, deadline, margin or context differs")
  if (!/^[a-f0-9]{40}$/.test(harnessSha ?? "") || wave.harness_sha !== harnessSha) throw new Error("harness pin mismatch")
  const plan = pinnedJSON(wave.plan), expected = completeTrials(plan)
  const key = t => JSON.stringify([t?.id, t?.case, t?.arm, t?.condition, t?.repetition])
  if (!Array.isArray(wave.trials) || wave.trials.length !== expected.length || new Set(wave.trials.map(key)).size !== expected.length || expected.some(t => !wave.trials.some(actual => key(actual) === key(t)))) throw new Error("complete manifest must contain every applicable paired trial three times")
  return { wave, plan }
}

/** Must run before each child launch; callers supply the actually checked clean harness/launcher identity. */
export function qualifyWave(wave, identity) {
  const result = validateWave(wave, identity)
  for (const key of ["control", "store", "cases_dir", "docker_config"]) if (!isAbsolute(wave[key] ?? "")) throw new Error(`absolute ${key} required`)
  if (!Number.isInteger(wave.trial_timeout_s) || wave.trial_timeout_s < 1 || wave.trial_timeout_s > 3480) throw new Error("trial timeout must be 1 through 3480 seconds")
  if (wave.runtime?.version !== "2.2.6" || !/^sha256:[a-f0-9]{64}$/.test(wave.runtime.image ?? "")) throw new Error("qualified runtime version/image required")
  for (const key of ["opencode", "node", "launcher_node", "docker"]) {
    pinnedBytes(wave.runtime[key])
    try { accessSync(wave.runtime[key].path, constants.X_OK) } catch { throw new Error(`qualified ${key} must be executable`) }
  }
  if (identity.launcherNodeSha !== wave.runtime.launcher_node.sha256) throw new Error("launcher Node pin mismatch")
  for (const key of ["fixture", "schema", "discovery"]) pinnedBytes(wave.inputs?.[key])
  for (const c of result.plan.cases) {
    const compiled = pinnedJSON(c.file)
    if (dirname(c.file.path) !== wave.cases_dir || basename(c.file.path) !== `${c.id}.json` || compiled.id !== c.id || typeof c.set !== "string" || !compiled.sets?.includes(c.set)) throw new Error("case pin, directory or selected set mismatch")
    c.tier = tierOf(compiled)
  }
  pinnedJSON(wave.caps)
  const catalog = pinnedJSON(wave.catalog)
  const price = (catalog.providers ?? catalog).opencode?.models?.["deepseek-v4.1-flash"]?.cost
  if (!price || ["input", "output", "cache_read", "cache_write"].some(key => typeof price[key] !== "number" || !Number.isFinite(price[key]) || price[key] < 0)) throw new Error("complete exact-provider price catalog required; no aliases or fallback")
  const proof = pinnedJSON(wave.model_qualification)
  if (proof.schema !== "oc-mem-model-qualification/1" || proof.status !== "qualified" || proof.model !== WAVE_MODEL || proof.runtime_sha256 !== wave.runtime.opencode.sha256 || proof.catalog_sha256 !== wave.catalog.sha256 || !proof.source || !/^\d{4}-\d{2}-\d{2}$/.test(proof.as_of ?? "")) throw new Error("exact model/variant qualification is unavailable or mismatched")
  const selection = pinnedJSON(proof.selection)
  if (selection.providerID !== "opencode" || selection.id !== "deepseek-v4.1-flash" || selection.variant !== "low") throw new Error("observed exact model/low selection required")
  const request = pinnedJSON(proof.request)
  if (!Array.isArray(proof.variant_path) || !proof.variant_path.length || proof.variant_path.some(key => typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) || !["string", "number", "boolean"].includes(typeof proof.variant_value)) throw new Error("reviewed variant wire mapping required")
  if (proof.variant_path.reduce((value, key) => value?.[key], request) !== proof.variant_value) throw new Error("observed low-variant wire mapping mismatch")
  for (const arm of ["baseline", "candidate"]) {
    const spec = wave.arms?.[arm]
    if (!spec || !isAbsolute(spec.directory ?? "")) throw new Error("both staged arms required")
    pinnedBytes(spec.archive)
    const artifact = memoryArtifact(spec.directory)
    if (artifact.archive_sha256 !== spec.archive.sha256) throw new Error("staged arm/archive pin mismatch")
    qualifyConditions(pinnedJSON(spec.conditions), { runtime_sha256: wave.runtime.opencode.sha256, archive_sha256: artifact.archive_sha256, model: WAVE_MODEL })
  }
  // Capability probes do not attest a durable ready/open/seal recorder protocol.
  // No manifest field can override this gate. Reviewed integration must replace it.
  return { ...result, execution_qualified: false, blocker: "native recorder ready/open/seal integration is not qualified" }
}

/** The schema is a harness qualification dossier, NOT a claimed OpenCode response schema.
 * Its attachments are observed effective config, tool.list() output, and an OpenAI-shaped request.
 * Other wire formats require a reviewed decoder; they are not guessed here.
 */
export function qualifyConditions(q, identity) {
  if (q?.schema !== "oc-mem-conditions/1" || q.status !== "qualified" || q.mapping !== "execute-permission-v1") throw new Error("condition mapping is not qualified")
  for (const key of ["runtime_sha256", "archive_sha256", "model"]) if (!identity[key] || q[key] !== identity[key]) throw new Error(`condition qualification ${key} mismatch`)
  if (q.model !== WAVE_MODEL || !digest(q.runtime_sha256) || !digest(q.archive_sha256)) throw new Error("exact qualified model/runtime/arm required")
  if (!Array.isArray(q.memory_tool_ids) || !q.memory_tool_ids.length || q.memory_tool_ids.some(id => !/^mem_[a-z_]+$/.test(id)) || new Set(q.memory_tool_ids).size !== q.memory_tool_ids.length) throw new Error("qualified Memory tool inventory required")
  for (const condition of ["direct", "search"]) {
    const observation = q.observations?.[condition]
    if (!observation) throw new Error("both condition observations required")
    const config = pinnedJSON(observation.config), catalog = pinnedJSON(observation.catalog), request = pinnedJSON(observation.request)
    const rule = config.permissions?.filter(p => p.action === "execute" && p.resource === "*").at(-1)
    if (rule?.effect !== (condition === "direct" ? "deny" : "allow")) throw new Error("effective execute permission does not match condition")
    if (!Array.isArray(catalog) || q.memory_tool_ids.some(id => !catalog.some(t => t.id === id))) throw new Error("observed registered catalog lacks qualified Memory tools")
    if (!Array.isArray(request.tools)) throw new Error("observed request tool catalog required")
    const names = request.tools.map(t => t.function?.name ?? t.name)
    if (condition === "direct" ? names.includes("execute") || q.memory_tool_ids.some(id => !names.includes(id)) : !names.includes("execute") || !names.includes("search") || q.memory_tool_ids.every(id => names.includes(id))) throw new Error("observed request does not implement the condition")
  }
  return q
}
