import { sha256, canonical } from "../../src/util/canonical.mjs"
const INERT = new Set(["forget", "promote", "status", "grants", "members", "ingest", "cursor"])
export function memoryProfile(pack, catalog) {
  if (pack.id !== "mem" || pack.pluginId !== "mem" || pack.package !== "@joe-broadhead/opencode-mem" || pack.access !== undefined) throw new Error("Memory source profile requires its actual package/host-permission contract; it does not have an access setting")
  if (catalog?.source?.kind !== "source-snapshot-not-runtime" || !Array.isArray(catalog.tools) || new Set(catalog.tools.map((t) => t.name)).size !== catalog.tools.length) throw new Error("invalid Memory source catalog")
  const declared = new Set(pack.tools.map((t) => t.name))
  const tools = catalog.tools.map((t) => {
    if (!declared.has(t.name) || t.options?.namespace !== "mem" || t.input?.type !== "object" || (!INERT.has(t.name) && t.input.additionalProperties !== false)) throw new Error(`Memory tool has an undeclared/open schema: ${t.name}`)
    return { name: t.name, permission: `mem_${t.name}`, inert: INERT.has(t.name), schema_sha256: sha256(canonical(t.input)), head117: t.description.slice(0,117), actions: t.input.properties?.action?.enum ?? [], evidence: "source-only" }
  })
  return { schema: "oc-mem-profile/1", source: catalog.source, permission_model: { kind: "host-rules-and-action-assertions", access_option: null, effects: ["allow", "deny", "ask-approved", "ask-declined"] }, tools }
}

function validate(schema, value, path, out) {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) { out.push(`${path}: object required`); return }
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) out.push(`${path}.${key}: required`)
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) validate(schema.properties[k], v, `${path}.${k}`, out)
      else if (schema.additionalProperties === false) out.push(`${path}.${k}: unknown`)
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) out.push(`${path}: array required`)
    else { if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push(`${path}: too many items`); if (schema.items) value.forEach((v,i) => validate(schema.items,v,`${path}.${i}`,out)) }
  } else if (schema.type === "integer" ? !Number.isInteger(value) : schema.type && typeof value !== schema.type) out.push(`${path}: ${schema.type} required`)
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path}: unknown enum value`)
  if (schema.maxLength !== undefined && typeof value === "string" && value.length > schema.maxLength) out.push(`${path}: too long`)
}
const conditional = {
  page: { write: ["path", "content"], read: ["path"], append: ["path", "content", "section"], replace: ["path", "content", "section"], delete: ["path"] },
  wiki: { write: ["wiki_id", "filename", "content"], append: ["wiki_id", "filename", "content"], create: ["name"], status: ["wiki_id"] },
  revise: { correct: ["id", "content"] }, commitments: { add: ["what"], update: ["id"], delete: ["id"] },
}
export function checkMemoryInput(catalog, tool, args) {
  const schema = catalog.tools.find((t) => t.name === tool)?.input
  if (!schema) return [`unknown captured Memory tool: ${tool}`]
  const out = []; validate(schema, args, tool, out)
  for (const key of conditional[tool]?.[args?.action] ?? []) if (!Object.hasOwn(args, key)) out.push(`${tool}.${key}: required for ${args.action}`)
  return out
}

// This gate does not replace release validation. A synthetic unit sidecar cannot become a runtime observation.
export function memoryReadiness(pack, { registered = null, rules = null, finalArtifact = null } = {}) {
  const missing = []
  if (!pack.release?.commit || !pack.release?.tag) missing.push("released artifact metadata")
  for (const [name, sidecar] of [["registered",registered],["rules",rules]]) if (!sidecar || sidecar.synthetic || sidecar.evidence !== "contained-runtime") missing.push(`actual contained ${name} sidecar`)
  if (!finalArtifact?.archive_sha256 || !finalArtifact?.source_commit) missing.push("final tarball and source pins")
  return { ready: !missing.length, missing }
}
