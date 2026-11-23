// The real arm plugins' write-bootstrap surfaces against the finite discovery codec.
//
// Round-5 invocation-1 (baseline-direct-commit-mem-commitment-p-r1) failed with no
// write reaching this fixture: the plugin's debug log recorded
// `MEMORY_NOT_FOUND: /health: Not Found` and `plugins.report:
// unsupported_operation`, and its mem_commitments add answered
// `SPACES_REJECTED: context: (invalid_bootstrap_input)`. The real deployed
// service serves all three surfaces, so this file pins each one to the real
// contract the arm plugin's own client code consumes:
//
//   GET  <baseURL>/health           arm src/backend/v3.js health() (2xx JSON is
//                                   all it requires; it reads data.status), probed
//                                   once at setup (src/index.js, advisory).
//   POST /v1/context {user_id, session_id, agent[, space_id, bind]}
//                                   arm src/spaces.js resolveContext via
//                                   src/runtime.js on every private write:
//                                   mem_commitments add -> resolvePrivateSpace ->
//                                   captureContext -> sessionContext.
//   POST /records/v1/plugins.report {layout, full, plugins}
//                                   arm src/plugins/discovery.js startup/timer
//                                   scan; the records client accepts any answer
//                                   whose `plugins` is an array (arm
//                                   src/backend/records.js validWriteAnswer).
//
// Real-service citations live beside each assertion; all offline, no container.
import { test } from "node:test"
import assert from "node:assert/strict"
import { selectMemoryPlan } from "../src/run/mem-case-plan.mjs"
import { createDiscoveryStore } from "../worlds/mem/discovery-store.mjs"
import { discoveryResponse, discoveryRoute } from "../worlds/mem/discovery-http.mjs"
import { discoveryCases } from "../packs/mem/discovery-plan.mjs"

// The very case that failed live: family "commitment" (MEM-RT01).
const caseOf = () => {
  const found = discoveryCases.find((s) => s.family === "commitment")
  assert.ok(found, "the commitment discovery case exists")
  return found
}

function world() {
  const s = caseOf()
  const plan = selectMemoryPlan(s.id, { trial_id: "trial_bootstrap", expires_at: Date.now() + 60000 })
  const store = createDiscoveryStore({ spec: s, intent: plan.intent })
  const context = { case_id: s.id, trial_id: "trial_bootstrap", turn: 1, session: "ses_bootstrap", active: true }
  const invocation = { ...context, tool: `mem_${s.binding.tool}`, family: s.binding.tool, args: s.binding.args, pass: true, call_id: "call_bootstrap" }
  return { s, store, context, invocation }
}

// The answer the codec served before this extension for a body of
// {user_id:"eval"} (or no body at all): byte-unchanged semantics require this
// exact object to keep coming back for those inputs.
const legacyContextAnswer = (space) => ({
  user_id: "eval",
  space: { id: `eval-space-${space}`, name: space === "personal" ? "Personal Workspace" : "Shared Workspace", kind: space, role: space === "personal" ? "owner" : "viewer" },
  collection: { id: `eval-collection-${space}`, name: "Synthetic collection" },
  placement: { container_id: `eval-container-${space}`, cell_id: "eval-cell", service_id: "eval-service" },
  session: { space_id: `eval-space-${space}` },
  personal_space: { id: "eval-space-personal", name: "Personal Workspace", kind: "personal" },
})

test("the plugin's backend probe GET /core/health answers the real gateway's per-role read", () => {
  const { store, context } = world()
  try {
    // The real gateway strips the /core prefix and forwards upstream /health to
    // the cell (deploy/auth/http/router.mjs:653-672), and upstream /health is a
    // read allowed for every role exactly because it is the plugin's backend
    // probe (deploy/auth/role-guard.mjs:29-32;
    // test/spaces-proxy.test.js:1378-1382). The real body carries status "ok"
    // (deploy/auth/http/router.mjs:546; the frozen product eval control
    // baseline-586/scripts/eval/harness-control.mjs:83-85).
    const probe = discoveryResponse(store, {
      method: "GET",
      path: "/core/health",
      // The arm probe's own headers (arm src/backend/v3.js health()): the
      // caller's token and its service id; no session, no space.
      headers: { authorization: "Bearer eval-token", "x-tdai-service-id": "local" },
    }, { context })
    assert.equal(probe.status, 200)
    assert.deepEqual(probe.json, { status: "ok" })

    // The real data plane requires the caller's key (router.mjs:660-662), and a
    // probe outside the eval's active turn still succeeds: the real gateway
    // answers it whenever the caller is authenticated, never only mid-case.
    assert.equal(discoveryResponse(store, { method: "GET", path: "/core/health", headers: { authorization: "Bearer eval-token" } }, { context: null }).status, 200)
    assert.equal(discoveryResponse(store, { method: "GET", path: "/core/health", headers: { authorization: "Bearer other" } }, { context }).status, 401)

    // The fixture's own root identity route is unchanged and stays unauthenticated.
    assert.deepEqual(discoveryResponse(store, { method: "GET", path: "/health", headers: {} }, { context }).json, { fixture: "mem-synthetic-v1", transport: "discovery-v2" })
    // The probe is a GET: a POST to it is not the real read route.
    assert.equal(discoveryResponse(store, { method: "POST", path: "/core/health", headers: { authorization: "Bearer eval-token" }, body: {} }, { context }).status, 404)
  } finally {
    store.close()
  }
})

test("the write bootstrap POST /v1/context accepts the real plugin's body and answers what its client resolves", () => {
  const { store, context } = world()
  try {
    // The arm plugin's exact write-bootstrap request (arm src/spaces.js
    // resolveContext: body {user_id, session_id, agent}; arm src/runtime.js
    // resolveContext passes the session and the agent). The real gateway
    // forwards exactly these keys (deploy/auth/http/context.mjs:172-177) and
    // the real control validates them (control/src/service/context.js:136-143).
    const headers = { authorization: "Bearer eval-token" }
    const bootstrap = discoveryResponse(store, { method: "POST", path: "/v1/context", headers, body: { user_id: "eval", session_id: context.session, agent: "build" } }, { context })
    assert.equal(bootstrap.status, 200)
    // The fields the arm's normalizeContext consumes for a private write: the
    // personal space, its container placement, the personal space id
    // captureContext compares against, and the session binding isSessionBound
    // reads (arm src/spaces.js normalizeContext; arm src/runtime.js:248-252).
    assert.equal(bootstrap.json.space.kind, "personal")
    assert.equal(bootstrap.json.space.id, "eval-space-personal")
    assert.equal(bootstrap.json.placement.container_id, "eval-container-personal")
    assert.equal(bootstrap.json.personal_space.id, "eval-space-personal")
    assert.equal(bootstrap.json.session.space_id, "eval-space-personal")

    // Existing accepted inputs keep their byte-identical answer.
    assert.deepEqual(
      discoveryResponse(store, { method: "POST", path: "/v1/context", headers, body: { user_id: "eval" } }, { context }).json,
      legacyContextAnswer("personal"),
    )
    assert.deepEqual(
      discoveryResponse(store, { method: "POST", path: "/v1/context", headers, body: {} }, { context }).json,
      legacyContextAnswer("personal"),
    )
    assert.deepEqual(
      discoveryResponse(store, { method: "POST", path: "/v1/context", headers, body: { user_id: "eval", space_id: "eval-space-shared", session_id: context.session, agent: "build" } }, { context }).json,
      legacyContextAnswer("shared"),
    )
    // mem_spaces current with bind: the real control binds a session sent
    // without a space to the personal space (control context.js:200-204).
    assert.equal(discoveryResponse(store, { method: "POST", path: "/v1/context", headers, body: { user_id: "eval", session_id: context.session, bind: true } }, { context }).status, 200)

    // The real control's refusals (control/src/service/context.js): a session
    // id with whitespace (136-139), an agent outside AGENT_PATTERN
    // (140-143, control/src/service/shared.js:59), a non-boolean bind (197-198)
    // and a bind without a session id (201).
    const bad = [
      { user_id: "eval", session_id: "ses boot", agent: "build" },
      { user_id: "eval", session_id: "x".repeat(201) },
      { user_id: "eval", agent: "not a real agent!" },
      { user_id: "eval", agent: "x".repeat(101) },
      { user_id: "eval", bind: "yes", session_id: context.session },
      { user_id: "eval", bind: true },
      { user_id: "eval", bind: true, session_id: "" },
    ]
    for (const body of bad) {
      assert.equal(discoveryResponse(store, { method: "POST", path: "/v1/context", headers, body }, { context }).status, 400, JSON.stringify(body))
    }
    // An empty string is absent, as the real validators read it
    // (control/src/validate.js:23-26).
    for (const body of [{ user_id: "eval", session_id: "" }, { user_id: "eval", agent: "" }, { user_id: "eval", session_id: "", agent: "" }]) {
      assert.equal(discoveryResponse(store, { method: "POST", path: "/v1/context", headers, body }, { context }).status, 200, JSON.stringify(body))
    }
    // The closed world keeps refusing keys outside the real gateway's set.
    assert.equal(discoveryResponse(store, { method: "POST", path: "/v1/context", headers, body: { user_id: "eval", team_id: "eval-container-personal" } }, { context }).status, 400)
    assert.equal(discoveryResponse(store, { method: "POST", path: "/v1/context", headers, body: { user_id: "another" } }, { context }).status, 403)
  } finally {
    store.close()
  }
})

test("the plugin's discovery report POST /records/v1/plugins.report answers the real records contract", () => {
  const { store, context } = world()
  try {
    // Codec-level on purpose: discoveryRoute stays closed (the finite store
    // keeps no plugin rows and the graded capture records only case
    // operations), so the report never mutates capture.json.
    assert.equal(discoveryRoute("POST", "/records/v1/plugins.report"), null)

    // The arm plugin's exact report body (arm src/plugins/discovery.js: layout,
    // full: true, plugins). The real records service serves POST
    // /v1/plugins.report (records/src/server.js:78,441-462), and the plugin's
    // own client accepts any answer whose `plugins` is an array (arm
    // src/backend/records.js validWriteAnswer). The real answer always carries
    // both fields (records/src/store.js:7419); with no plugin rows stored it is
    // the empty-table answer, matching this store's plugins.list.
    const report = { layout: true, full: true, plugins: [{ id: "mem", state: "available", package: "@joe-broadhead/opencode-mem", version: "0.15.12" }] }
    const headers = { authorization: "Bearer eval-token", "x-mem-space-id": "eval-space-personal" }
    const answer = discoveryResponse(store, { method: "POST", path: "/records/v1/plugins.report", headers, body: report }, { context })
    assert.equal(answer.status, 200)
    assert.ok(Array.isArray(answer.json.plugins), "the arm records client requires an array")
    assert.deepEqual(answer.json, { plugins: [], refused: [] })
    // The real records service has no turn concept: an authorized report is
    // answered whenever it arrives (records/src/server.js:441-462).
    assert.equal(discoveryResponse(store, { method: "POST", path: "/records/v1/plugins.report", headers, body: report }, { context: null }).status, 200)
    assert.equal(discoveryResponse(store, { method: "POST", path: "/records/v1/plugins.report", headers: { authorization: "Bearer other" }, body: report }, { context }).status, 401)

    // The real envelope refusals (records/src/store.js:7307-7309, error body
    // records/src/errors.js:26-34, cap store.js:421).
    for (const body of [
      { layout: "true", plugins: [] },
      { layout: true, full: "yes", plugins: [] },
      { layout: true, plugins: {} },
      { layout: true, plugins: Array.from({ length: 101 }, () => ({ id: "mem" })) },
    ]) {
      const refused = discoveryResponse(store, { method: "POST", path: "/records/v1/plugins.report", headers, body }, { context })
      assert.equal(refused.status, 400, JSON.stringify(body))
      assert.equal(refused.json.error.code, "invalid_request")
      assert.equal(typeof refused.json.error.message, "string")
      assert.equal(typeof refused.json.error.next, "string")
    }
  } finally {
    store.close()
  }
})

test("unknown routes still 404, and the bootstrap surfaces never touch the graded capture while the sealed write lands", () => {
  const { s, store, context, invocation } = world()
  try {
    const before = store.capture().requests
    // Unknown data-plane routes stay unsupported (the real gateway's G-10
    // posture this fixture mirrors).
    for (const req of [
      { method: "GET", path: "/core/v3/unknown", headers: { authorization: "Bearer eval-token" } },
      { method: "POST", path: "/records/v1/plugins.unknown", headers: { authorization: "Bearer eval-token" }, body: {} },
      { method: "GET", path: "/v3/skill/list", headers: { authorization: "Bearer eval-token" } },
      { method: "GET", path: "/knowledge/health", headers: { authorization: "Bearer eval-token" } },
    ]) {
      const answer = discoveryResponse(store, req, { context })
      assert.equal(answer.status, 404, `${req.method} ${req.path}`)
      assert.deepEqual(answer.json, { error: { code: "unsupported_operation" } })
    }

    // The whole write-bootstrap sequence the live run failed after: probe,
    // context, discovery report — none of them may enter the capture.
    assert.equal(discoveryResponse(store, { method: "GET", path: "/core/health", headers: { authorization: "Bearer eval-token" } }, { context }).status, 200)
    assert.equal(discoveryResponse(store, { method: "POST", path: "/v1/context", headers: { authorization: "Bearer eval-token" }, body: { user_id: "eval", session_id: context.session, agent: "build" } }, { context }).status, 200)
    assert.equal(discoveryResponse(store, { method: "POST", path: "/records/v1/plugins.report", headers: { authorization: "Bearer eval-token", "x-mem-space-id": "eval-space-personal" }, body: { layout: true, full: true, plugins: [] } }, { context }).status, 200)
    assert.deepEqual(store.capture().requests, before)

    // The sealed write itself (the arm records client's request to
    // /records/v1/records.put with the turn's session) lands exactly as
    // MEM-RT01 expects, and is the only capture entry.
    const write = discoveryResponse(store, {
      method: "POST",
      path: "/records/v1/records.put",
      headers: { authorization: "Bearer eval-token", "x-mem-space-id": "eval-space-personal", "x-tdai-session-id": context.session },
      body: s.backend.input,
    }, { context, invocation })
    assert.equal(write.status, 200)
    assert.equal(write.json.status, "stored")
    assert.equal(write.json.record.kind, "commitment")
    assert.equal(write.json.record.body, "Send the Quartz draft")
    assert.equal(store.capture().requests.length, before.length + 1)
    assert.equal(store.capture().requests.at(-1).method, "records.put")
  } finally {
    store.close()
  }
})
