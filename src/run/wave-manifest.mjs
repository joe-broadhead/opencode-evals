// Reviewed inputs, not discovery: this module performs no runtime or network operations.
import { createHash } from "node:crypto"
import { readFileSync, realpathSync, lstatSync, accessSync, constants } from "node:fs"
import { isAbsolute, resolve, dirname, basename, join } from "node:path"
import { memoryArtifact } from "./mem-arm.mjs"
import { tierOf } from "../cost/budget.mjs"

export const WAVE_MODEL = "opencode/deepseek-v4.1-flash#low"
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex")
/** The owned composition's in-container attachment root: the dispatch stages basename
 * copies of the condition dossier's pinned observation attachments beneath this
 * directory, which the container sees as /inputs/attachments. */
export const OWNED_CONDITION_ATTACHMENTS = "/inputs/attachments"
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
/** Resolve one pinned dossier attachment. Two-sided resolution, one hash identity:
 * without a root — the host-side wave validation and the legacy host-side proof — the
 * pin's own canonical path is read exactly as before. With a root — the owned
 * composition's in-container condition proof — the pin's recorded host path is used for
 * BASENAME and sha matching only, and the attachment is resolved as that basename
 * beneath the root; the resolved path must be canonical inside its root. Identity is
 * hash-bound either way: a missing file, a wrong-name file or any digest mismatch
 * refuses fail-closed with the existing vocabulary — never a silent skip, never a
 * re-pin to a different hash. */
export function pinnedBytes(pin, root) {
  if (!pin || !isAbsolute(pin.path ?? "") || !digest(pin.sha256)) throw new Error("absolute file pin and SHA-256 required")
  if (root !== undefined) {
    if (typeof root !== "string" || !isAbsolute(root) || root !== resolve(root)) throw new Error("attachment resolution root must be canonical")
    const name = basename(pin.path)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error("file pin must be a canonical regular file without symlinks")
    const path = join(root, name)
    try {
      if (realpathSync(path) !== path) throw new Error("file pin must be a canonical regular file without symlinks")
      if (!lstatSync(path).isFile()) throw new Error("file pin must be a canonical regular file without symlinks")
    } catch { throw new Error("file pin must be a canonical regular file without symlinks") }
    const bytes = readFileSync(path)
    if (sha256(bytes) !== pin.sha256) throw new Error("file pin digest mismatch")
    return bytes
  }
  if (pin.path !== resolve(pin.path) || realpathSync(pin.path) !== pin.path || !lstatSync(pin.path).isFile()) throw new Error("file pin must be a canonical regular file without symlinks")
  const bytes = readFileSync(pin.path)
  if (sha256(bytes) !== pin.sha256) throw new Error("file pin digest mismatch")
  return bytes
}
export const pinnedJSON = (pin, root) => JSON.parse(pinnedBytes(pin, root))

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

/** Pure structure validation of the owner-supplied native qualification record.
 * The live profile match happens only at dispatch; this never sets execution_qualified. */
export function validateNativeQualificationRecord(record) {
  const exact = (value, keys) => value && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  if (record?.schema !== "oc-mem-native-qualification/1" || !exact(record, ["schema", "os_profile", "node", "helper", "budgets", "evidence", "qualified_scope"])) throw new Error("exact native qualification record fields required")
  const os = record.os_profile
  if (!exact(os, ["platform", "arch", "version", "build", "sdk"]) || os.platform !== "darwin" || !["arm64", "x64"].includes(os.arch) || !/^\d+(\.\d+)*$/.test(os.version ?? "") || !/^[A-Z0-9]{2,12}$/.test(os.build ?? "") || !/^\d+(\.\d+)*$/.test(os.sdk ?? "")) throw new Error("exact qualified OS profile required")
  const node = record.node
  if (!exact(node, ["path", "version", "sha256", "mode"]) || !isAbsolute(node.path ?? "") || node.path !== resolve(node.path) || !/^v\d+\.\d+\.\d+$/.test(node.version ?? "") || !digest(node.sha256) || node.mode !== "0755") throw new Error("exact parent Node pin required")
  const helper = record.helper
  if (!exact(helper, ["source_blob", "build_manifest_sha256", "binary"]) || !/^[a-f0-9]{40}$/.test(helper.source_blob ?? "") || !digest(helper.build_manifest_sha256)) throw new Error("exact helper source and build-evidence pins required")
  const binary = helper.binary
  if (!exact(binary, ["path", "sha256", "size", "mode"]) || !isAbsolute(binary.path ?? "") || binary.path !== resolve(binary.path) || !digest(binary.sha256) || !Number.isSafeInteger(binary.size) || binary.size < 1 || binary.size > 1048576 || binary.mode !== "0555") throw new Error("exact deployed helper binary pin required")
  const budgets = record.budgets
  if (!exact(budgets, ["warmup_ms", "lookup_ms", "cleanup_ms"]) || budgets.warmup_ms !== 1000 || budgets.lookup_ms !== 100 || budgets.cleanup_ms !== 100) throw new Error("exact native budget pins required")
  const evidence = record.evidence
  if (!exact(evidence, ["path", "sha256"]) || !isAbsolute(evidence.path ?? "") || evidence.path !== resolve(evidence.path) || !digest(evidence.sha256)) throw new Error("exact qualification evidence reference required")
  if (typeof record.qualified_scope !== "string" || !record.qualified_scope.trim() || record.qualified_scope.length > 2048) throw new Error("qualified scope statement required")
  return record
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
  // An optional owner-supplied native qualification record: a pinned JSON file outside the
  // compared packages, referenced by its own SHA-256. This gate is pure structure validation
  // only; the live profile match at dispatch alone can report execution_qualified.
  if (wave.native_qualification !== undefined && wave.native_qualification !== null) {
    const pin = wave.native_qualification
    if (!isAbsolute(pin?.path ?? "") || pin.path !== resolve(pin.path) || !digest(pin.sha256)) throw new Error("native qualification record pin required")
    for (const arm of ["baseline", "candidate"]) {
      const directory = wave.arms?.[arm]?.directory
      if (typeof directory === "string" && (pin.path === directory || pin.path.startsWith(`${directory}/`))) throw new Error("native qualification record must live outside compared packages")
    }
    validateNativeQualificationRecord(pinnedJSON(pin))
  }
  // The commit-set write permission: an optional dossier pin plus its targets seed,
  // both outside the compared packages. A pinned plan REQUIRES the seed — the plan's
  // @aliases resolve at run time against the store's seeded targets.json — and a
  // missing seed refuses admission with the existing vocabulary.
  if (wave.commit_plan !== undefined && wave.commit_plan !== null) {
    const plan = wave.commit_plan
    if (!isAbsolute(plan?.path ?? "") || plan.path !== resolve(plan.path) || !digest(plan.sha256)) throw new Error("commit plan dossier pin required")
    for (const arm of ["baseline", "candidate"]) {
      const directory = wave.arms?.[arm]?.directory
      if (typeof directory === "string" && (plan.path === directory || plan.path.startsWith(`${directory}/`))) throw new Error("commit plan dossier must live outside compared packages")
    }
    pinnedJSON(plan)
    if (wave.targets === undefined || wave.targets === null) throw new Error("targets seed pin required with a commit plan")
  }
  // The targets seed is pin-validated whenever present, never silently ignored: a
  // seed alone permits no write and arms nothing, but a bogus orphan still refuses
  // on the standard pin grammar, and the seed must resolve INSIDE the staged inputs
  // tree the container actually sees — a seed elsewhere would pass admission while
  // the container never receives it.
  if (wave.targets !== undefined && wave.targets !== null) {
    const targets = wave.targets
    if (!isAbsolute(targets?.path ?? "") || targets.path !== resolve(targets.path) || !digest(targets.sha256)) throw new Error("absolute file pin and SHA-256 required")
    for (const arm of ["baseline", "candidate"]) {
      const directory = wave.arms?.[arm]?.directory
      if (typeof directory === "string" && (targets.path === directory || targets.path.startsWith(`${directory}/`))) throw new Error("targets seed must live outside compared packages")
    }
    pinnedJSON(targets)
    const staged = wave.staging?.inputs
    if (typeof staged === "string" && staged === resolve(staged) && targets.path !== staged && !targets.path.startsWith(`${staged}/`)) throw new Error("targets seed must live inside the staged inputs tree")
  }
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
  // Capability probes and manifest fields never set execution_qualified. The owned run
  // configuration binds it at dispatch to a live-validated owner-supplied record; this
  // pure manifest validator keeps reporting the honest unqualified default.
  return { ...result, execution_qualified: false, blocker: "native recorder ready/open/seal integration is not qualified" }
}

/** The schema is a harness qualification dossier, NOT a claimed OpenCode response schema.
 * Its attachments are observed effective config, tool.list() output, and an OpenAI-shaped request.
 * Other wire formats require a reviewed decoder; they are not guessed here.
 * The optional third parameter is the owned composition's in-container attachment
 * resolution root: absent, the dossier's own canonical pins are read (the host-side
 * wave validation and the legacy host proof, unchanged); present, each attachment
 * resolves by basename beneath the root, hash-bound to the pin's own sha.
 */
export function qualifyConditions(q, identity, root) {
  if (q?.schema !== "oc-mem-conditions/1" || q.status !== "qualified" || q.mapping !== "execute-permission-v1") throw new Error("condition mapping is not qualified")
  for (const key of ["runtime_sha256", "archive_sha256", "model"]) if (!identity[key] || q[key] !== identity[key]) throw new Error(`condition qualification ${key} mismatch`)
  if (q.model !== WAVE_MODEL || !digest(q.runtime_sha256) || !digest(q.archive_sha256)) throw new Error("exact qualified model/runtime/arm required")
  if (!Array.isArray(q.memory_tool_ids) || !q.memory_tool_ids.length || q.memory_tool_ids.some(id => !/^mem_[a-z_]+$/.test(id)) || new Set(q.memory_tool_ids).size !== q.memory_tool_ids.length) throw new Error("qualified Memory tool inventory required")
  for (const condition of ["direct", "search"]) {
    const observation = q.observations?.[condition]
    if (!observation) throw new Error("both condition observations required")
    const config = pinnedJSON(observation.config, root), catalog = pinnedJSON(observation.catalog, root), request = pinnedJSON(observation.request, root)
    const rule = config.permissions?.filter(p => p.action === "execute" && p.resource === "*").at(-1)
    if (rule?.effect !== (condition === "direct" ? "deny" : "allow")) throw new Error("effective execute permission does not match condition")
    if (!Array.isArray(catalog) || q.memory_tool_ids.some(id => !catalog.some(t => t.id === id))) throw new Error("observed registered catalog lacks qualified Memory tools")
    if (!Array.isArray(request.tools)) throw new Error("observed request tool catalog required")
    const names = request.tools.map(t => t.function?.name ?? t.name)
    if (condition === "direct" ? names.includes("execute") || q.memory_tool_ids.some(id => !names.includes(id)) : !names.includes("execute") || !names.includes("search") || q.memory_tool_ids.every(id => names.includes(id))) throw new Error("observed request does not implement the condition")
  }
  return q
}
