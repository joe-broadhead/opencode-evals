#!/usr/bin/env node
// Builds `packs/<id>/mcp.json`: the tool list a user sees for a plugin whose tools come from a vendor's MCP server (GitHub, Jira), with each tool's
// description, input schema and annotations, for the fake MCP server (src/fake/mcp-server.ts) to serve. The pack says WHICH tools exist
// (names, read or write); this file says what each one looks like to the model. Two sources, because neither vendor publishes its server's
// list in the plugin:
//
//   github <dir of *.json>   GitHub's open-source server keeps one `__toolsnaps__/<tool>.snap` per tool (description, inputSchema, annotations), exact.
//                            The hosted server adds a few tools the open-source one lacks: those are `derived` (a name, a neutral description,
//                            an open schema) and marked so.
//   jira <signatures.json>   What a signed-in host lists for the plugin's tools (Code Mode's `search`: { path, description, signature } each), turned back
//                            into JSON Schema by src/fake/ts-signature.mjs. Pack tools the host did not list for a signed-in user (the destructive
//                            ones the sign-in's scope does not grant) are `unserved`: the model never sees them, so the fake does not offer them.
//
//   node scripts/mcp-catalog.mjs github /path/to/snaps-as-json
//   node scripts/mcp-catalog.mjs jira   /path/to/jira-signatures.json
//
// A plugin's own tools (`events_list`, GitHub's `api`) are registered by the plugin itself, not served by the vendor, and are left out.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseSignature } from "../src/fake/ts-signature.mjs"

const ROOT = resolve(import.meta.dirname, "..")
export const OWN_TOOLS = { github: ["events_list", "api"], jira: ["events_list"] }
const OPEN_SCHEMA = { type: "object", properties: {}, additionalProperties: true }

const humanize = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())

/** The annotations a tool without a published snapshot gets, from what the pack knows. */
const annotationsOf = (tool) => ({ readOnlyHint: Boolean(tool.readOnly), ...(tool.effect === "deny" || /^(delete|remove)/i.test(tool.name) ? { destructiveHint: true } : {}) })

export function githubCatalog(pack, snaps, meta = {}, extras = null) {
  const tools = []
  const extra = new Map((extras?.tools ?? []).map((t) => [t.name, t]))
  for (const tool of pack.tools) {
    if (OWN_TOOLS.github.includes(tool.name)) continue
    const snap = snaps[tool.name]
    const more = extra.get(tool.name)
    if (snap) tools.push({ name: tool.name, description: snap.description, inputSchema: snap.inputSchema, annotations: snap.annotations ?? annotationsOf(tool), source: "snapshot" })
    // A tool of the hosted server that the open-source snapshots lack, with whatever GitHub publishes of it (packs/github/mcp-extras.json).
    else if (more) tools.push({ name: tool.name, description: more.description, inputSchema: more.inputSchema, annotations: annotationsOf(tool), source: more.source })
    else tools.push({ name: tool.name, description: `${humanize(tool.name)}.`, inputSchema: OPEN_SCHEMA, annotations: annotationsOf(tool), source: "derived" })
  }
  return { schema: "oc-mcp-catalog/1", plugin: "github", server: "github", pack_version: pack.version, provenance: { snapshots: meta.snapshots ?? "github/github-mcp-server __toolsnaps__", ...(extras?.provenance ?? {}), derived: extras?.provenance?.derived ?? "tools the hosted server lists and the open-source server's snapshots lack: a name, a neutral description and an open schema" }, tools, unserved: [] }
}

export function jiraCatalog(pack, signatures, meta = {}) {
  const byName = new Map()
  for (const entry of signatures) {
    const { name, input } = parseSignature(entry.signature)
    byName.set(name, { description: neutral(entry.description), input: JSON.parse(neutral(JSON.stringify(input))) })
  }
  const tools = []
  const unserved = []
  for (const tool of pack.tools) {
    if (OWN_TOOLS.jira.includes(tool.name)) continue
    const listed = byName.get(tool.name)
    if (!listed) {
      unserved.push(tool.name)
      continue
    }
    tools.push({ name: tool.name, description: listed.description, inputSchema: listed.input, annotations: annotationsOf(tool), source: "host-listing" })
  }
  return { schema: "oc-mcp-catalog/1", plugin: "jira", server: "jira", pack_version: pack.version, provenance: { listing: meta.listing ?? "a signed-in host's Code Mode listing of the plugin's tools, with Array item types lost in the rendering" }, tools, unserved }
}

/** The catalog of a plugin against its pack: names must be the pack's tools less the plugin's own and the unserved. Returns problems. */
export function catalogProblems(catalog, pack) {
  const problems = []
  const own = OWN_TOOLS[catalog.plugin] ?? []
  const expected = pack.tools.map((t) => t.name).filter((n) => !own.includes(n) && !(catalog.unserved ?? []).includes(n))
  const have = catalog.tools.map((t) => t.name)
  for (const n of expected) if (!have.includes(n)) problems.push(`${n} is a tool of the pack the catalog does not serve`)
  for (const n of have) if (!expected.includes(n)) problems.push(`${n} is served and is not a tool of the pack`)
  for (const t of catalog.tools) if (!t.description || t.inputSchema?.type !== "object") problems.push(`${t.name} has no description or no object schema`)
  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [kind, input] = process.argv.slice(2)
  if (!["github", "jira"].includes(kind) || !input) {
    console.error("usage: mcp-catalog.mjs github <dir of snapshot json> | jira <signatures.json>")
    process.exit(2)
  }
  const pack = JSON.parse(readFileSync(join(ROOT, "packs", kind, "pack.json"), "utf8"))
  let catalog
  if (kind === "github") {
    const snaps = Object.fromEntries(readdirSync(input).filter((f) => f.endsWith(".json")).map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(input, f), "utf8"))]))
    const extrasFile = join(ROOT, "packs", "github", "mcp-extras.json")
    catalog = githubCatalog(pack, snaps, { snapshots: "github/github-mcp-server v2.2.0, pkg/github/__toolsnaps__" }, existsSync(extrasFile) ? JSON.parse(readFileSync(extrasFile, "utf8")) : null)
  } else {
    catalog = jiraCatalog(pack, JSON.parse(readFileSync(input, "utf8")), { listing: "OpenCode 2.3.2, opencode-jira, a signed-in host's Code Mode listing (descriptions in full; argument types as rendered, Array item types lost)" })
  }
  const problems = catalogProblems(catalog, pack)
  if (problems.length) {
    console.error(problems.join("\n"))
    process.exit(1)
  }
  writeFileSync(join(ROOT, "packs", kind, "mcp.json"), `${JSON.stringify(catalog, null, 1)}\n`)
  console.log(`${kind}: ${catalog.tools.length} tool(s) served${catalog.unserved.length ? `, ${catalog.unserved.length} unserved (${catalog.unserved.join(", ")})` : ""}; ${["snapshot", "host-listing", "readme", "derived", ].map((k) => `${catalog.tools.filter((t) => t.source === k).length} ${k}`).filter((t) => !t.startsWith("0 ")).join(", ")}`)
}
