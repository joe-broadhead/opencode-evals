// The safety halt (EVALS-232 G0 review, 1.1): one write that completes where none may stops the whole wave.
//
// The guard (src/run/guard) writes what it saw to the trial's log. `haltReason` reads it after every trial:
//   - outside commit mode a write must never complete: a `committed` record (the tool's body ran to the end), an access assertion
//     (a write resolved to `allow` at the permission decision; the guard turned it into a deny, but a layer above it failed) or a
//     rejection the guard could not make is a halt;
//   - in commit mode a write completes only after the guard passed it at `execute.before` for a target inside `targets.json`'s
//     aliases; a `committed` record with no such pass in front of it is a halt.
// The runner then launches nothing more, writes `HALT` in the private store (so every other batch of the wave refuses to launch
// too, until the owner has read it and cleared it with `evals halt --clear`), and says what was written, where.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const haltFile = (store) => join(store, "HALT")

/** What a trial's guard records mean for the wave: null, or { reason, writes: [{ tool, call, target?, why }] }. */
export function haltReason(records = []) {
  const start = records.find((r) => r.kind === "guard_start")
  const mode = start?.mode ?? "refuse"
  const passed = new Map()
  for (const r of records) if (r.kind === "execute_before" && r.write && r.pass === true) passed.set(r.call ?? r.tool, r)
  const writes = []
  for (const r of records) {
    if (r.kind === "committed") {
      const where = r.target !== undefined && r.target !== null ? ` at ${JSON.stringify(r.target)}` : ""
      if (mode !== "commit") writes.push({ tool: r.tool, call: r.call, ...(r.target !== undefined ? { target: r.target } : {}), why: `${r.tool} completed${where} outside commit mode (guard mode ${r.mode ?? mode})` })
      else if (!passed.has(r.call ?? r.tool)) writes.push({ tool: r.tool, call: r.call, ...(r.target !== undefined ? { target: r.target } : {}), why: `${r.tool} completed${where} without the guard having passed it for an in-scope target` })
    }
    if (r.kind === "assert" && mode !== "commit" && (r.what === "access" || r.what === "committed")) writes.push({ tool: r.tool ?? r.action, call: r.call, why: `${r.tool ?? r.action} resolved to a write that was not asked (${r.what} assertion)` })
    if (r.kind === "reject_failed") writes.push({ tool: r.action, why: `the guard could not reject the ask for ${r.action}: ${r.error ?? "unknown"}` })
  }
  if (!writes.length) return null
  return { reason: writes.map((w) => w.why).join("; "), writes }
}

export function readHalt(store) {
  try {
    return existsSync(haltFile(store)) ? JSON.parse(readFileSync(haltFile(store), "utf8")) : null
  } catch {
    // An unreadable marker still halts: the safe direction.
    return { reason: "HALT exists in the store and cannot be read" }
  }
}

export function writeHalt(store, info) {
  mkdirSync(store, { recursive: true, mode: 0o700 })
  const file = haltFile(store)
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify({ at: new Date().toISOString(), ...info }, null, 1)}\n`, { mode: 0o600 })
  renameSync(tmp, file)
  return file
}

export const clearHalt = (store) => rmSync(haltFile(store), { force: true })

/** The sentence a refused launch carries. */
export const haltMessage = (halt) => `the wave is halted: ${halt.reason}${halt.batch ? ` (batch ${halt.batch}, ${halt.trial ?? "?"})` : ""}; read ${"$EVALS_STORE/HALT"}, then clear it with \`evals halt --clear\``
