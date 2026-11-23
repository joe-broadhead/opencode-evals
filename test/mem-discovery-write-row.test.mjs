// LEG D (the round-5 diagnosis's write-path artifact): the fixture's records.put
// answer echoed the wire, so the minimal canonical body the sealed intent records
// (`records.put {record: {kind: "commitment", body: "Send the Quartz draft"}}`)
// was answered with a minimal row — and the REAL arm client's validWriteAnswer
// (arm src/backend/records.js record()) rejected it with "the service returned an
// invalid success response; the write outcome is unknown". The real records
// service never echoes the wire: it derives the public row from the stored record
// (newRecord records/src/model.js:293,305-313; the commitment bookkeeping
// model.js:276-285; the stated_by default model.js:270-275; #create
// records/src/store.js:3816-3832; pub() store.js:1411-1433). The fixture now
// answers that derived row for every commitment wire, and the grading contract's
// closed authorized payload (src/grade/adapters/mem-discovery.mjs) derives the
// same bookkeeping, so both wire shapes grade PASS. The read paths are untouched
// (pinned by the read-family flow suite).
import { test } from "node:test"
import assert from "node:assert/strict"
import { selectMemoryPlan } from "../src/run/mem-case-plan.mjs"
import { createDiscoveryStore } from "../worlds/mem/discovery-store.mjs"
import { discoveryCases } from "../packs/mem/discovery-plan.mjs"
import { discoveryFlow } from "./support/mem-discovery-flow.mjs"

const caseOf = () => {
  const s = discoveryCases.find((c) => c.family === "commitment")
  assert.ok(s, "the commitment discovery case exists")
  return s
}

// The full public row the real service derives for the sealed commitment, up to
// the capture contract's closed vocabulary (mem-discovery.mjs:294): every pub()
// field the capture admits, with the values the service derives from the body.
const derivedRow = (id) => ({
  kind: "commitment",
  body: "Send the Quartz draft",
  type: "commitment",
  title: "Send the Quartz draft",
  fields: { what: "Send the Quartz draft", owner: "user", state: "open" },
  stated_by: "agent",
  id,
  status: "current",
  version: 1,
})

function world() {
  const s = caseOf()
  const plan = selectMemoryPlan(s.id, { trial_id: "trial_row", expires_at: Date.now() + 60000 })
  const store = createDiscoveryStore({ spec: s, intent: plan.intent })
  const context = { case_id: s.id, trial_id: "trial_row", turn: 1, session: "ses_row", active: true }
  const invocation = { ...context, tool: `mem_${s.binding.tool}`, family: s.binding.tool, args: s.binding.args, pass: true, call_id: "call_row" }
  return { s, store, context, invocation }
}

test("the minimal sealed body is answered with the full service-derived public row", () => {
  const { store, context, invocation } = world()
  try {
    // The eval's sealed canonical body — the write the real arm client rejected
    // at the parent (the diagnosis's leg-D probe). Red there, green here.
    const answer = store.request("records.put", { record: { kind: "commitment", body: "Send the Quartz draft" } }, { context, invocation })
    assert.equal(answer.status, 200)
    assert.equal(answer.json.status, "stored")
    assert.equal(answer.json.created, true)
    assert.deepEqual(answer.json.record, derivedRow("rec_01KABCDE1234567890ABCDEFGK"))
    // Every field the real client's validWriteAnswer demands (arm records.js
    // record()): the id shape, the string fields, the fields object, version > 0.
    assert.match(answer.json.record.id, /^rec_[0-9A-HJKMNP-TV-Z]{26}$/)
    for (const key of ["kind", "type", "title", "body", "status"]) assert.equal(typeof answer.json.record[key], "string", key)
    assert.equal(typeof answer.json.record.fields, "object")
    assert.ok(!Array.isArray(answer.json.record.fields))
    assert.ok(answer.json.record.version > 0)
    // The stored row is the same public row, and a read returns it unchanged.
    assert.deepEqual(store.capture().after.personal.records.at(-1), derivedRow("rec_01KABCDE1234567890ABCDEFGK"))
    const read = store.request("records.get", { ids: [answer.json.record.id] }, { context })
    assert.deepEqual(read.json.records[0], derivedRow("rec_01KABCDE1234567890ABCDEFGK"))
  } finally {
    store.close()
  }
})

test("the real plugin's full wire is answered byte-identically with the same derived row", () => {
  const { s, store, context, invocation } = world()
  try {
    // The exact wire both arms' records-store builds for the sealed add (arm
    // src/records-store.js commitmentRecord: kind, type, title, body, fields,
    // stated_by "agent", source {session}) — byte-identical to the parent's
    // wire-echo answer for this wire.
    const wire = { record: { kind: "commitment", type: "commitment", title: "Send the Quartz draft", body: "Send the Quartz draft", fields: { what: "Send the Quartz draft", owner: "user", state: "open" }, stated_by: "agent", source: { session: context.session } } }
    const answer = store.request("records.put", wire, { context, invocation })
    assert.equal(answer.status, 200)
    assert.deepEqual(answer.json.record, { ...derivedRow("rec_01KABCDE1234567890ABCDEFGK"), source: { session: context.session } })
    // The canonical projection and the wire are recorded unchanged, the write
    // envelope is unchanged, and the creator row is the sealed operation's.
    const row = store.capture().requests.at(-1)
    assert.deepEqual(row.input, s.backend.input)
    assert.deepEqual(row.wire_input, wire)
    assert.equal(row.status, "stored")
    assert.deepEqual(store.capture().discovery.creators, [{ id: "rec_01KABCDE1234567890ABCDEFGK", case_id: context.case_id, trial_id: context.trial_id, turn: 1, session: context.session, tool: `mem_${s.binding.tool}`, args: s.binding.args, status: "stored" }])
  } finally {
    store.close()
  }
})

test("both wire shapes grade PASS and the control still measures the plugins", () => {
  // (c): MEM-RT01's expectations still measure the plugins — the graded flow's
  // verdict stays PASS for the minimal canonical wire and the real plugin wire,
  // and the capture records a successful stored commitment (no error-bearing
  // outcome). The native call output is the fixture's answer, so the grader's
  // error-bearing native-output check (mem-discovery.mjs:107) runs on every drive.
  const s = caseOf()
  for (const flow of [
    discoveryFlow(s, "direct"),
    discoveryFlow(s, "execute"),
    discoveryFlow(s, "direct", { recordMetadata: { type: "commitment", title: "Send the Quartz draft", stated_by: "agent", source: { session: "ses_spec" }, fields: { what: "Send the Quartz draft", owner: "user", state: "open" } } }),
  ]) {
    const grade = flow.grade()
    assert.equal(grade.verdict, "PASS", JSON.stringify(grade.items))
    assert.ok(grade.items.some(i => i.id === "MEM-RT01" && i.state === "pass"), "the control measures the plugins")
    // The write row in the graded capture is the full public row.
    const row = flow.capture.requests.find(r => r.method === "records.put")
    assert.equal(row.output.status, "stored")
    assert.equal(row.output.created, true)
    assert.equal(row.output.record.type, "commitment")
    assert.equal(row.output.record.title, "Send the Quartz draft")
    assert.deepEqual(row.output.record.fields, { what: "Send the Quartz draft", owner: "user", state: "open" })
    assert.equal(row.output.record.version, 1)
  }
})
