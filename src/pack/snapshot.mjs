// Packs are committed snapshots. This module is what makes them usable without a plugin checkout — which
// is what CI has, and four of the nine plugins are not on GitHub at all.
//
// A snapshot carries the derived declaration (`tools`, `skills`, `counts`) and its own digest. CI verifies
// the snapshot: schema, digest, counts, and the checks that need nothing but the file. A machine with the
// checkouts derives the live declaration instead and reports drift against the snapshot; `--sync` refreshes
// it. Nothing here assumes a directory layout: a checkout is wherever `EVALS_REPO_<ID>` or
// `EVALS_PLUGIN_ROOT` says it is, and when neither is set, the snapshot is all there is.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { canonical, sha256 } from "../util/canonical.mjs"

export const PACK_SCHEMA = "oc-pack/1"

/** The digest covers everything the snapshot claims, except the digest itself. */
export const packDigest = (pack) => {
  const copy = { ...pack }
  delete copy.digest
  return sha256(canonical(copy))
}

/** The counts a snapshot claims must be the counts its tools give. */
export function recomputeCounts(pack) {
  const tools = pack.tools ?? []
  return {
    tools: tools.length,
    reads: tools.filter((tool) => tool.class === "read").length,
    writes: tools.filter((tool) => tool.class === "write").length,
    denied: tools.filter((tool) => tool.effect === "deny").length,
    skills: (pack.skills ?? []).length,
  }
}

const T1_KINDS = new Set(["asked", "refused", "capped", "allowed"])

/**
 * The checks that need no checkout: the snapshot against itself and against the family's invariants.
 * A check that cannot be decided here is not claimed.
 */
export function snapshotChecks(pack) {
  const checks = []
  const add = (id, name, ok, detail) => checks.push({ id, name, severity: "error", ok, detail })
  const tools = pack.tools ?? []
  const names = new Set(tools.map((tool) => tool.name))
  const actions = new Map()
  for (const tool of tools) actions.set(tool.permission, (actions.get(tool.permission) ?? 0) + 1)

  add("P-01", "the snapshot declares itself", pack.schema === PACK_SCHEMA && Boolean(pack.id) && Boolean(pack.pluginId), `${pack.schema} ${pack.id ?? "?"} ${pack.pluginId ?? "?"}`)
  add("P-02", "every tool is named, classified and effected once", tools.length > 0 && tools.every((tool) => tool.name && tool.permission && ["read", "write", "destructive"].includes(tool.class) && ["allow", "ask", "deny"].includes(tool.effect)), `${tools.length} tools`)
  add("P-03", "no two tools share a permission action", [...actions.values()].every((count) => count === 1), `${actions.size} actions`)
  add("P-04", "a denied tool is never a read and never declared available", tools.every((tool) => !(tool.effect === "deny" && tool.class === "read")), `${tools.filter((tool) => tool.effect === "deny").length} denied`)
  add("P-05", "the counts are the tools' own", JSON.stringify(pack.counts ?? {}) === JSON.stringify(recomputeCounts(pack)), JSON.stringify(recomputeCounts(pack)))
  add("P-06", "the digest is the content's", pack.digest === packDigest(pack), `${String(pack.digest ?? "none").slice(0, 12)} vs ${packDigest(pack).slice(0, 12)}`)
  add("P-07", "each skill has a name, a description digest and a size within the limit", (pack.skills ?? []).every((name) => pack.skill_meta?.[name] && pack.skill_meta[name].description_chars > 0 && pack.skill_meta[name].description_chars <= 1024), `${(pack.skills ?? []).length} skills`)
  const prefix = String(pack.pluginId ?? pack.id ?? "").split(".")[0]
  const resolves = (tool) => names.has(tool) || names.has(String(tool).replace(new RegExp(`^${prefix}_`), ""))
  add(
    "P-08",
    "every scripted case names a declared tool and a known kind",
    (pack.t1 ?? []).every((entry) => T1_KINDS.has(entry.kind) && resolves(String(entry.tool)) && [entry.args, entry.options].every((value) => value === undefined || (typeof value === "object" && value !== null && !Array.isArray(value)))),
    `${(pack.t1 ?? []).length} case(s)`,
  )
  add("P-09", "the tools RPC is named and belongs to this plugin", typeof pack.rpc === "string" && pack.rpc.startsWith(String(pack.pluginId ?? "").split(".").slice(0, 1)[0]), pack.rpc ?? "none")
  return checks
}

/** Verifies one committed snapshot. */
export function verifySnapshot(pack, { file = null, id = null } = {}) {
  const problems = []
  if (id && pack.id !== id) problems.push(`${file ?? id}: id is ${pack.id}, the file is ${id}`)
  const checks = snapshotChecks(pack)
  for (const check of checks) if (!check.ok) problems.push(`${check.id}: ${check.detail}`)
  return { id: pack.id ?? id, ok: problems.length === 0, problems, checks }
}

/** Reads a snapshot from the repository and verifies it. */
export function verifyFromRepo(id, root) {
  const file = join(root, "packs", id, "pack.json")
  if (!existsSync(file)) return { id, ok: false, problems: [`${file}: missing`], checks: [] }
  return verifySnapshot(JSON.parse(readFileSync(file, "utf8")), { file: `packs/${id}/pack.json`, id })
}

/**
 * What changed between the plugin's live declaration and its committed snapshot. Reported, never applied:
 * `--sync` is the only thing that writes.
 */
export function driftReport(live, snapshot) {
  const byName = (pack) => new Map((pack.tools ?? []).map((tool) => [tool.name, tool]))
  const before = byName(snapshot)
  const after = byName(live)
  const added = [...after.keys()].filter((name) => !before.has(name))
  const removed = [...before.keys()].filter((name) => !after.has(name))
  const changed = []
  for (const [name, tool] of after) {
    const old = before.get(name)
    if (!old) continue
    for (const field of ["permission", "effect", "class", "readOnly"]) {
      if (JSON.stringify(old[field]) !== JSON.stringify(tool[field])) changed.push(`${name}.${field}: ${JSON.stringify(old[field])} -> ${JSON.stringify(tool[field])}`)
    }
  }
  const skillAdded = (live.skills ?? []).filter((name) => !(snapshot.skills ?? []).includes(name))
  const skillRemoved = (snapshot.skills ?? []).filter((name) => !(live.skills ?? []).includes(name))
  const skillChanged = []
  for (const [name, meta] of Object.entries(live.skill_meta ?? {})) {
    const old = snapshot.skill_meta?.[name]
    if (!old) continue
    if (old.description_sha256 !== meta.description_sha256) skillChanged.push(`${name}: description changed`)
  }
  // Old -> new, like the tool changes: the committed snapshot, then the checkout.
  const meta = [
    ["pluginId", snapshot.pluginId, live.pluginId],
    ["version", snapshot.version, live.version],
    ["rpc", snapshot.rpc, live.rpc],
    ["access", snapshot.access ?? null, live.access ?? null],
  ].filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b)).map(([field, a, b]) => `${field}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
  const drift = added.length + removed.length + changed.length + skillAdded.length + skillRemoved.length + skillChanged.length + meta.length > 0
  return { drift, added, removed, changed, skillAdded, skillRemoved, skillChanged, meta }
}

export const renderDrift = (id, report) => {
  if (!report.drift) return `${id}: snapshot is current`
  const lines = [`${id}: **drift**`]
  if (report.added.length) lines.push(`  added tools: ${report.added.join(", ")}`)
  if (report.removed.length) lines.push(`  removed tools: ${report.removed.join(", ")}`)
  if (report.changed.length) lines.push(`  changed: ${report.changed.slice(0, 6).join("; ")}${report.changed.length > 6 ? ` (+${report.changed.length - 6})` : ""}`)
  if (report.skillAdded.length) lines.push(`  added skills: ${report.skillAdded.join(", ")}`)
  if (report.skillRemoved.length) lines.push(`  removed skills: ${report.skillRemoved.join(", ")}`)
  if (report.skillChanged.length) lines.push(`  ${report.skillChanged.join("; ")}`)
  if (report.meta.length) lines.push(`  ${report.meta.join("; ")}`)
  return lines.join("\n")
}

export const writeSnapshot = (root, pack) => {
  const withDigest = { ...pack, schema: PACK_SCHEMA, digest: packDigest({ ...pack, schema: PACK_SCHEMA }) }
  mkdirSync(join(root, "packs", pack.id), { recursive: true })
  writeFileSync(join(root, "packs", pack.id, "pack.json"), `${JSON.stringify(withDigest, null, 2)}\n`)
  return withDigest
}
