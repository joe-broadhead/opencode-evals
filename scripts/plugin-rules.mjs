#!/usr/bin/env node
// Builds `packs/<id>/plugin-rules.json`: what each plugin's OWN rules do at the trial's access (ask-changes), for every action of its pack. The harness is never more permissive than the plugin
// (src/run/lockdown.mjs): it allows only the reads a plugin's own rules allow, so a read a plugin asks consent for on purpose (Slack's private search and file read, X's direct-message reads)
// stays an ask in a trial and is declined. The record is taken from the host, not from a reading of the plugin's source: one scripted trial loads all 24 builds the way a round does, with NONE of
// the harness's rules (`noHarnessRules`), and the probe plugin asks the host about each action.
//
//   EVALS_COMPANIONS=<file> node scripts/plugin-rules.mjs       writes packs/<id>/plugin-rules.json (needs Docker, the sandbox image, OpenCode 2.3.x and bun)
//   EVALS_COMPANIONS=<file> node scripts/plugin-rules.mjs --check   fails when a file differs from what the host resolves now

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { scriptedRun, executeValue, execute } from "../src/p0/run.mjs"
import { askAll, fullArm } from "../src/p0/probes.mjs"
import { loadPacks } from "../src/run/lockdown.mjs"

const ROOT = resolve(import.meta.dirname, "..")
const CHUNK = 80

/** What the host resolves for every action of every pack, with the plugins at ask-changes and no harness rules: `{ id: { allowed, asked, denied, other } }`. */
export async function resolveOwnRules({ companions = process.env.EVALS_COMPANIONS, tmp = process.env.EVALS_TMP ?? process.env.TMPDIR, rules = {} } = {}) {
  const packs = loadPacks()
  const cases = []
  for (const pack of packs) {
    const actions = [...new Set((pack.tools ?? []).map((t) => t.permission).filter(Boolean))]
    for (let i = 0; i < actions.length; i += CHUNK) cases.push({ id: `tools-rules-${pack.id}-${i / CHUNK}`, pack: pack.id, actions: actions.slice(i, i + CHUNK) })
  }
  const run = await scriptedRun({ plugin: "slack", cases: cases.map((c) => ({ id: c.id, prompt: execute(askAll(c.actions)) })), arm: fullArm(companions, { arm: "slack", options: {} }), options: { probe: true, noHarnessRules: true, guardMode: "log", iteration: "plugin-rules", auth: "none", ...rules }, tmp })
  try {
    const out = Object.fromEntries(packs.map((p) => [p.id, { allowed: [], asked: [], denied: [], other: [] }]))
    for (const c of cases) {
      const value = executeValue(run.trials[c.id].calls[0])
      const outcomes = (value?.output ?? value)?.outcomes
      if (!outcomes) throw new Error(`${c.pack}: the host did not answer (${String(run.trials[c.id].calls[0]?.output ?? run.trials[c.id].calls[0]?.error ?? "no call").slice(0, 120)})`)
      for (const [action, outcome] of Object.entries(outcomes)) (out[c.pack][outcome === "allowed" ? "allowed" : outcome === "asked" ? "asked" : outcome === "denied" ? "denied" : "other"]).push(action)
    }
    for (const entry of Object.values(out)) for (const key of Object.keys(entry)) entry[key].sort()
    return { host: run.trials[cases[0].id].summary?.opencode ?? "opencode", out }
  } finally {
    run.cleanup()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check")
  const { host, out } = await resolveOwnRules()
  let bad = 0
  for (const pack of loadPacks()) {
    const entry = out[pack.id]
    if (entry.other.length) { console.error(`${pack.id}: the host gave no decision for ${entry.other.slice(0, 5).join(", ")}`); bad++ }
    const body = { schema: "oc-plugin-rules/1", plugin: pack.id, release: pack.release ?? { version: pack.version }, access: "ask-changes", host, via: "the built release loaded in the host at access ask-changes with none of the harness's rules; the probe plugin asks the host about every action of the pack", allowed: entry.allowed, asked: entry.asked, denied: entry.denied }
    const file = join(ROOT, "packs", pack.id, "plugin-rules.json")
    if (check) {
      const have = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null
      if (!have || JSON.stringify([have.allowed, have.asked, have.denied]) !== JSON.stringify([body.allowed, body.asked, body.denied])) { console.error(`${file} differs from what ${pack.id}'s own rules resolve now`); bad++ }
    } else {
      writeFileSync(file, `${JSON.stringify(body, null, 1)}\n`)
      console.log(`${pack.id}: ${entry.allowed.length} allowed, ${entry.asked.length} asked, ${entry.denied.length} denied`)
    }
  }
  if (bad) process.exit(1)
}
