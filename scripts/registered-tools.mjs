#!/usr/bin/env node
// Builds `packs/<id>/registered.json`: the tools each plugin's BUILT release registers when the host loads it (src/pack/listing.mjs). One scripted trial loads all 24 builds the way a round
// does (EVALS_COMPANIONS: id -> built directory) and lists every namespace with Code Mode's `search`, so what is recorded is what a model is offered, not what a declaration says. No
// sign-in: a plugin that registers a vendor's tools only after sign-in lists its own tools alone here, and its vendor tools come from `live.json`.
//
//   EVALS_COMPANIONS=<file> node scripts/registered-tools.mjs      writes packs/<id>/registered.json (needs Docker, the sandbox image, OpenCode 2.3.x and bun)
//   node scripts/registered-tools.mjs --check                      fails when a file differs from a fresh listing

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { scriptedRun, execute, executeValue } from "../src/p0/run.mjs"
import { loadPacks } from "../src/run/lockdown.mjs"
import { nameOfPath } from "../src/pack/listing.mjs"

const ROOT = resolve(import.meta.dirname, "..")

export async function listRegistered({ companions = process.env.EVALS_COMPANIONS, tmp = process.env.EVALS_TMP ?? process.env.TMPDIR } = {}) {
  if (!companions || !existsSync(companions)) throw new Error("set EVALS_COMPANIONS to the file mapping each plugin id to its built directory")
  const map = JSON.parse(readFileSync(companions, "utf8"))
  const packs = loadPacks()
  const cases = packs.map((pack) => ({ id: `tools-registered-${pack.id}`, prompt: execute(`const names = new Array(); let o = 0; for (;;) { const r = await search({ namespace: '${pack.id}', limit: 100, offset: o }); names.push(...r.items.map((i) => i.path)); if (!r.next) break; o = r.next.offset } return JSON.stringify(names)`) }))
  const arm = { package: typeof map.slack === "string" ? map.slack : map.slack?.package, options: {}, companions, guard: true }
  const run = await scriptedRun({ plugin: "slack", cases, arm, options: { iteration: "registered", auth: "none", probe: true }, tmp })
  try {
    const out = {}
    for (const pack of packs) {
      const call = run.trials[`tools-registered-${pack.id}`]?.calls?.[0]
      const value = call ? executeValue(call) : null
      const list = typeof value === "string" ? JSON.parse(value) : value
      if (!Array.isArray(list)) throw new Error(`${pack.id}: the host did not list its namespace (${String(call?.output ?? call?.error ?? "no call").slice(0, 120)})`)
      out[pack.id] = list.map(nameOfPath).filter(Boolean).sort()
    }
    return { host: run.trials[cases[0].id].summary?.opencode ?? "opencode", names: out }
  } finally {
    run.cleanup()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check")
  const { host, names } = await listRegistered()
  let bad = 0
  for (const pack of loadPacks()) {
    const body = { schema: "oc-registered/1", plugin: pack.id, release: pack.release ?? { version: pack.version }, host, via: "the built release loaded in the host with no sign-in, listed by Code Mode's search({ namespace })", names: names[pack.id] }
    const text = `${JSON.stringify(body, null, 1)}\n`
    const file = join(ROOT, "packs", pack.id, "registered.json")
    if (check) {
      const same = existsSync(file) && JSON.stringify(JSON.parse(readFileSync(file, "utf8")).names) === JSON.stringify(body.names)
      if (!same) { console.error(`${file} differs from what the release registers now`); bad++ }
    } else {
      writeFileSync(file, text)
      console.log(`${pack.id}: ${body.names.length} registered`)
    }
  }
  if (bad) process.exit(1)
}
