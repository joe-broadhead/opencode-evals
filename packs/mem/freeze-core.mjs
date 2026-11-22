// Offline generation only. The audited source is declarative and imports nothing.
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, resolve, relative } from "node:path"
import { sha256 } from "../../src/util/canonical.mjs"

const root = resolve(import.meta.dirname, "../../worlds/mem/baseline-586")
const source = join(root, "scripts/eval/scenarios-core.mjs")
const digest = "614dc70d7636b8a81d05cdef67fc0e0a73b1141ff13dc0c59a012249a67262fd"
if (sha256(readFileSync(source)) !== digest) throw new Error("frozen core source digest differs; stop port comparison")
const { coreScenarios, CORE_SUITE_VERSION } = await import(source)
const encode = (v) => v instanceof RegExp ? { regex: v.source, flags: v.flags } : Array.isArray(v) ? v.map(encode) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k,x]) => [k,encode(x)])) : v
const scenarios = coreScenarios.map(({ seed, runs, ...s }) => ({ ...encode(s), prompts: runs, seed: seed ? seed({ scope: (key = "personal") => Object.fromEntries(["user_id", "agent_id", "team_id"].map((field) => [field, `$scope.${key}.${field}`])) }) : {} }))
writeFileSync(join(root, "core-contracts.json"), JSON.stringify({ schema: "oc-mem-core-contracts/1", version: CORE_SUITE_VERSION, source_sha256: digest, cases: scenarios }, null, 2) + "\n")
const inventoryPath=resolve(root,"../core-inventory.json")
const inventory=JSON.parse(readFileSync(inventoryPath,"utf8"))
if(inventory.source_sha256!==digest||inventory.cases.length!==scenarios.length||inventory.cases.some((c,i)=>c.id!==scenarios[i].id))throw new Error("frozen inventory identities differ")
inventory.port_status="offline-truth-ported-not-runtime-verified"
for(const c of inventory.cases)c.status="offline-truth-ported"
writeFileSync(inventoryPath,JSON.stringify(inventory,null,2)+"\n")
const files = {}
const walk = (at) => { for (const e of readdirSync(at, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
  if (e.isSymbolicLink()) throw new Error("frozen source links are refused")
  const p = join(at,e.name)
  if (e.isDirectory()) walk(p)
  else if (e.name !== "manifest.json") files[relative(root,p)] = sha256(readFileSync(p))
} }
walk(root)
writeFileSync(join(root,"manifest.json"), JSON.stringify({ schema: "oc-mem-frozen-artifact/1", source_commit: "586dc46a133cada64c584b0506eb3aebbd906b24", role: "accepted-baseline-synthetic-contracts-not-release", files },null,2)+"\n")
console.log(`${scenarios.length} literal contracts; ${Object.keys(files).length} manifested artifacts`)
