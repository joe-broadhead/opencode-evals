// The run ledger: every live run is reserved here before it starts, so the run caps hold across invocations, across
// processes, and whatever a run costs. A subscription run bills $0 and the dollar cap cannot see it; the run cap can.
//
//   $EVALS_STORE/ledger/runs.jsonl   append-only, one JSON line per event:
//     { kind: "reserve", batch, at, month, iteration, plugin, runs, model }   before any run of a batch starts
//     { kind: "run", batch, at, month, iteration, plugin, case, trial, exit, duration_ms, billed_usd, cost_source }
//     { kind: "release", batch, at, runs }                                     planned runs that never started
//
// A reservation counts until it is released, so a batch that crashed keeps its runs counted: the safe direction.
// Check-and-reserve happens under an exclusive lock file, so two runners cannot both take the last runs.

import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomBytes } from "node:crypto"

export const DEFAULT_CAPS = { per_plugin_month: 800, total_month: 13000 }

const ENV = {
  per_plugin_month: "EVALS_MAX_RUNS_PER_PLUGIN",
  total_month: "EVALS_MAX_RUNS_TOTAL",
  per_plugin_iteration: "EVALS_MAX_RUNS_PER_PLUGIN_ITERATION",
  total_iteration: "EVALS_MAX_RUNS_PER_ITERATION",
}

export const ledgerFile = (store) => join(store, "ledger", "runs.jsonl")
export const capsFile = (store, env = process.env) => env.EVALS_CAPS ?? join(store, "caps.json")

const positive = (value, name) => {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) throw new Error(`${name} must be a whole number of runs, not ${JSON.stringify(value)}`)
  return number
}

/**
 * The run caps: the defaults, then `caps.json` in the store (or `EVALS_CAPS`), then the environment. An iteration cap
 * that is not set is the month's: one iteration cannot exceed the month it runs in.
 */
export function loadCaps(store, env = process.env) {
  const file = capsFile(store, env)
  const fromFile = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
  const caps = { ...DEFAULT_CAPS }
  for (const key of Object.keys(ENV)) {
    if (fromFile[key] !== undefined) caps[key] = positive(fromFile[key], `${file}: ${key}`)
    if (env[ENV[key]] !== undefined && env[ENV[key]] !== "") caps[key] = positive(env[ENV[key]], ENV[key])
  }
  caps.per_plugin_iteration ??= caps.per_plugin_month
  caps.total_iteration ??= caps.total_month
  return { ...caps, source: existsSync(file) ? file : null }
}

export function readLedger(store) {
  const file = ledgerFile(store)
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

export const monthOf = (date = new Date()) => new Date(date).toISOString().slice(0, 7)

/** Runs counted against each scope: reserved minus released, per month and per iteration. */
export function usage(entries, { month, plugin, iteration }) {
  const released = new Map()
  for (const entry of entries) if (entry.kind === "release") released.set(entry.batch, (released.get(entry.batch) ?? 0) + entry.runs)
  const counted = entries.filter((entry) => entry.kind === "reserve").map((entry) => ({ ...entry, runs: Math.max(0, entry.runs - (released.get(entry.batch) ?? 0)) }))
  const sum = (pred) => counted.filter(pred).reduce((n, entry) => n + entry.runs, 0)
  return {
    total_month: sum((entry) => entry.month === month),
    per_plugin_month: sum((entry) => entry.month === month && entry.plugin === plugin),
    total_iteration: sum((entry) => entry.iteration === iteration),
    per_plugin_iteration: sum((entry) => entry.iteration === iteration && entry.plugin === plugin),
  }
}

export class CapError extends Error {
  constructor(problems) {
    super(`run cap: ${problems.join("; ")}`)
    this.name = "CapError"
    this.problems = problems
  }
}

const SCOPES = {
  per_plugin_month: (p) => `${p.plugin} would reach {next} of {cap} runs in ${p.month}`,
  total_month: (p) => `all plugins would reach {next} of {cap} runs in ${p.month}`,
  per_plugin_iteration: (p) => `${p.plugin} would reach {next} of {cap} runs in iteration ${p.iteration}`,
  total_iteration: (p) => `iteration ${p.iteration} would reach {next} of {cap} runs`,
}

/** Throws CapError when `runs` more would cross any cap. Pure: the entries and caps are passed in. */
export function checkCaps(entries, caps, { month, plugin, iteration, runs }) {
  const used = usage(entries, { month, plugin, iteration })
  const problems = []
  for (const [scope, say] of Object.entries(SCOPES)) {
    const next = used[scope] + runs
    if (next > caps[scope]) problems.push(say({ month, plugin, iteration }).replace("{next}", String(next)).replace("{cap}", String(caps[scope])) + ` (${used[scope]} used)`)
  }
  if (problems.length) throw new CapError(problems)
  return used
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * The ledger's lock. A holder's lock file carries a token only it knows, and every step that touches the file is atomic:
 *
 *   acquire  write a private file with the token, then link(2) it to `lock`: the link fails if a lock exists;
 *   break    a lock older than `staleMs` belonged to a process that died: rename(2) it to a private name, then read
 *            what was moved. If it is not the stale token that was seen (someone broke it and took the lock in
 *            between), link it straight back, so a waiter can never remove a live holder's lock;
 *   release  remove `lock` only if it still holds this holder's token.
 */
const tokenOf = (file) => {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return null
  }
}

export function acquireLock(lock, token) {
  const mine = `${lock}.${token}`
  writeFileSync(mine, token, { mode: 0o600 })
  try {
    linkSync(mine, lock)
    return true
  } catch (error) {
    if (error.code !== "EEXIST") throw error
    return false
  } finally {
    rmSync(mine, { force: true })
  }
}

/** Breaks `lock` only if it still holds `seen`, the stale token; returns whether it did. */
export function breakStaleLock(lock, seen, token) {
  const moved = `${lock}.broken.${token}`
  try {
    renameSync(lock, moved)
  } catch {
    return false
  }
  if (tokenOf(moved) === seen) {
    rmSync(moved, { force: true })
    return true
  }
  // Not the lock that was judged stale: a live holder's. Put it back where it was.
  try {
    linkSync(moved, lock)
  } catch {
    // a third runner took the lock meanwhile; the one moved aside was already superseded
  }
  rmSync(moved, { force: true })
  return false
}

export function releaseLock(lock, token) {
  if (tokenOf(lock) === token) rmSync(lock, { force: true })
}

/** Runs `fn` holding the ledger's lock. */
export function withLock(store, fn, { timeoutMs = 10_000, staleMs = 60_000 } = {}) {
  mkdirSync(join(store, "ledger"), { recursive: true, mode: 0o700 })
  const lock = join(store, "ledger", "lock")
  const token = `${process.pid}-${randomBytes(8).toString("hex")}`
  const deadline = Date.now() + timeoutMs
  while (!acquireLock(lock, token)) {
    try {
      const seen = tokenOf(lock)
      if (seen !== null && Date.now() - statSync(lock).mtimeMs > staleMs) breakStaleLock(lock, seen, token)
    } catch {
      // released meanwhile
    }
    if (Date.now() > deadline) throw new Error(`the run ledger is locked (${lock}); another runner holds it`)
    sleep(50)
  }
  try {
    return fn()
  } finally {
    releaseLock(lock, token)
  }
}

const append = (store, entry) => appendFileSync(ledgerFile(store), `${JSON.stringify(entry)}\n`, { mode: 0o600 })

/**
 * Checks every cap and reserves `runs` runs, in one locked step, before anything is launched. Returns the batch id.
 * `check` (the dollar budget) runs inside the same lock, so two runners cannot both spend the last dollars.
 */
export function reserve(store, { plugin, iteration, runs, model = null, now = new Date(), env = process.env, check = null }) {
  const caps = loadCaps(store, env)
  const month = monthOf(now)
  return withLock(store, () => {
    check?.()
    const used = checkCaps(readLedger(store), caps, { month, plugin, iteration, runs })
    const batch = `${iteration}-${now.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`
    append(store, { kind: "reserve", batch, at: now.toISOString(), month, iteration, plugin, runs, model })
    return { batch, month, caps, used }
  })
}

export const recordRun = (store, entry) => withLock(store, () => append(store, { kind: "run", at: new Date().toISOString(), ...entry }))

export const release = (store, batch, runs) => (runs > 0 ? withLock(store, () => append(store, { kind: "release", batch, at: new Date().toISOString(), runs })) : null)

/** The month's runs from the ledger: how many, what they billed, and how many no price covered. */
export function ledgerMonth(store, month = monthOf()) {
  const entries = readLedger(store)
  const runs = entries.filter((entry) => entry.kind === "run" && entry.month === month)
  return {
    runs: runs.length,
    billed_usd: runs.reduce((sum, entry) => sum + (typeof entry.billed_usd === "number" ? entry.billed_usd : 0), 0),
    priced_runs: runs.filter((entry) => typeof entry.billed_usd === "number" && entry.billed_usd > 0).length,
    unpriced_runs: runs.filter((entry) => !(typeof entry.billed_usd === "number" && entry.billed_usd > 0)).length,
    iterations: [...new Set(entries.filter((entry) => entry.kind === "reserve").map((entry) => entry.iteration))],
    reserved: usage(entries, { month, plugin: null, iteration: null }).total_month,
  }
}
