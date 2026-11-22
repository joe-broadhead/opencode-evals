import {test} from "node:test"
import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {createHash} from "node:crypto"
import {discoveryCases,RECORD_ID,discoverySuiteHash} from "../packs/mem/discovery-plan.mjs"
import {sourceDiscoveryCatalog,discoveryCondition} from "../packs/mem/discovery-schema.mjs"
test("source-only complete closed schemas parameterize direct/search after a 117-character preview, never runtime catalog proof",()=>{
  for(const s of discoveryCases)for(const mode of ["direct","search"]){const c=discoveryCondition(s,{mode,catalog:sourceDiscoveryCatalog});assert.equal(c.tool,s.binding.tool);assert.equal(c.head117.length,Math.min(117,c.description.length));assert.equal(c.full_schema.additionalProperties,false);assert.equal(c.runtime_observed,false);assert.equal(c.source_status,"PROVISIONAL");assert.equal(c.condition_parameter_only,true)}
  for(const [name,args]of [["code",{action:"callers",graph_id:"code-quartz"}],["spaces",{action:"skills",skill:{op:"versions",id:"skill-quartz",extra:true}}],["read",{id:"rec_eval_1"}]])assert.throws(()=>discoveryCondition({binding:{tool:name,args}},{mode:"search",catalog:sourceDiscoveryCatalog}),/schema|input/)
})
test("canonical exact-read identity comes from scoped actual list/search output, not a baked invalid ID or an answer hint",()=>{
  for(const s of discoveryCases.filter(s=>s.family==="exact-read")){assert.match(RECORD_ID,/^rec_[0-9A-HJKMNP-TV-Z]{26}$/);assert.equal(s.binding.args.id,s.seed.personal.records[0].id);assert.ok(!s.prompt.includes("rec_eval_1"));assert.ok(!s.prompt.includes(RECORD_ID));assert.ok(!s.prompt.includes("QREC-71"));assert.ok(!s.prompt.includes("mem_read"))}
})
test("versioned discovery lock freezes only an explicitly unrun offline compile, preserves old hashes and exactly two human prompt repairs",()=>{
  const lock=JSON.parse(readFileSync(new URL("../packs/mem/discovery-offline-lock.json",import.meta.url)))
  assert.equal(lock.schema,"oc-mem-discovery-offline-lock/1");assert.equal(lock.status,"unrun");assert.equal(lock.final_comparison,false);assert.equal(lock.runtime_verified,false)
  assert.equal(lock.suite_sha256,discoverySuiteHash);assert.equal(lock.cases.length,24);assert.equal(lock.previous.files.length,24)
  assert.deepEqual(lock.prompt_repairs.map(r=>r.id).sort(),["deep-mem-exact-read","deep-mem-exact-read-p"])
  for(const c of lock.cases){for(const [kind,suffix]of [["source","md"],["compiled","json"]])assert.equal(createHash("sha256").update(readFileSync(new URL(`../cases/mem/${c.id}.${suffix}`,import.meta.url))).digest("hex"),c[`${kind}_sha256`])}
})
