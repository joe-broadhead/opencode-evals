#!/usr/bin/env node
// Builds `packs/<id>/live.json`: the tool names a signed-in OpenCode host's Code Mode listing shows for each plugin (src/pack/listing.mjs). Read-only: `search({ namespace })` lists, no tool is
// called. A plugin's own build can be newer than the pack pins, and an MCP-backed plugin lists what its vendor's server lists today, so this is where an unclassified tool shows up.
//
//   node scripts/capture-live.mjs <dir of <namespace>.json files, each a list of { path, signature }>

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { nameOfPath } from "../src/pack/listing.mjs"

const ROOT = resolve(import.meta.dirname, "..")
const dir = process.argv[2]
if (!dir) {
  console.error("usage: capture-live.mjs <dir of <namespace>.json files>")
  process.exit(2)
}
const listedAt = process.argv.includes("--date") ? process.argv[process.argv.indexOf("--date") + 1] : new Date().toISOString().slice(0, 10)
for (const id of readdirSync(join(ROOT, "packs")).sort()) {
  const file = join(dir, `${id}.json`)
  if (!existsSync(file)) continue
  const names = [...new Set(JSON.parse(readFileSync(file, "utf8")).map((entry) => nameOfPath(entry.path)).filter(Boolean))].sort()
  // a namespace the host serves few or none of (x lists one tool before a sign-in scope is chosen; openrouter and voice list none) says so rather than recording an empty listing as a listing
  if (!names.length) {
    console.log(`${id}: the host lists none (no live.json)`)
    continue
  }
  writeFileSync(join(ROOT, "packs", id, "live.json"), `${JSON.stringify({ schema: "oc-live/1", plugin: id, listedAt, via: "a signed-in OpenCode host's Code Mode listing (read-only: search({ namespace }), no tool call)", names }, null, 1)}\n`)
  console.log(`${id}: ${names.length} listed`)
}
