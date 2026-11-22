// Audited offline allowlist: direct actual records store/adapter calls; no server/listener imports.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { openRecordsStore, handleRecords } from "../worlds/mem/baseline-586/stub/records-adapter.js"
import { recordsHeaders } from "../worlds/mem/baseline-586/scripts/eval/records-world.mjs"
import { CONTROL_SPACES } from "../worlds/mem/baseline-586/scripts/eval/harness-state.mjs"
import { baselineRoute, stageBaselineFixture } from "../src/run/mem-baseline.mjs"
import { baselineScopeHeaders } from "../worlds/mem/baseline-routing.mjs"
import { coreCases } from "../packs/mem/core.mjs"

test("baseline routing is closed to reserved local services and preserves real gateway/control/records paths",()=>{
  assert.deepEqual(baselineRoute("POST","/records/v1/records.put"),{upstream:"control",path:"/records/v1/records.put"})
  assert.deepEqual(baselineRoute("POST","/core/v3/atomic/search"),{upstream:"stub",path:"/v3/atomic/search"})
  assert.deepEqual(baselineRoute("POST","/knowledge/v3/wiki/raw/read"),{upstream:"stub",path:"/v3/wiki/raw/read"})
  assert.equal(baselineRoute("GET","https://production.example/v1/context"),null)
  assert.equal(baselineRoute("GET","/debug/state"),null)
  assert.equal(baselineRoute("POST","/core/../debug/seed"),null)
  assert.throws(()=>baselineScopeHeaders({mode:"local"},{authorization:"Bearer eval-token","x-mem-space-id":"eval-space-shared"},{}),/scope/)
  assert.throws(()=>baselineScopeHeaders({mode:"local"},{authorization:"Bearer eval-token"},{team_id:"eval-container-shared"}),/container/)
  const headers=baselineScopeHeaders({mode:"control"},{authorization:"Bearer eval-token","x-mem-space-id":"eval-space-shared","x-records-role":"owner","x-records-credential":"session"},{})
  assert.equal(headers["x-records-role"],undefined)
  assert.equal(headers["x-records-credential"],undefined)
})
test("host staging verifies archived bytes, binds frozen seeds and removes only listener autostart in an owned derivative",()=>{
  const root=mkdtempSync(join(tmpdir(),"mem-baseline-stage-"))
  try {
    const s=coreCases.find((s)=>s.original_id==="core-privacy-private")
    const plan=stageBaselineFixture(root,s)
    assert.equal(plan.seed.atoms[0].team_id,"eval-container-personal")
    assert.equal(plan.seed.atoms[1].team_id,"eval-container-shared")
    assert.equal(plan.defaultSpace,"shared")
    assert.match(readFileSync(join(root,"baseline-586/stub/contained-server.mjs"),"utf8"),/export async function startFrozenStub/)
    assert.equal(readFileSync(join(root,"baseline-586/stub/server.js"),"utf8"),readFileSync(new URL("../worlds/mem/baseline-586/stub/server.js",import.meta.url),"utf8"))
  } finally {rmSync(root,{recursive:true,force:true})}
})
test("actual frozen records adapter stores privately, rejects wrong-space/forged gateway identity and reads durable bytes",async()=>{
  const root=mkdtempSync(join(tmpdir(),"mem-real-records-")),store=await openRecordsStore({dataDir:root,now:()=>new Date("2026-11-12T10:00:00Z")})
  try {
    const personal=recordsHeaders(CONTROL_SPACES.personal,{user:"eval",agent:"build",session:"ses_gold"})
    const shared=recordsHeaders(CONTROL_SPACES.shared,{user:"eval",role:"editor",agent:"build",session:"ses_gold"})
    const put=await handleRecords(store,"records.put",{record:{kind:"memory",type:"fact",body:"Quartz uses green labels."}},personal)
    assert.equal(put.status,200,JSON.stringify(put.json))
    const id=put.json.record.id
    const read=await handleRecords(store,"records.get",{ids:[id]},personal)
    assert.equal(read.json.records[0].body,"Quartz uses green labels.")
    const wrong=await handleRecords(store,"records.get",{ids:[id]},shared)
    assert.deepEqual(wrong.json,{records:[],missing:[id]})
    const forged=await handleRecords(store,"records.get",{ids:[id]},{...personal,"x-records-role":"invented"})
    assert.equal(forged.status,400)
    assert.equal(forged.json.error.code,"invalid_role")
    const request=await handleRecords(store,"sources.request",{source:"gmail",account:"quartz-synthetic"},personal)
    assert.equal(request.status,200,JSON.stringify(request.json))
    assert.equal(request.json.request.state,"requested")
    const listed=await handleRecords(store,"sources.list",{},personal)
    assert.equal(listed.json.sources.length,0,"a requested source is not a binding")
    const bind=await handleRecords(store,"sources.bind",{source:"gmail",account:"quartz-synthetic",owner:{id:"eval",label:"Synthetic Eval"}},personal)
    assert.equal(bind.status,403)
    assert.equal(bind.json.error.code,"session_required")
    const drafted=await handleRecords(store,"jobs.draft",{template:"slack-threads-project",project:"quartz",account:"quartz-synthetic"},personal)
    assert.equal(drafted.status,200,JSON.stringify(drafted.json))
    assert.equal(drafted.json.job.status,"draft")
    assert.equal(drafted.json.job.next_due,null)
    const jobs=await handleRecords(store,"jobs.list",{},personal)
    assert.equal(jobs.json.jobs[0].status,"draft")
  } finally {await store.close();rmSync(root,{recursive:true,force:true})}
})
