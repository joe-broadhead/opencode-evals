// Source schema/metadata only: synthetic sidecars here are values, not files named registered.json/plugin-rules.json.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { memoryProfile, checkMemoryInput, memoryReadiness } from "../packs/mem/profile.mjs"
import { memCases } from "../packs/mem/cases.mjs"
const catalog = JSON.parse(readFileSync(new URL("../packs/mem/catalog.json", import.meta.url)))
const pack = JSON.parse(readFileSync(new URL("../packs/mem/pack.json", import.meta.url)))

test("Memory has a closed host-permission profile without inventing access or runtime provenance", () => {
  const p = memoryProfile(pack, catalog)
  assert.equal(p.schema, "oc-mem-profile/1")
  assert.equal(p.permission_model.access_option, null)
  assert.equal(p.permission_model.kind, "host-rules-and-action-assertions")
  assert.equal(p.tools.length, 16)
  assert.equal(p.tools.find((t) => t.name === "wiki").head117, catalog.tools.find((t) => t.name === "wiki").description.slice(0,117))
  assert.throws(() => memoryProfile({ ...pack, id: "demo" }, catalog), /Memory/)
  assert.equal(pack.access, undefined)
  assert.equal(memoryReadiness(pack, { registered: { synthetic: true, names: ["recall"] }, rules: { synthetic: true } }).ready, false)
})

test("all bound discovery inputs use captured closed schemas; wrong action/extra keys/missing conditional args fail", () => {
  for (const s of memCases.filter((s) => s.tool)) assert.deepEqual(checkMemoryInput(catalog, s.tool, s.args), [], s.id)
  assert.ok(checkMemoryInput(catalog, "wiki", { action: "versions" }).length)
  assert.ok(checkMemoryInput(catalog, "page", { action: "write", path: "projects/quartz", invented: true }).length)
  assert.ok(checkMemoryInput(catalog, "wiki", { action: "write", wiki_id: "wiki-eval-personal", filename: "design.md" }).length)
  assert.ok(checkMemoryInput(catalog, "commitments", { action: "update" }).length)
})
