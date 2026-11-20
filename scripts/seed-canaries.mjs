#!/usr/bin/env node
// seed-canaries: plants the round's canaries (invented facts a case's prompt names with `{{canary:<name>}}` and its items grade with `@canary.<name>`) in the owner's
// SANDBOX containers, through the evals profile's own signed-in service, and records them in `$EVALS_STORE/canaries.json`.
//
//   seed-canaries.mjs [--manifest FILE] [--only name,name] [--dry-run]       (EVALS_PROFILE names the evals profile; EVALS_STORE the store)
//
// The manifest (docs/running.md#canaries, default `canaries/manifest.json`) lists each canary with its plugin, its container and its invented content:
//
//   { "schema": "oc-canaries/1", "canaries": [ {
//       "name": "linear_issue",                        the canary's name: {{canary:linear_issue}} and @canary.linear_issue
//       "plugin": "linear",                            a plugin with a pack, signed in to the evals profile
//       "container": "linear.team",                    a `targets.json` alias: the sandbox it lives in. Anything else is refused
//       "content": "Quillfeather sync stalls {{token}}",   invented; {{token}} is six random characters, made once and kept
//       "value": "content",                            what the canary's value is: "content" (default) or "id" (a vendor-assigned id, a Slack ts)
//       "find":   { "method": "list_issues", "input": { "team": "{{container}}", "query": "{{content}}" }, "items": "issues", "where": "title", "id": "id" },
//       "create": { "method": "save_issue",  "input": { "team": "{{container}}", "title": "{{content}}" }, "id": "id" }
//   } ] }
//
// `method` is the plugin's tools-RPC method (the pack's `rpc`, or `rpc` on the entry); `input` is that tool's input, with {{container}} (the alias's value),
// {{content}} and {{token}}. `find` and `create` must both name {{container}}: a canary that does not say where it goes is refused. `items` is the dotted path
// of the result's list (the result itself when absent), `where` the item's field that holds the content (`match`: "equals", the default, or "includes"), `id` the
// dotted path of the id in the found item or the created result.
//
// Idempotent: a canary already in canaries.json keeps its content (the token is made once); it is FOUND first and created only when it is not there, so a rerun
// reuses and never duplicates. Each created or found id is recorded under `_ids` (a key that starts `_` is not a canary to the grader). The calls run as ONE
// session of the evals profile whose rules deny every tool of the plugins it touches except the find and create methods it names.
//
// It never runs against the normal profile: EVALS_PROFILE is required and must not be the real home; its service port must not be the real service's; every call
// carries the profile's own environment; a plugin the evals profile is not signed in to is refused before anything is created.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { randomBytes } from "node:crypto"
import { profileEnv, realEnv, run, activeCredential, exportTarget } from "./profile/profile-lib.mjs"
import { assertDistinctPort } from "../src/run/service-port.mjs"
import { flatten, isWeakCanary } from "../src/grade/targets.mjs"
import { storeRoot } from "../src/store.mjs"
import { loadPacks } from "../src/run/lockdown.mjs"

export const MANIFEST_SCHEMA = "oc-canaries/1"
const NAME = /^[a-z][a-z0-9_]*$/
const VARS = new Set(["container", "content", "token", "id"])

/** The dotted path `a.b.0.c` of a value, or undefined. */
export function pick(value, path) {
  let at = value
  for (const part of String(path ?? "").split(".").filter(Boolean)) {
    if (at === null || at === undefined) return undefined
    at = at[part]
  }
  return at
}

const strings = (value, out = []) => {
  if (typeof value === "string") out.push(value)
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out))
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out))
  return out
}

/** `value` with every {{var}} replaced from `vars`, deeply. */
export function fill(value, vars) {
  if (typeof value === "string") return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? `{{${name}}}`))
  if (Array.isArray(value)) return value.map((v) => fill(v, vars))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)]))
  return value
}

/**
 * The problems of a manifest against the targets and the packs: an array of strings, empty when it is sound. Nothing is created before this is empty.
 * `targets` is the flattened targets.json (Map alias -> [values]).
 */
export function manifestProblems(manifest, { targets, packs = loadPacks() } = {}) {
  const problems = []
  if (manifest?.schema !== MANIFEST_SCHEMA) return [`the manifest's schema is ${JSON.stringify(manifest?.schema)}, not ${MANIFEST_SCHEMA}`]
  if (!Array.isArray(manifest.canaries) || !manifest.canaries.length) return ["the manifest lists no canary"]
  const seen = new Set()
  for (const [i, c] of manifest.canaries.entries()) {
    const at = `canary ${c?.name ?? `#${i + 1}`}`
    if (!NAME.test(c?.name ?? "")) problems.push(`${at}: a name is lower-case letters, digits and underscores`)
    else if (seen.has(c.name)) problems.push(`${at}: listed twice`)
    seen.add(c?.name)
    const pack = packs.find((p) => p.id === c?.plugin)
    if (!pack) problems.push(`${at}: no pack for plugin ${JSON.stringify(c?.plugin)}`)
    else if (pack.accounts === "fake" || pack.accounts === "none") problems.push(`${at}: ${c.plugin} runs with no account (${pack.accounts}): there is nothing to seed`)
    // The container is a sandbox alias of targets.json and nothing else: not an id, not a name, not a made-up alias.
    if (typeof c?.container !== "string" || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(c.container)) problems.push(`${at}: container must be a targets.json alias such as linear.team, not ${JSON.stringify(c?.container)}`)
    else if (!targets?.get(c.container)?.length) problems.push(`${at}: container ${c.container} is not an alias in targets.json: a canary is created in a sandbox container only`)
    else if (targets.get(c.container).length !== 1) problems.push(`${at}: container ${c.container} names ${targets.get(c.container).length} values: a canary goes in one container`)
    if (typeof c?.content !== "string" || c.content.length < 8) problems.push(`${at}: content is the invented text (at least 8 characters)`)
    if (c?.value !== undefined && !["content", "id"].includes(c.value)) problems.push(`${at}: value is "content" or "id"`)
    for (const step of ["find", "create"]) {
      const s = c?.[step]
      if (!s || typeof s.method !== "string" || !s.method) {
        problems.push(`${at}: ${step} needs a method (the plugin's tools-RPC method)`)
        continue
      }
      const text = strings(s.input).join("\n")
      if (!text.includes("{{container}}")) problems.push(`${at}: ${step}.input does not name {{container}}: a canary must say which sandbox it goes in`)
      for (const m of text.matchAll(/\{\{(\w+)\}\}/g)) if (!VARS.has(m[1]) || (step === "find" && m[1] === "id")) problems.push(`${at}: ${step}.input uses {{${m[1]}}}, which is not available there`)
      if (step === "create" && c.value === "id" && !s.id) problems.push(`${at}: value "id" needs create.id (where the id is in the result)`)
      if (c.value === "id" && String(c.content).includes("{{token}}")) problems.push(`${at}: with value "id" the content is the fixed text the canary is found by: it has no {{token}}`)
    }
    if (c?.find && c.find.match !== undefined && !["equals", "includes"].includes(c.find.match)) problems.push(`${at}: find.match is "equals" or "includes"`)
    if (c?.find && !c.find.where) problems.push(`${at}: find.where is the item's field that holds the content`)
    if (typeof c?.content === "string" && c.value !== "id" && !c.content.includes("{{token}}") && isWeakCanary(c.content)) problems.push(`${at}: content is too short or too repetitive to be a canary`)
  }
  return problems
}

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback)
function writeJson(file, data) {
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, file)
}

/** The result of an `opencode api post`, as the value the tool returned. Throws on an error answer. */
export function unwrap(stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(`the service did not answer JSON: ${String(stdout).slice(0, 120)}`)
  }
  if (parsed?.error) throw new Error(`the service refused: ${typeof parsed.error === "string" ? parsed.error : (parsed.error.message ?? JSON.stringify(parsed.error)).slice(0, 200)}`)
  let value = parsed?.output ?? parsed?.data ?? parsed?.result ?? parsed
  // An MCP result: content parts, the text of which is the tool's JSON.
  if (value && typeof value === "object" && Array.isArray(value.content) && value.content[0]?.type === "text") value = value.content[0].text
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      // plain text: the caller looks in it as text
    }
  }
  return value
}

/**
 * Seeds the canaries of `manifest`. Returns `{ ok, plan, created, reused, ids }`, or throws with the reason nothing (more) was done.
 * `exec(command, args, { env })` is the command runner (the real one by default; a fake service in the tests).
 */
export function seedCanaries({ manifest, store, profile, opencode = "opencode", env = process.env, exec = run, dryRun = false, only = null, agent = "build", log = () => {}, token = () => randomBytes(4).toString("hex").slice(0, 6) }) {
  const targetsFile = join(store, "targets.json")
  const targets = existsSync(targetsFile) ? flatten(JSON.parse(readFileSync(targetsFile, "utf8"))) : null
  if (!targets) throw new Error(`${targetsFile} does not exist: the sandbox aliases are the owner's, and a canary goes in one of them`)
  const problems = manifestProblems(manifest, { targets })
  if (problems.length) throw new Error(`the canaries manifest is refused, nothing was created:\n  ${problems.join("\n  ")}`)
  const wanted = only ? new Set(only) : null
  const chosen = manifest.canaries.filter((c) => !wanted || wanted.has(c.name))
  if (wanted) for (const name of wanted) if (!chosen.some((c) => c.name === name)) throw new Error(`no canary ${name} in the manifest`)

  const file = join(store, "canaries.json")
  const book = readJson(file, {})
  book._ids = book._ids ?? {}
  const plan = chosen.map((c) => {
    const container = targets.get(c.container)[0]
    const existing = book[c.name]
    const known = typeof existing === "string" && existing !== ""
    // A value that is the content is kept once made (the token is made once); a value that is an id is the service's, and the content is the fixed text it is found by.
    const content = c.value === "id" ? c.content : known ? existing : fill(c.content, { token: token() })
    return { canary: c, name: c.name, plugin: c.plugin, container, alias: c.container, content, known, id: book._ids[c.name] ?? null }
  })
  // The dry run shows the template where the token is not made yet: a real run makes its own.
  if (dryRun) return { ok: true, dry: true, plan: plan.map(({ canary, ...rest }) => ({ ...rest, content: rest.known || canary.value === "id" ? rest.content : canary.content, value: canary.value ?? "content", find: canary.find.method, create: canary.create.method })), created: [], reused: [], ids: {} }

  // The evals profile, and only it.
  if (!profile) throw new Error("EVALS_PROFILE is not set: canaries are planted through the evals profile's own service, never the normal one")
  const real = realEnv(env)
  if (resolve(profile) === resolve(real.HOME)) throw new Error(`the profile ${profile} is the real home: canaries are planted through the evals profile only`)
  if (!existsSync(profile)) throw new Error(`the evals profile ${profile} does not exist: run evals-profile.sh once`)
  const mine = profileEnv(profile, env)
  assertDistinctPort({ opencode, profileEnv: mine, realEnv: real, exec, env })
  const plugins = [...new Set(plan.map((p) => p.plugin))]
  for (const plugin of plugins) {
    const target = exportTarget(plugin)
    const held = exec(opencode, ["auth", "export", target], { env: mine })
    if (!(held.code === 0 && activeCredential(held.stdout, target))) throw new Error(`the evals profile holds no credential for ${plugin}: sign it in (signin.sh) before its canaries are planted`)
  }

  // One session, whose rules let it call the find and create methods named and nothing else of these plugins.
  const packs = loadPacks()
  const action = (c, method) => {
    const pack = packs.find((p) => p.id === c.plugin)
    const tool = (pack?.tools ?? []).find((t) => t.name === method || t.name === method.replace(new RegExp(`^${c.plugin}_`), ""))
    return tool?.permission ?? `${c.plugin}_${method}`
  }
  const rules = [
    ...plugins.map((p) => ({ action: `${p}_*`, resource: "*", effect: "deny" })),
    ...[...new Set(chosen.flatMap((c) => [c.find.method, c.create.method].map((m) => action(c, m))))].map((a) => ({ action: a, resource: "*", effect: "allow" })),
  ]
  const dir = join(profile, "canary-seeding")
  mkdirSync(dir, { recursive: true })
  const post = (path, body) => {
    const out = exec(opencode, ["api", "post", path, "--header", `x-opencode-directory:${dir}`, "--data", JSON.stringify(body)], { env: mine })
    if (out.code !== 0) throw new Error(`${path} failed (exit ${out.code}): ${String(out.stderr || out.stdout).slice(0, 160)}`)
    return unwrap(out.stdout)
  }
  const session = post("/api/session", { title: "canary seeding", agent, location: { directory: dir }, permissions: rules })
  const sessionID = session?.id ?? session?.data?.id
  if (!sessionID) throw new Error("the service made no session for the seeding")
  const call = (c, step, vars) => {
    const pack = packs.find((p) => p.id === c.plugin)
    const route = c[step].rpc ?? c.rpc ?? pack?.rpc
    if (!route) throw new Error(`${c.name}: no tools-RPC route for ${c.plugin}`)
    return post(`/api/rpc/${route}/${c[step].method}`, { input: { sessionID, input: fill(c[step].input, vars) } })
  }

  const created = []
  const reused = []
  for (const p of plan) {
    const c = p.canary
    const vars = { container: p.container, content: p.content }
    // Found first: a rerun reuses.
    const result = call(c, "find", vars)
    const list = c.find.items ? pick(result, c.find.items) : result
    const items = Array.isArray(list) ? list : []
    const hit = items.find((item) => (c.find.match === "includes" ? String(pick(item, c.find.where) ?? "").includes(p.content) : String(pick(item, c.find.where)) === p.content))
    let id
    if (hit) {
      id = pick(hit, c.find.id ?? c.create.id ?? "id")
      reused.push(p.name)
      log(`reused  ${p.name} in ${p.alias}`)
    } else {
      const made = call(c, "create", vars)
      id = pick(made, c.create.id ?? "id")
      created.push(p.name)
      log(`created ${p.name} in ${p.alias}`)
    }
    const value = c.value === "id" ? String(id ?? "") : p.content
    if (!value || isWeakCanary(value)) throw new Error(`${p.name}: its value ${c.value === "id" ? "(the id the service returned)" : "(the content)"} is empty or too weak to be a canary`)
    book[p.name] = value
    book._ids[p.name] = id ?? null
    writeJson(file, book)
  }
  return { ok: true, plan: plan.map(({ canary, ...rest }) => rest), created, reused, ids: book._ids }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const opt = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") opt.dry = true
    else if (["--manifest", "--only", "--opencode", "--profile", "--agent"].includes(argv[i])) opt[argv[i].slice(2)] = argv[++i]
    else {
      console.error(`unknown argument ${argv[i]}`)
      process.exit(2)
    }
  }
  try {
    const manifestFile = opt.manifest ?? process.env.EVALS_CANARIES_MANIFEST ?? join(import.meta.dirname, "..", "canaries", "manifest.json")
    if (!existsSync(manifestFile)) throw new Error(`no canaries manifest at ${manifestFile}: write one (docs/running.md#canaries) or pass --manifest`)
    const out = seedCanaries({ manifest: JSON.parse(readFileSync(manifestFile, "utf8")), store: storeRoot(), profile: opt.profile ?? process.env.EVALS_PROFILE, opencode: opt.opencode ?? process.env.OPENCODE_BIN ?? "opencode", dryRun: Boolean(opt.dry), only: opt.only ? opt.only.split(",") : null, agent: opt.agent ?? "build", log: (line) => console.log(line) })
    if (out.dry) {
      console.log(`canary seeding plan (dry run: nothing is created, nothing is written): ${out.plan.length} canar${out.plan.length === 1 ? "y" : "ies"}`)
      for (const p of out.plan) console.log(`  ${p.name.padEnd(26)} ${p.plugin} in ${p.alias} (${p.container}): find ${p.find}, create ${p.create}; ${p.known ? "content kept from canaries.json" : "new content"}: ${p.content}`)
    } else console.log(`${out.created.length} created, ${out.reused.length} reused; ids in ${join(storeRoot(), "canaries.json")} (_ids)`)
  } catch (error) {
    console.error(`seed-canaries: ${error.message}`)
    process.exit(1)
  }
}
