#!/usr/bin/env node
// Builds `packs/<id>/inputs.json`: the PARAMETER NAMES of each tool of a pack (nested through object properties and array items), so `evals compile` can refuse a clause that names an argument the
// tool does not have (`args.text` on a tool whose parameter is `message`). The pack says which tools exist; the plugins' released tool list says what they take. Captured from a signed-in
// host (OpenCode 2.3.2): what Code Mode's `search` lists for each namespace, `{ path, signature }` each, parsed by src/fake/ts-signature.mjs, and cut to names (no descriptions: they are
// the plugin's text, and these files are only for the names). GitHub and Jira take theirs from their `mcp.json` (the vendor's own schemas).
//
//   node scripts/capture-inputs.mjs <dir of <namespace>.json files, each a list of { path, signature }>
//
// A tool no source lists (a hidden one, or a namespace it serves few tools of) has no entry and is not checked: the check only says what it knows.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseSignature } from "../src/fake/ts-signature.mjs"

const ROOT = resolve(import.meta.dirname, "..")

/** A JSON Schema as the tree of its parameter names: `{ p: { name: node }, req: [...], open?: true, items?: node }`. */
export function paramTree(schema, depth = 0) {
  // A schema the listing could not type (`unknown`, `any`, a bare `{}`) is any value, an object included: open, so a path under it (`args.body.trashed`) is not refused for a scalar it is not (review of #14, A1).
  if (!schema || typeof schema !== "object" || depth > 8) return { open: true }
  const node = {}
  const options = schema.anyOf ?? schema.oneOf
  const types = [].concat(schema.type ?? [])
  const typed = types.length > 0 || schema.enum !== undefined || schema.const !== undefined || schema.properties !== undefined || schema.items !== undefined || Array.isArray(options)
  if (!typed) return { open: true }
  if (types.includes("object") && !schema.properties && !Array.isArray(options)) node.open = true
  if (Array.isArray(options)) {
    const merged = options.map((o) => paramTree(o, depth + 1))
    for (const m of merged) {
      if (m.p) node.p = { ...(node.p ?? {}), ...m.p }
      if (m.items) node.items = m.items
      if (m.open) node.open = true
    }
  }
  if (schema.properties && typeof schema.properties === "object") {
    node.p = { ...(node.p ?? {}), ...Object.fromEntries(Object.entries(schema.properties).map(([name, child]) => [name, paramTree(child, depth + 1)])) }
    if (Array.isArray(schema.required) && schema.required.length) node.req = schema.required
  }
  if (schema.additionalProperties && (schema.type === "object" || schema.properties || schema.additionalProperties === true || typeof schema.additionalProperties === "object") && !(schema.properties && schema.additionalProperties === false)) node.open = true
  if (schema.type === "object" && !schema.properties && !Array.isArray(options)) node.open = true
  if (schema.items) node.items = paramTree(schema.items, depth + 1)
  if (schema.type === "array" && !schema.items) node.items = { open: true }
  return node
}

/** Both trees' names: a name either source has is a name the tool may take (a later host listing can carry a field the tag's snapshot predates; refusing a real argument is worse than letting a misspelt one through). */
export function mergeTrees(a, b) {
  if (!a) return b
  if (!b) return a
  const out = {}
  const names = new Set([...Object.keys(a.p ?? {}), ...Object.keys(b.p ?? {})])
  if (names.size) out.p = Object.fromEntries([...names].map((n) => [n, mergeTrees(a.p?.[n], b.p?.[n]) ?? {}]))
  if (a.req || b.req) out.req = [...new Set([...(a.req ?? []), ...(b.req ?? [])])].filter((n) => n in (out.p ?? {}) && (a.req ?? []).includes(n) && (b.req ?? []).includes(n))
  if (!out.req?.length) delete out.req
  if (a.open || b.open) out.open = true
  if (a.items || b.items) out.items = mergeTrees(a.items, b.items)
  return out
}

/** `{ tool name: tree }` from a list of `{ path, signature }`. */
export function treesFrom(entries) {
  const out = {}
  for (const entry of entries) {
    try {
      const { name, input } = parseSignature(entry.signature)
      out[name] = paramTree(input)
    } catch {
      // a signature this parser cannot read has no entry: that tool is not checked
    }
  }
  return out
}

/** Where each plugin's recorded tool schemas are, in its own source at the pack's release tag (`git archive v<version>`), best first. A file is `{ tools: [{ name, inputSchema }] }` or a list. */
export const SNAPSHOTS = {
  affinity: ["test/unit/affinity-tools-list.json"],
  ashby: ["test/fixtures/live-tools.json"],
  browse: ["test/fixtures/live-tools.json"],
  elevenlabs: ["test/fixtures/live-tools.json"],
  granola: ["test/fixtures/live-tools.json"],
  jira: ["test/fixtures/live-tools.json"],
  linear: ["test/fixtures/live-tools.json"],
  metaview: ["test/fixtures/live-tools.json", "test/unit/metaview-live-tools.json"],
  notion: ["test/fixtures/live-tools.json"],
  openrouter: ["test/fixtures/live-tools.json"],
  plaud: ["test/fixtures/live-tools.json"],
  slack: ["test/fixtures/live-tools.json"],
  tavily: ["test/fixtures/live-tools.json"],
  wisprflow: ["test/fixtures/live-tools.json"],
  x: ["test/unit/x-live-tools.json", "test/fixtures/live-tools.json"],
}

/** `{ tool name: tree }` from a recorded snapshot's tools that carry a JSON input schema. */
export function treesFromSnapshot(json) {
  const list = Array.isArray(json) ? json : (json.tools ?? [])
  const out = {}
  for (const tool of list) {
    if (!tool?.name) continue
    if (tool.inputSchema && typeof tool.inputSchema === "object") out[tool.name] = paramTree(tool.inputSchema)
    // a snapshot that kept only the top-level parameter names (x's live-tools.json): those names, whatever is nested under them left open
    else if (Array.isArray(tool.inputParams)) out[tool.name] = { p: Object.fromEntries(tool.inputParams.map((n) => [n, { open: true }])) }
  }
  return out
}

/** The tools a plugin defines in its own source (not in any snapshot): `node scripts/capture-inputs.mjs` reads `own-inputs.json` beside this file, written by hand from each plugin's tool table at the tag, each with the file it came from. */
/** The label of what a signed-in host's Code Mode listing gave: a vendor server's tools/list for an MCP-backed plugin (read-only, through the real profile), the plugin's own tool table for the rest. */
const HOST_LABEL = "a signed-in OpenCode 2.3.2 host's Code Mode listing (read-only): the vendor server's tools/list, or the plugin's own tool table"
const OWN = join(import.meta.dirname, "own-inputs.json")

export function build(id, trees, sources, unlisted = {}) {
  return { schema: "oc-inputs/2", plugin: id, sources, ...(Object.keys(unlisted).length ? { unlisted } : {}), tools: Object.fromEntries(Object.entries(trees).sort(([a], [b]) => a.localeCompare(b))) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const dir = args.find((a) => !a.startsWith("--"))
  const hostDir = args.includes("--host") ? args[args.indexOf("--host") + 1] : null
  if (!dir) {
    console.error("usage: capture-inputs.mjs <dir of plugin sources, <id>/ each a `git archive` of its release tag> [--host <dir of <namespace>.json host listings>]")
    process.exit(2)
  }
  const own = existsSync(OWN) ? JSON.parse(readFileSync(OWN, "utf8")) : {}
  for (const id of readdirSync(join(ROOT, "packs")).sort()) {
    const pack = JSON.parse(readFileSync(join(ROOT, "packs", id, "pack.json"), "utf8"))
    const file = join(ROOT, "packs", id, "inputs.json")
    const previous = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { tools: {}, sources: {} }
    const trees = {}
    const sources = {}
    const take = (label, found) => {
      for (const [name, tree] of Object.entries(found)) {
        if (name in trees) {
          // already from a better source: widen it with a name the later host listing has that it lacks
          if (label === HOST_LABEL) {
            const merged = mergeTrees(trees[name], tree)
            if (JSON.stringify(merged) !== JSON.stringify(trees[name])) {
              trees[name] = merged
              ;(sources["widened with names a signed-in host's later listing has"] ??= []).push(name)
            }
          }
          continue
        }
        trees[name] = tree
        ;(sources[label] ??= []).push(name)
      }
    }
    // 1. the plugin's recorded tool snapshot at its release tag
    for (const rel of SNAPSHOTS[id] ?? []) {
      const path = join(dir, id, rel)
      if (existsSync(path)) take(`${id} v${pack.version} ${rel}`, treesFromSnapshot(JSON.parse(readFileSync(path, "utf8"))))
    }
    // 2. the vendor's own schemas, kept in the pack (GitHub, Jira)
    const mcp = join(ROOT, "packs", id, "mcp.json")
    if (existsSync(mcp)) take(`packs/${id}/mcp.json (the vendor's tools/list)`, Object.fromEntries(JSON.parse(readFileSync(mcp, "utf8")).tools.map((t) => [t.name, paramTree(t.inputSchema)])))
    // 3. the plugin's own tool table in source, written down by hand in own-inputs.json with the file each came from
    for (const [label, tools] of Object.entries(own[id] ?? {})) take(label, Object.fromEntries(Object.entries(tools).map(([name, schema]) => [name, paramTree(schema)])))
    // 4. a signed-in host's Code Mode listing (names only), kept from the earlier capture for what nothing above lists
    if (hostDir && existsSync(join(hostDir, `${id}.json`))) take(HOST_LABEL, treesFrom(JSON.parse(readFileSync(join(hostDir, `${id}.json`), "utf8"))))
    const kept = previous.tools ?? {}
    if (Object.keys(kept).length) take(HOST_LABEL, kept)
    const known = new Set(pack.tools.map((t) => t.name))
    const final = Object.fromEntries(Object.entries(trees).filter(([name]) => known.has(name)))
    for (const label of Object.keys(sources)) sources[label] = sources[label].filter((n) => known.has(n)).sort()
    for (const label of Object.keys(sources)) if (!sources[label].length) delete sources[label]
    // a tool its vendor's server does not list to this sign-in has no schema to record: it says why, and a clause's argument on it is refused
    const unlisted = Object.fromEntries(Object.entries(own._unlisted?.[id] ?? {}).filter(([name]) => known.has(name) && !(name in final)))
    writeFileSync(file, `${JSON.stringify(build(id, final, sources, unlisted))}\n`)
    const missing = pack.tools.map((t) => t.name).filter((n) => !(n in final) && !(n in unlisted))
    console.log(`${id}: ${Object.keys(final).length} of ${pack.tools.length}${missing.length ? `  MISSING ${missing.join(" ")}` : ""}`)
  }
}
