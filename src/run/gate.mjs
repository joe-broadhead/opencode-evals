// What may run, and what a prompt and a project hold when it does (EVALS-232 R5 and the case format):
//
//   fillPrompt   `{{target:<alias>}}` and `{{canary:<name>}}` filled from the private store at run time, never at compile time:
//                a committed case names no id of the owner's, and a placeholder that cannot be filled is never sent to a model
//   gateCases    which selected cases may run on this model: a case that reads a third party's words (`Data: real`) or a
//                candidate's (`Data: candidate`) never goes to an `opencode/*` model, and one whose placeholders the store
//                cannot fill is deferred, each with its reason, never silently dropped
//   seedFiles    `Seed: files=<name>[,<name>]`: a directory of plain files copied into the trial's project before it starts

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { THIRD_PARTY_DATA, dataOf } from "../case/schema.mjs"
import { usesOnlyNoAccount } from "./accounts.mjs"
import { parseSeed, parseSeedList } from "./world.mjs"
import { segment, inside } from "./paths.mjs"
import { storeRoot } from "../store.mjs"

const PLACEHOLDER = /\{\{(target|canary):([A-Za-z0-9_.-]+)\}\}/g

/** The placeholders in a prompt: [{ kind, name, text }]. */
export const placeholdersIn = (prompt) => [...String(prompt ?? "").matchAll(PLACEHOLDER)].map((m) => ({ kind: m[1], name: m[2], text: m[0] }))

/**
 * Fills a prompt. `targets` and `canaries` are Maps name -> [values] (grade/targets.mjs). A list's first value is the one a
 * prompt names. Returns { text, unknown: [placeholder text] }: a prompt with any unknown is not sent.
 */
export function fillPrompt(prompt, { targets = null, canaries = null, standIn = false } = {}) {
  const unknown = []
  const text = String(prompt ?? "").replace(PLACEHOLDER, (whole, kind, name) => {
    const values = (kind === "target" ? targets : canaries)?.get(name)
    if (!values?.length) {
      // A case that runs with no account reads and writes nothing real: its sandbox target is named, not looked up (no target is needed).
      if (standIn) return `<${name.replace(/[._-]+/g, " ")}>`
      unknown.push(whole)
      return whole
    }
    return String(values[0])
  })
  return { text, unknown }
}

/**
 * The owner's data-matrix sign-off: `$EVALS_STORE/data-matrix.json`, `{ "real": ["claude-agent/*"], "candidate": ["claude-agent/sonnet"] }`:
 * for each kind of third-party data, the models (a trailing `*` matches a prefix) that may read it. No file, or no entry, is no
 * model: nothing a third party wrote goes to any model, DeepSeek or Claude, by default.
 */
export function loadDataMatrix(env = process.env) {
  const file = join(storeRoot(env), "data-matrix.json")
  if (!existsSync(file)) return {}
  try {
    const matrix = JSON.parse(readFileSync(file, "utf8"))
    return Object.fromEntries(Object.entries(matrix).filter(([kind, models]) => THIRD_PARTY_DATA.includes(kind) && Array.isArray(models)).map(([kind, models]) => [kind, models.filter((m) => typeof m === "string")]))
  } catch {
    // An unreadable sign-off allows nothing.
    return {}
  }
}

/** Is `model` listed for this kind of data in the matrix? */
export const signedOff = (matrix, kind, model) => (matrix?.[kind] ?? []).some((entry) => (entry.endsWith("*") ? String(model).startsWith(entry.slice(0, -1)) : entry === model))

/** Does a model of this id belong to the provider that must never see a third party's words? */
export const isDeepSeekRoute = (model) => String(model ?? "").startsWith("opencode/")

/**
 * Splits the selected cases into those that may run on `model` and those deferred, each deferred one with why. A case with
 * `Data: real|candidate` is refused for an `opencode/*` model; a case with a placeholder the store cannot fill is deferred.
 */
export function gateCases(cases, { model, targets = null, canaries = null, matrix = {}, noAccount = null } = {}) {
  const runnable = []
  const deferred = []
  const prompts = new Map()
  for (const c of cases) {
    const data = dataOf(c)
    // The harness's own scripted model reads nothing: a probe may hand it a call against third-party data, and no model sees the answer.
    // A case whose every plugin runs with no account reads no one's words, so the sign-off has nothing to hold (and it is no credential's to want).
    const reads = !usesOnlyNoAccount(c, noAccount)
    if (reads && THIRD_PARTY_DATA.includes(data) && !String(model).startsWith("mock/") && !signedOff(matrix, data, model)) {
      deferred.push({ case: c.id, why: `Data: ${data} may not run on ${model}: the owner's data-matrix sign-off ($EVALS_STORE/data-matrix.json) does not list it for ${data} data${isDeepSeekRoute(model) ? " (a third party's words stay off DeepSeek unless it says so)" : ""}` })
      continue
    }
    const filled = fillPrompt(c.prompt, { targets, canaries, standIn: !reads })
    if (filled.unknown.length) {
      deferred.push({ case: c.id, why: `the store cannot fill ${[...new Set(filled.unknown)].join(", ")} (targets.json or canaries.json)` })
      continue
    }
    prompts.set(c.id, filled.text)
    runnable.push(c)
  }
  return { runnable, deferred, prompts }
}

/** Where a seed name lives: the repository's tracked fixtures, else the private store's. Null when neither has it. */
export function seedDir(name, { root = resolve(import.meta.dirname, "..", ".."), env = process.env } = {}) {
  segment("a seed name", name)
  for (const base of [join(root, "fixtures", "seeds"), join(storeRoot(env), "seeds")]) {
    const dir = join(base, name)
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir
  }
  return null
}

const SEED_LIMIT = 8 * 1024 * 1024

/**
 * What a seed may not carry: the host loads configuration and code from the project, so a seed holding `opencode.json`, an instruction
 * file, or anything under `.claude/`, `.agents/` or `.opencode/` (but a job file under `.opencode/jobs/`, which the jobs plugin reads as
 * data) would change what the trial is, not what it is asked (G0 review 1.6).
 */
export function seedRefusal(rel) {
  const parts = rel.split("/")
  const base = parts[parts.length - 1]
  // At any depth: the host loads a project's configuration from the directory it starts in and every one above it, and a seed's `cwd=api`
  // is a documented key, so `api/opencode.json` and `sub/AGENTS.md` load as surely as the top-level ones (G0 re-check, C7).
  if (/^opencode\.json/i.test(base)) return `${rel} is host configuration`
  if (/^(AGENTS|CLAUDE)\.md$/i.test(base)) return `${rel} is an instruction file the host loads`
  for (let i = 0; i < parts.length - 1; i++) {
    const dir = parts[i]
    if (dir === ".claude" || dir === ".agents") return `${rel} is under ${dir}/, which the host loads`
    if (dir === ".opencode" && !(parts[i + 1] === "jobs" && i + 2 < parts.length - 0 && parts.length > i + 2 && /\.(md|json|txt)$/i.test(base))) return `${rel} is under .opencode/, which the host loads (only .opencode/jobs/ data files are allowed)`
  }
  return null
}

/** Every file under a directory, with a refusal for a link or a total over the limit. */
function walk(dir, found = [], total = { bytes: 0 }) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`the seed holds a symbolic link (${path}): seeds are plain files`)
    if (stat.isDirectory()) walk(path, found, total)
    else if (stat.isFile()) {
      total.bytes += stat.size
      if (total.bytes > SEED_LIMIT) throw new Error(`the seed is over ${SEED_LIMIT / 1024 / 1024} MB`)
      found.push(path)
    }
  }
  return found
}

/**
 * Copies the seeds a case names (`Seed: files=a,b`) into the trial's project. Throws for a name no seed directory holds, a link,
 * or a copy that landed outside the project. Returns the relative paths copied.
 */
export function seedFiles(seed, project, options = {}) {
  const names = parseSeedList(parseSeed(seed).files)
  const copied = []
  for (const name of names) {
    const dir = seedDir(name, options)
    if (!dir) throw new Error(`Seed files=${name}: no directory fixtures/seeds/${name} in the repository or seeds/${name} in the store`)
    const files = walk(dir)
    for (const file of files) {
      const refusal = seedRefusal(file.slice(dir.length + 1))
      if (refusal) throw new Error(`the seed ${name} cannot be copied into a project: ${refusal}`)
    }
    mkdirSync(project, { recursive: true })
    cpSync(dir, project, { recursive: true, force: true, verbatimSymlinks: false })
    for (const file of files) {
      const rel = file.slice(dir.length + 1)
      if (!inside(project, join(project, rel))) throw new Error(`the seed ${name} wrote outside the project (${rel})`)
      copied.push(rel)
    }
  }
  return copied
}

/**
 * `--preflight data`: before a batch, which selected cases cannot mean what they say. A clause that names an `@alias` or a
 * `@canary.name` the store lacks would be BLOCKED at grade time, so the case is deferred now, with the name that is missing;
 * a `Seed: files=` with no directory is deferred; a case whose plugin the profile cannot reach is the caller's to add. Returns
 * [{ case, why }]. This is the offline half; reading the live sandbox data through scripted reads needs the credentials and runs
 * in the pilot.
 */
export function dataPreflight(cases, { targets = null, canaries = null, env = process.env, root, noAccount = null } = {}) {
  const deferred = []
  for (const c of cases) {
    const missing = new Set()
    // A case that runs with no account needs no target and no canary: its clauses on them are not applicable, not missing.
    const needsData = !usesOnlyNoAccount(c, noAccount)
    const clauses = (c.items ?? []).flatMap((item) => [...(item.evidence ?? []), ...(item.evidence_any ?? []).flat(), ...(item.na_when ?? [])])
    for (const clause of clauses) {
      for (const alias of clause.aliases ?? []) if (!targets?.get(String(alias).replace(/^@/, "").replace(/\*$/, ""))) missing.add(alias)
      if (clause.kind === "canary" && !canaries?.get(clause.name)) missing.add(`@canary.${clause.name}`)
    }
    if (needsData && missing.size) deferred.push({ case: c.id, why: `its clauses name ${[...missing].join(", ")}, which the store lacks` })
    for (const name of parseSeedList(parseSeed(c.seed).files)) {
      let dir = null
      try {
        dir = seedDir(name, { env, ...(root ? { root } : {}) })
      } catch {
        // a bad name is as missing as an absent directory
      }
      if (!dir) deferred.push({ case: c.id, why: `Seed files=${name} has no directory` })
    }
  }
  return deferred
}
