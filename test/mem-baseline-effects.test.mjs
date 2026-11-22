import { test } from "node:test"
import assert from "node:assert/strict"
import { baselineEffect } from "../worlds/mem/baseline-effects.mjs"
test("HTTP success is not durable success: actual readback, complete files and nonqueued receipts are required",()=>{
  const input={record:{kind:"memory",body:"Quartz is green."}},record={id:"rec_eval_1",kind:"memory",body:"Quartz is green."},response={status:200,json:{record}},before={records:[]},after={records:[record]}
  assert.equal(baselineEffect("/records/v1/records.put",input,response,before,after,"personal").status,"stored")
  assert.equal(baselineEffect("/records/v1/records.put",input,response,before,before,"personal").status,"partial")
  for(const status of ["queued","denied","partial","unsupported","processing"])assert.equal(baselineEffect("/records/v1/records.put",input,{status:200,json:{data:{status,record}}},before,after,"personal").status,status)
  const files={wiki_id:"wiki-eval-1",files:[{filename:"README.md",content:"Quartz"}]},wiki={knowledge:[{knowledge_id:"wiki-eval-1",raw:{"README.md":"Quartz"}}]}
  assert.equal(baselineEffect("/v3/wiki/raw/write",files,{status:200,json:{data:{items:[{filename:"README.md",status:"written"}]}}},{},wiki,"personal").status,"stored")
  assert.equal(baselineEffect("/v3/wiki/raw/write",files,{status:200,json:{data:{items:[]}}},{},{knowledge:[]},"personal").status,"partial")
  assert.equal(baselineEffect("/records/v1/records.revise",{action:"forget",id:"rec_eval_1"},{status:200,json:{}},after,before,"personal").status,"stored")
  assert.equal(baselineEffect("/records/v1/records.revise",{action:"forget",id:"rec_eval_1"},{status:200,json:{}},before,before,"personal").status,"partial")
  const batch=baselineEffect("/records/v1/records.revise",{action:"forget",ids:["rec_eval_1"]},{status:200,json:{}},after,before,"personal")
  assert.equal(batch.status,"stored")
  assert.equal(batch.id,"rec_eval_1")
})
