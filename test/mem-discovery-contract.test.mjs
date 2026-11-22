// Parameterized source schemas only, never actual registered/search evidence.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { discoveryContracts, bindDiscoveryContracts } from "../packs/mem/discovery.mjs"
test("all 24 discovery prompts have explicit finite backend contracts, including real stored-skill history",()=>{
  assert.equal(discoveryContracts.length,24)
  assert.equal(discoveryContracts.filter((c)=>c.backend).length,24)
  assert.deepEqual(discoveryContracts.filter((c)=>!c.backend).map((c)=>c.id),[])
  assert.equal(discoveryContracts.find(c=>c.family==="skills").backend.path,"/v3/skill/versions")
  assert.equal(discoveryContracts.find((c)=>c.family==="exact-read").backend.method,"records.get")
  assert.equal(discoveryContracts.find((c)=>c.family==="code").backend.path,"/v3/code-graph/callers")
  assert.equal(discoveryContracts.find((c)=>c.family==="jobs").backend.method,"jobs.draft")
})
test("baseline and candidate schema bindings are explicit per arm, closed, and cannot turn unsupported semantics green",()=>{
  const catalog=JSON.parse(readFileSync(new URL("../packs/mem/catalog.json",import.meta.url)))
  const baseline=bindDiscoveryContracts({arm:"baseline-586",catalog,bindings:{}})
  assert.equal(baseline.filter((b)=>b.status==="schema-bound-offline").length,16)
  assert.equal(baseline.filter(b=>b.status==="expected-baseline-tool-behavior-failure").length,8)
  const synthetic={...catalog,source:{kind:"synthetic-unit-only"},tools:[...catalog.tools,{name:"synthetic_exact",input:{type:"object",additionalProperties:false,properties:{ids:{type:"array",items:{type:"string"}}},required:["ids"]}}]}
  const bound=bindDiscoveryContracts({arm:"synthetic-unit-only",catalog:synthetic,bindings:{"exact-read":{tool:"synthetic_exact",args:{ids:["rec_eval_1"]}}}})
  assert.equal(bound.filter((b)=>b.status==="schema-bound-offline").length,2)
  assert.ok(bound.every((b)=>b.runtime_verified===false))
  assert.throws(()=>bindDiscoveryContracts({arm:"candidate",catalog:synthetic,bindings:{"exact-read":{tool:"synthetic_exact",args:{ids:["rec_eval_1"],extra:true}}}}),/closed schema/)
})
