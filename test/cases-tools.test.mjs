// Every tool a case names must be a tool some released pack declares (or an OpenCode built-in).
//
// A clause on a name no pack has can never fire: `absent:article_publish` passes whatever the model does, and a
// `call:` on it always fails. That is not a case, it is a comment. The x cases carried four such names
// (article_publish, create_direct_message, create_like, create_repost) from a review set written before the release.
//
// This belongs in the harness, as part of `evals compile`: a case set is compiled before it runs, the packs are
// already loaded there, and every lane would get the check without adding it. It lives here until the harness takes
// it, because the case writers' branches must not change `src/case/compile.mjs` under the harness lane.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { BUILTIN_TOOLS, matchesTool } from "../src/grade/select.mjs"
import { sameToolName } from "../src/grade/evidence.mjs"

const ROOT = join(import.meta.dirname, "..")
const BUILTIN = new Set(BUILTIN_TOOLS)

/** pack id -> the tool names it declares. */
function packs() {
  const out = new Map()
  for (const id of readdirSync(join(ROOT, "packs"))) {
    const file = join(ROOT, "packs", id, "pack.json")
    if (!existsSync(file)) continue
    const pack = JSON.parse(readFileSync(file, "utf8"))
    out.set(id, new Set((pack.tools ?? []).map((tool) => tool.name)))
  }
  return out
}

/** Every clause in every compiled case, with where it came from. */
function clauses() {
  const out = []
  const dir = join(ROOT, "cases")
  for (const plugin of readdirSync(dir)) {
    const at = join(dir, plugin)
    let files = []
    try {
      files = readdirSync(at).filter((name) => name.endsWith(".json"))
    } catch {
      continue
    }
    for (const file of files) {
      const one = JSON.parse(readFileSync(join(at, file), "utf8"))
      for (const item of one.items ?? []) {
        for (const clause of [...(item.evidence ?? []), ...(item.evidence_any ?? []).flat(), ...(item.na_when ?? [])]) {
          if (clause?.tool) out.push({ plugin, file, item: item.id, clause })
        }
      }
    }
  }
  return out
}

/** Does any released pack declare this tool, the way a run would match it? */
function declared(packsById, tool) {
  if (BUILTIN.has(tool)) return true
  if (tool.includes("*")) {
    // `x.*` and `x_*` are every tool of pack x; another glob is matched against every declared name.
    if (tool.endsWith(".*") || tool.endsWith("_*")) {
      const ns = tool.slice(0, -2)
      if (packsById.has(ns)) return true
      if (tool.endsWith(".*")) return false
    }
    const re = new RegExp(`^${tool.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
    return [...packsById.values()].some((names) => [...names].some((name) => re.test(name)))
  }
  const dot = tool.indexOf(".")
  if (dot > 0) {
    const [ns, name] = [tool.slice(0, dot), tool.slice(dot + 1)]
    if (!packsById.has(ns)) return false
    return name === "*" || packsById.get(ns).has(name)
  }
  // A direct tool id names its namespace's tool too: `history_pin` is History's `pin`, `gws_write` is gws's `write`.
  const under = tool.indexOf("_")
  if (under > 0) {
    const [ns, name] = [tool.slice(0, under), tool.slice(under + 1)]
    if (packsById.has(ns) && packsById.get(ns).has(name)) return true
  }
  return [...packsById.values()].some((names) => names.has(tool))
}

test("every tool a case names exists in a released pack", () => {
  const packsById = packs()
  const missing = []
  for (const { plugin, file, item, clause } of clauses()) {
    // `declined:` compares the permission action with sameToolName, so its name is normalised, not matched literally.
    if (clause.kind === "declined" || clause.kind === "absent-declined") {
      const known = declared(packsById, clause.tool) || [...packsById.values()].some((names) => [...names].some((name) => sameToolName(`x_${name}`, clause.tool)))
      if (!known) missing.push(`${plugin}/${file} ${item}: declined:${clause.tool} names no released tool`)
      continue
    }
    if (!declared(packsById, clause.tool)) missing.push(`${plugin}/${file} ${item}: ${clause.kind}:${clause.tool} names no released tool`)
  }
  assert.deepEqual(missing, [], `a clause on a tool no pack declares can never fire:\n  ${missing.join("\n  ")}`)
})

test("every case's plugin has a pack, and a case that names a namespace names a real one", () => {
  const packsById = packs()
  const bad = []
  for (const { plugin, file, item, clause } of clauses()) {
    if (!packsById.has(plugin)) bad.push(`${plugin}/${file}: no packs/${plugin}/pack.json`)
    const ns = clause.tool.includes(".") ? clause.tool.split(".")[0] : null
    if (ns && ns !== "*" && !packsById.has(ns)) bad.push(`${plugin}/${file} ${item}: namespace ${ns} is no pack`)
  }
  assert.deepEqual(bad, [], bad.join("\n  "))
})

test("a known tool matches, and an unknown one does not (the check itself)", () => {
  const packsById = new Map([["demo", new Set(["get_one", "create_one"])]])
  assert.equal(declared(packsById, "get_one"), true)
  assert.equal(declared(packsById, "demo.create_one"), true)
  assert.equal(declared(packsById, "demo.*"), true)
  assert.equal(declared(packsById, "get_*"), true)
  assert.equal(declared(packsById, "write"), true)
  assert.equal(declared(new Map([["history", new Set(["pin"])]]), "history_pin"), true)
  assert.equal(declared(packsById, "article_publish"), false)
  assert.equal(declared(packsById, "other.get_one"), false)
  assert.equal(declared(packsById, "nope_*"), false)
  assert.equal(matchesTool("demo.get_one", { tool: "get_one", ns: "demo", via: "execute" }), true)
})
