// The runner's completion dispatch at its real seam: the composition runJobBody's
// Memory turn launch goes through, exercised over a finite fake wire. The fakes are
// stand-in byte values on the pinned 2.2.6 source shapes; they mirror no verifier,
// codec or runner logic, start no process, and touch no network.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { completionTurnBinding, createCompletionTransportOwner, runObservedPromptTurn } from "../src/run/runner.mjs"

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex")
const tick = () => new Promise(done => setImmediate(done))
const sleep = ms => new Promise(done => setTimeout(done, ms))
const SESSION = "ses_runner_trial"
const ORIGIN = "http://127.0.0.1:43123"
const AUTHORIZATION = `Basic ${Buffer.from("opencode:runner-password").toString("base64")}`

// Source-shaped wire values from the pinned unions (the same fields the reviewed
// composition controls use); finite literal fixtures, never recomputed logic.
const frame = value => Buffer.from(`data: ${JSON.stringify(value)}\n\n`)
const connected = { id: "evt_connected", type: "server.connected", data: {} }
const turnEvent = (type, id, data) => ({ id: `evt_${id}`, type, created: 3, data, durable: { aggregateID: data.sessionID, seq: 1, version: 1 } })
const message = (id, type, fields = {}) => ({ id, type, time: { created: 2 }, ...fields })
const delivered = turnEvent("session.inbox.delivered", "delivered", { sessionID: SESSION, inboxID: "msg_prompt" })
const succeeded = turnEvent("session.execution.succeeded", "done", { sessionID: SESSION })
const failed = turnEvent("session.execution.failed", "done", { sessionID: SESSION, error: { type: "example", message: "failed" } })
const idle = (outcome = "succeeded", id = "msg_first") => message(id, "idle", { outcome })
const user = message("msg_prompt", "user", { text: "the trial's prompt" })

/** A finite fake completion wire: every response is a fixed byte value, the event
 * stream stays pending until the observation closes it, and every dispatch is
 * recorded so a test can prove no read left the six-read contract. */
function fakeWire({ session = SESSION, baseline = [], projection = [idle(), user], events = [delivered, succeeded], stall = false } = {}) {
  const dispatches = []
  let launched = 0
  let pending = null
  const ended = { value: false }
  const queue = stall ? [] : [frame(connected)]
  const push = bytes => {
    if (pending) { const resolve = pending; pending = null; resolve({ done: false, value: bytes }) } else queue.push(bytes)
  }
  const eventReader = {
    read() {
      if (queue.length) return Promise.resolve({ done: false, value: queue.shift() })
      if (ended.value) return Promise.resolve({ done: true })
      return new Promise(resolve => { pending = resolve })
    },
    cancel() { ended.value = true; if (pending) { const resolve = pending; pending = null; resolve({ done: true }) } return Promise.resolve() },
    releaseLock() {},
  }
  const finite = chunks => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }), cancel: async () => {}, releaseLock() {} })
  const json = (value, status = 200) => ({ status, redirected: false, headers: new Headers({ "content-type": "application/json" }), body: { getReader: () => finite([Buffer.from(JSON.stringify(value))]) } })
  const empty = { status: 204, redirected: false, headers: new Headers({ "content-type": "application/json" }), body: { getReader: () => finite([]) } }
  const fetchImpl = async (url, init) => {
    const path = new URL(String(url)).pathname
    dispatches.push({ path, method: init.method })
    if (path === "/api/event") return { status: 200, redirected: false, headers: new Headers({ "content-type": "text/event-stream" }), body: { getReader: () => eventReader } }
    if (path === `/api/session/${session}/message`) return json({ data: launched ? projection : baseline, cursor: {} })
    if (path === `/api/experimental/session/${session}/wait`) return empty
    if (path === "/api/experimental/job") return json({ data: [] })
    if (path === `/api/session/${session}/inbox`) return json({ data: [] })
    if (path === "/api/session/active") return json({ data: {} })
    throw new Error(`unexpected fetch ${url}`)
  }
  return { fetchImpl, dispatches, markLaunched: () => { launched++; for (const event of events) push(frame(event)) } }
}

const identity = (trial, session = SESSION) => completionTurnBinding({
  caseID: "core-wiki-write", trialID: `core-wiki-write.t1-${trial}`, turn: 1,
  activationID: `activation-${trial}`, incarnationID: "11111111-1111-4111-8111-111111111111", sessionID: session,
})

/** One observation attempt: the promise is kept apart from the attempt's state, so a
 * test can read the persisted records and the launch count even when it rejects. */
function observedTurn(wire, { binding = identity("a"), raw = Buffer.from("the run's exact stdout bytes"), launch, limits, signal, owner = createCompletionTransportOwner() } = {}) {
  const records = []
  const state = { launches: 0, gate: null }
  const theLaunch = launch ?? (async ({ binding: bound, signal: gateSignal }) => {
    state.gate = { binding: bound, signal: gateSignal }
    wire.markLaunched()
    return { binding: bound, raw }
  })
  const promise = runObservedPromptTurn({
    binding, origin: ORIGIN, authorization: AUTHORIZATION, fetchImpl: wire.fetchImpl, transportOwner: owner,
    launch: async gate => { state.launches++; return theLaunch(gate) },
    signal, limits,
    persist: record => records.push(structuredClone(record)),
  })
  return { promise, records, launches: () => state.launches, gate: () => state.gate, owner }
}

test("the completion turn binding is the trial's own complete serial identity", () => {
  const binding = identity("abc123")
  assert.deepEqual(binding, {
    caseID: "core-wiki-write", trialID: "core-wiki-write.t1-abc123", turnID: "1",
    activationID: "activation-abc123", incarnationID: "11111111-1111-4111-8111-111111111111", sessionID: SESSION,
    scope: { complete: true, serial: true, sessionIDs: [SESSION] },
  })
  assert.deepEqual(binding.scope.sessionIDs, [binding.sessionID])
  // The binding is the runner's own fact list: an absent or empty identity field is
  // refused before any transport exists, and the turn index is the trial's own turn.
  for (const bad of [{}, { caseID: "" }, { caseID: "c", trialID: null }, { caseID: "c", trialID: "t", turn: 0 }, { caseID: "c", trialID: "t", turn: 1.5 }]) {
    assert.throws(() => completionTurnBinding(bad), /required/, JSON.stringify(bad))
  }
})

test("one observed turn binds the exact per-trial identity, keeps the launch's receipt and stays PROVISIONAL", async () => {
  const wire = fakeWire()
  const raw = Buffer.from([9, 0, 255, 13, 10, 114, 97, 119, 0, 9])
  const turn = observedTurn(wire, { binding: identity("a"), raw })
  const outcome = await turn.promise
  // The launch ran once, inside the observation window, with the runner's bound identity.
  assert.equal(turn.launches(), 1)
  assert.deepEqual(turn.gate().binding, identity("a"))
  assert.ok(turn.gate().signal instanceof AbortSignal)
  // The receipt is the launch's own return, unchanged: no second prompt path exists.
  assert.deepEqual(outcome.receipt, { binding: identity("a"), raw })
  // Exactly the six reads, each in its runner-controlled phase; no prompt-submission path was dispatched.
  const paths = wire.dispatches.map(d => `${d.method} ${d.path}`).sort()
  assert.deepEqual(paths, [
    "GET /api/event",
    "GET /api/experimental/job", "GET /api/experimental/job",
    "GET /api/session/active", "GET /api/session/active",
    `GET /api/session/${SESSION}/inbox`, `GET /api/session/${SESSION}/inbox`,
    `GET /api/session/${SESSION}/message`, `GET /api/session/${SESSION}/message`,
    `POST /api/experimental/session/${SESSION}/wait`,
  ])
  // Raw byte ownership: the record digests the exact bytes the launch returned.
  assert.equal(turn.records.length, 1)
  const record = turn.records[0]
  assert.deepEqual(record.raw, { status: "known", bytes: raw.length, sha256: sha256(raw) })
  assert.deepEqual(record.binding, identity("a"))
  assert.equal(record.schema, "mem-native-completion/1")
  assert.equal(record.phase, "PROVISIONAL")
  assert.equal(record.accepted, false)
  assert.equal(record.wire.status, "unqualified")
  assert.deepEqual(record.admission, { status: "known", promptID: "msg_prompt" })
  assert.deepEqual(record.native, { status: "known", promptID: "msg_prompt", idleID: "msg_first", outcome: "succeeded" })
  // Even a fully corroborated turn is never acceptance, and grants no completion authority.
  assert.equal(record.logicalProof, true)
  for (const key of ["execution_qualified", "complete", "successor_allowed"]) assert.equal(Object.hasOwn(record, key), false, key)
  // Every transport handle the observation opened was released again.
  assert.deepEqual(turn.owner.outstanding(), [])
})

test("each trial's turn binds its own identity; two trials never borrow each other's scope", async () => {
  for (const [trial, session] of [["t1", "ses_trial_one"], ["t2", "ses_trial_two"]]) {
    const wire = fakeWire({ session })
    const binding = completionTurnBinding({ caseID: "core-wiki-write", trialID: `core-wiki-write.t1-${trial}`, turn: 3, activationID: `activation-${trial}`, incarnationID: "11111111-1111-4111-8111-111111111111", sessionID: session })
    const raw = Buffer.from(`the exact captured stdout of ${trial}`)
    const turn = observedTurn(wire, { binding, raw })
    const outcome = await turn.promise
    assert.deepEqual(turn.records[0].binding, binding)
    assert.deepEqual(turn.records[0].binding.scope, { complete: true, serial: true, sessionIDs: [session] })
    assert.deepEqual(turn.records[0].raw, { status: "known", bytes: raw.length, sha256: sha256(raw) })
    assert.ok(outcome.receipt.raw.equals(raw))
  }
})

test("an incomplete serial scope is refused before any transport or launch exists", async () => {
  const wire = fakeWire()
  const owner = createCompletionTransportOwner()
  const foreign = { ...identity("a"), scope: { complete: true, serial: true, sessionIDs: ["ses_foreign"] } }
  await assert.rejects(observedTurn(wire, { binding: foreign, owner }).promise, /invalid_endpoint_lease|invalid_binding/)
  const duplicated = { ...identity("a"), scope: { complete: true, serial: true, sessionIDs: [SESSION, SESSION] } }
  await assert.rejects(observedTurn(wire, { binding: duplicated, owner }).promise, /invalid_endpoint_lease|invalid_binding/)
  assert.deepEqual(wire.dispatches, [])
  assert.deepEqual(owner.outstanding(), [])
})

test("a cancelled window dispatches no prompt: the record is persisted and the launch never ran", async () => {
  // The stream never answers, so the gate cannot open; the cancellation arrives first.
  const stalled = fakeWire({ stall: true })
  const cancel = new AbortController()
  const stalledTurn = observedTurn(stalled, { signal: cancel.signal, limits: { deadlineMs: 5000 } })
  await tick()
  cancel.abort()
  await assert.rejects(stalledTurn.promise, /never dispatched/)
  assert.equal(stalledTurn.launches(), 0)
  assert.equal(stalledTurn.records.length, 1)
  assert.equal(stalledTurn.records[0].accepted, false)
  assert.ok(stalledTurn.records[0].health.issues.includes("cancelled"))
  // A window cancelled before the observation began dispatches nothing at all.
  const pre = observedTurn(fakeWire(), { signal: AbortSignal.abort(), limits: { deadlineMs: 5000 } })
  await assert.rejects(pre.promise, /never dispatched/)
  assert.equal(pre.launches(), 0)
  assert.equal(pre.records.length, 1)
  assert.deepEqual(pre.records[0].admission, { status: "unknown" })
  assert.deepEqual(pre.owner.outstanding(), [])
  // No read left the wire after either cancellation closed its window.
  const stalledBefore = stalled.dispatches.length
  await sleep(20)
  assert.equal(stalled.dispatches.length, stalledBefore)
})

test("an abort during the launch keeps the single dispatch, returns its receipt and never re-dispatches", async () => {
  const wire = fakeWire()
  const cancel = new AbortController()
  let sawGate = null
  const launch = async ({ binding, signal }) => {
    sawGate = signal
    wire.markLaunched()
    await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }))
    return { binding, raw: Buffer.from("cut short after the model worked") }
  }
  const turn = observedTurn(wire, { launch, signal: cancel.signal, limits: { deadlineMs: 5000 } })
  await tick()
  await tick()
  cancel.abort()
  const outcome = await turn.promise
  assert.ok(sawGate instanceof AbortSignal)
  assert.equal(turn.launches(), 1)
  assert.equal(turn.records.length, 1)
  assert.equal(turn.records[0].accepted, false)
  assert.ok(turn.records[0].health.issues.includes("cancelled"))
  assert.ok(outcome.receipt.raw.equals(Buffer.from("cut short after the model worked")))
  const before = wire.dispatches.length
  await sleep(20)
  assert.equal(wire.dispatches.length, before)
})

test("the deadline closes the window without a late dispatch, and an in-flight launch is awaited, never repeated", async () => {
  // The gate never opens: the observation ends at its deadline with no prompt dispatched.
  const stalled = fakeWire({ stall: true })
  const stalledTurn = observedTurn(stalled, { limits: { deadlineMs: 30 } })
  await assert.rejects(stalledTurn.promise, /never dispatched/)
  assert.equal(stalledTurn.launches(), 0)
  assert.equal(stalledTurn.records.length, 1)
  assert.ok(stalledTurn.records[0].health.issues.includes("deadline"))
  assert.equal(stalled.dispatches.filter(d => d.path === "/api/event").length, 1)
  const stalledBefore = stalled.dispatches.length
  await sleep(40)
  assert.equal(stalled.dispatches.length, stalledBefore)
  // The gate opened but the launch outran the window: its one dispatch is awaited, not repeated.
  const wire = fakeWire()
  let launches = 0
  const launch = async ({ binding }) => {
    launches++
    wire.markLaunched()
    await sleep(60)
    return { binding, raw: Buffer.from("the turn outlasted the observation window") }
  }
  const turn = observedTurn(wire, { launch, limits: { deadlineMs: 40 } })
  const outcome = await turn.promise
  assert.equal(launches, 1)
  assert.equal(turn.records.length, 1)
  assert.equal(turn.records[0].accepted, false)
  assert.ok(turn.records[0].health.issues.includes("deadline"))
  assert.ok(outcome.receipt.raw.equals(Buffer.from("the turn outlasted the observation window")))
  assert.equal(wire.dispatches.filter(d => d.path === "/api/event").length, 1)
})

test("a turn that billed and then failed keeps its partial billing and its native negative, never acceptance", async () => {
  const wire = fakeWire({ projection: [idle("failed"), user], events: [delivered, failed] })
  const billed = Buffer.from('{"type":"step_finish","part":{"cost":0.31,"tokens":{"input":900,"output":40}}}\n{"type":"error","error":{"type":"provider.unknown","message":"revoked mid-run"}}\n')
  const turnResult = { code: 1, stdout: billed.toString("utf8"), stderr: "" }
  const launch = async ({ binding }) => {
    wire.markLaunched()
    return { binding, raw: billed, result: turnResult }
  }
  const turn = observedTurn(wire, { launch })
  const outcome = await turn.promise
  const record = turn.records[0]
  assert.deepEqual(record.native, { status: "known", promptID: "msg_prompt", idleID: "msg_first", outcome: "failed" })
  assert.deepEqual(record.raw, { status: "known", bytes: billed.length, sha256: sha256(billed) })
  assert.equal(record.accepted, false)
  assert.equal(record.logicalProof, false)
  // The turn's own result — what the runner's existing billing path reads — passes through unchanged.
  assert.deepEqual(outcome.receipt.result, turnResult)
  for (const key of ["execution_qualified", "complete", "successor_allowed"]) assert.equal(Object.hasOwn(record, key), false, key)
})

test("the transport owner retains exactly the handles the observation opens and releases them on settlement", async () => {
  const owner = createCompletionTransportOwner()
  assert.deepEqual(owner.outstanding(), [])
  const handle = { abort: () => {}, settled: Promise.resolve({ released: true }) }
  const release = owner.track(handle)
  assert.equal(typeof release, "function")
  assert.deepEqual(owner.outstanding(), [handle])
  release()
  assert.deepEqual(owner.outstanding(), [])
  const turn = observedTurn(fakeWire(), { owner })
  await turn.promise
  assert.deepEqual(owner.outstanding(), [])
})
