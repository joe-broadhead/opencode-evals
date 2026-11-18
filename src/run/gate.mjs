// What may run, and what a prompt and a project hold when it does (EVALS-232 R5 and the case format):
//
//   fillPrompt   `{{target:<alias>}}` and `{{canary:<name>}}` filled from the private store at run time, never at compile time:
//                a committed case names no id of the owner's, and a placeholder that cannot be filled is never sent to a model
//   gateCases    which selected cases may run on this model: a case that reads a third party's words (`Data: real`) or a
//                candidate's (`Data: candidate`) never goes to an `opencode/*` model, and one whose placeholders the store
//                cannot fill is deferred, each with its reason, never silently dropped
//   seedFiles    `Seed: files=<name>[,<name>]`: a directory of plain files copied into the trial's project before it starts

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { THIRD_PARTY_DATA } from "../case/schema.mjs"
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
export function fillPrompt(prompt, { targets = null, canaries = null } = {}) {
  const unknown = []
  const text = String(prompt ?? "").replace(PLACEHOLDER, (whole, kind, name) => {
    const values = (kind === "target" ? targets : canaries)?.get(name)
    if (!values?.length) {
      unknown.push(whole)
      return whole
    }
    return String(values[0])
  })
  return { text, unknown }
}

/** Does a model of this id belong to the provider that must never see a third party's words? */
export const isDeepSeekRoute = (model) => String(model ?? "").startsWith("opencode/")

/**
 * Splits the selected cases into those that may run on `model` and those deferred, each deferred one with why. A case with
 * `Data: real|candidate` is refused for an `opencode/*` model; a case with a placeholder the store cannot fill is deferred.
 */
export function gateCases(cases, { model, targets = null, canaries = null } = {}) {
  const runnable = []
  const deferred = []
  const prompts = new Map()
  for (const c of cases) {
    if (THIRD_PARTY_DATA.includes(c.data) && isDeepSeekRoute(model)) {
      deferred.push({ case: c.id, why: `Data: ${c.data} never runs on ${model} (a third party's words stay off DeepSeek)` })
      continue
    }
    const filled = fillPrompt(c.prompt, { targets, canaries })
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
export function dataPreflight(cases, { targets = null, canaries = null, env = process.env, root } = {}) {
  const deferred = []
  for (const c of cases) {
    const missing = new Set()
    const clauses = (c.items ?? []).flatMap((item) => [...(item.evidence ?? []), ...(item.evidence_any ?? []).flat(), ...(item.na_when ?? [])])
    for (const clause of clauses) {
      for (const alias of clause.aliases ?? []) if (!targets?.get(String(alias).replace(/^@/, ""))) missing.add(alias)
      if (clause.kind === "canary" && !canaries?.get(clause.name)) missing.add(`@canary.${clause.name}`)
    }
    if (missing.size) deferred.push({ case: c.id, why: `its clauses name ${[...missing].join(", ")}, which the store lacks` })
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
