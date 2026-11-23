// SIGNATURE 2 (the round-6 diagnosis): five live trials died at the fixture's
// records read-input validator with `invalid_read_input` while the REAL
// records service accepts those exact wires. The recorded bodies, per trial
// journal (wave/runs/*/work/batch/runs/commit-mem-commitment-p.t1/tmp/
// mem-fixture/capture.json, requests[]):
//
//   records.list {"kind":"commitment","status":"all","limit":200,"full":true}
//     — baseline-direct-r3 [9][10], baseline-search-r1 [9][10][12][14][16][17],
//       baseline-search-r2 [5], baseline-search-r3 [5][6][7][12]-[19],
//       candidate-direct-r1 [5][6][7][13][14].
//     The real plugin builds this wire on every commitments read and every
//     commitments add (arm src/records-store.js listRecords: `records.list
//     {kind:"commitment",status:"all",limit:PAGE,full:true,...}` with
//     PAGE=200), and the real records service answers it (records/src/
//     store.js:4133-4185 — limit intInRange 1..200 at :4140, `body.full ===
//     true` honored at :4181, statusFilter "all" at :1521-1523).
//   records.get {"paths":["index"]}
//     — baseline-search-r1 [11], baseline-search-r3 [18]. The real plugin's
//       session-start dashboard read (arm src/records-store.js readIndex) and
//       every mem_page read of a path ref (arm src/tools/page.js getPage:
//       `RECORD_ID.test(ref) ? {ids:[ref]} : {paths:[ref]}`), and the real
//       service answers `{ids?, paths?}` (records/src/store.js:4104-4113:
//       "Send {ids: ["rec_…"]} or {paths: ["projects/harbour"]}").
//
// The fixture's validator (worlds/mem/discovery-input.mjs) was a stricter
// invented subset: records.list capped limit at 100 and had no `full` or
// `path_prefix` key; records.get took only `{ids}` in rec_ form. That gap is
// the artifact; this test pins the fix against the recorded bodies, and the
// boundaries the real validator keeps (limit 1..200, boolean full, unknown
// fields, the cursor rules) stay failing.
import { test } from "node:test"
import assert from "node:assert/strict"
import { selectMemoryPlan } from "../src/run/mem-case-plan.mjs"
import { createDiscoveryStore } from "../worlds/mem/discovery-store.mjs"
import { discoveryResponse } from "../worlds/mem/discovery-http.mjs"
import { discoveryCases } from "../packs/mem/discovery-plan.mjs"

const caseOf = () => {
  const s = discoveryCases.find((c) => c.family === "commitment")
  assert.ok(s, "the commitment discovery case exists")
  return s
}

function world(overrides = {}) {
  const s = { ...caseOf(), ...overrides }
  const plan = selectMemoryPlan(caseOf().id, { trial_id: "trial_read", expires_at: Date.now() + 60000 })
  const store = createDiscoveryStore({ spec: s, intent: plan.intent })
  const context = { case_id: caseOf().id, trial_id: "trial_read", turn: 1, session: "ses_read", active: true }
  const invocation = { ...context, tool: `mem_${caseOf().binding.tool}`, family: caseOf().binding.tool, args: caseOf().binding.args, pass: true, call_id: "call_read" }
  return { s, store, context, invocation }
}

test("the recorded records.list wire of every failed trial is accepted and answered like the real service", () => {
  const { store, context, invocation } = world()
  try {
    // The exact body captured in all five errored trials.
    const wire = { kind: "commitment", status: "all", limit: 200, full: true }
    const first = store.request("records.list", wire, { context })
    assert.equal(first.status, 200, JSON.stringify(first))
    assert.deepEqual(first.json.records, [])
    assert.equal(first.json.cursor, null)
    assert.equal(first.json.more, false)
    // The sealed write reaches the row only through this read (the real
    // plugin's add path reads the space's commitments before records.put).
    const put = store.request("records.put", { record: { kind: "commitment", body: "Send the Quartz draft" } }, { context, invocation })
    assert.equal(put.status, 200)
    const listed = store.request("records.list", wire, { context })
    assert.equal(listed.status, 200)
    assert.equal(listed.json.records.length, 1)
    assert.equal(listed.json.records[0].body, "Send the Quartz draft")
    assert.equal(listed.json.records[0].kind, "commitment")
    assert.equal(listed.json.cursor, null)
    assert.equal(listed.json.more, false)
    // The same wire over the codec the plugins actually called (the trials'
    // requests are POST /records/v1/records.list with the caller's token).
    const http = discoveryResponse(store, {
      method: "POST",
      path: "/records/v1/records.list",
      headers: { authorization: "Bearer eval-token", "x-mem-space-id": "eval-space-personal" },
      body: wire,
    }, { context })
    assert.equal(http.status, 200, JSON.stringify(http))
    assert.equal(http.json.records.length, 1)
    assert.equal(http.json.records[0].body, "Send the Quartz draft")
  } finally {
    store.close()
  }
})

test("the recorded records.get path wire of the search trials is answered with the miss the real service returns", () => {
  const { store, context, invocation } = world()
  try {
    // The exact body captured in baseline-search-r1 [11] and baseline-search-r3 [18]
    // (the real plugin's readIndex and mem_page path refs).
    const index = store.request("records.get", { paths: ["index"] }, { context })
    assert.equal(index.status, 200, JSON.stringify(index))
    assert.deepEqual(index.json, { records: [], missing: ["index"] })
    // Over the codec the plugins actually called: POST /records/v1/records.get.
    const http = discoveryResponse(store, {
      method: "POST",
      path: "/records/v1/records.get",
      headers: { authorization: "Bearer eval-token", "x-mem-space-id": "eval-space-personal" },
      body: { paths: ["index"] },
    }, { context })
    assert.equal(http.status, 200, JSON.stringify(http))
    assert.deepEqual(http.json, { records: [], missing: ["index"] })
    // A page read by path resolves the stored page; the ids form keeps working.
    const put = store.request("records.put", { record: { kind: "commitment", body: "Send the Quartz draft" } }, { context, invocation })
    assert.equal(put.status, 200)
    const byId = store.request("records.get", { ids: [put.json.record.id] }, { context })
    assert.equal(byId.status, 200)
    assert.equal(byId.json.records[0].id, put.json.record.id)
    assert.deepEqual(byId.json.missing, [])
    // ids and paths together, as the real contract allows (store.js:4104-4113).
    const both = store.request("records.get", { ids: [put.json.record.id], paths: ["index"] }, { context })
    assert.equal(both.status, 200)
    assert.equal(both.json.records.length, 1)
    assert.deepEqual(both.json.missing, ["index"])
  } finally {
    store.close()
  }
})

test("the real records.list contract's own boundaries still refuse out-of-contract reads", () => {
  const { store, context } = world()
  try {
    for (const input of [
      { kind: "commitment", status: "all", limit: 201, full: true }, // the real limit is 1..200 (store.js:4140)
      { kind: "commitment", status: "all", limit: 200, full: "yes" }, // the real service honors only full === true
      { kind: "commitment", status: "all", limit: 200, full: true, unknown: true }, // closed vocabulary
      { kind: "commitment", status: "invented", limit: 200, full: true }, // status must be "all", "current" or real statuses
      { kind: "commitment", status: ["open", "invented"], limit: 200 }, // a status list must be real statuses
      { paths: [] }, // records.get needs at least one id or path (store.js:4113)
      { ids: [], paths: [] },
      { ids: Array.from({ length: 51 }, (_, i) => `rec_${i}`) }, // at most 50 together (store.js:4114)
    ]) assert.notEqual(store.request(input.paths || (input.ids && !input.kind) ? "records.get" : "records.list", input, { context }).status, 200, JSON.stringify(input))
  } finally {
    store.close()
  }
})

test("bodies are cut to the real list length unless full, exactly as the real listed() does", () => {
  const base = caseOf()
  const long = "Quartz ledger line. ".repeat(40)
  const seed = structuredClone(base.seed)
  seed.personal.records = [{ id: "rec_01KABCDE1234567890ABCDEFGH", kind: "commitment", type: "commitment", title: "Quartz ledger", body: long, fields: { what: "Quartz ledger", owner: "user", state: "open" }, stated_by: "agent", status: "current", version: 2 }]
  const { store, context } = world({ seed })
  try {
    const full = store.request("records.list", { kind: "commitment", status: "all", limit: 200, full: true }, { context })
    assert.equal(full.status, 200)
    assert.equal(full.json.records[0].body, long)
    assert.equal(full.json.records[0].body_clipped, undefined)
    const cut = store.request("records.list", { kind: "commitment", status: "all", limit: 200 }, { context })
    assert.equal(cut.status, 200)
    assert.ok(cut.json.records[0].body.length <= 500)
    assert.equal(cut.json.records[0].body_clipped, true)
    assert.ok(cut.json.records[0].body.endsWith("…"))
  } finally {
    store.close()
  }
})
