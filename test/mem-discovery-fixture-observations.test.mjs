import {test} from "node:test"
import assert from "node:assert/strict"
import {discoveryCases} from "../packs/mem/discovery-plan.mjs"
import {discoveryFlow} from "./support/mem-discovery-flow.mjs"

test("finite-store fixture retains completed observations rather than reusing source diagnostics",()=>{
  const spec=discoveryCases.find(s=>s.id==="commit-mem-memory")
  const flow=discoveryFlow(spec,"execute")
  const observed=flow.capture.discovery.turns[0].calls[0]
  assert.equal(observed.status,"completed")
  assert.notEqual(observed.args_source,"source")
  const stored=flow.capture.after.personal.records.at(-1)
  assert.equal(JSON.parse(observed.output).record.id,stored.id)
  assert.equal(stored.body,"Quartz uses green labels.")
})
