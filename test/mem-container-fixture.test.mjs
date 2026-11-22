// No listeners/processes: requests are values; launch/ready/stop are injected trace recorders.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, existsSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { openFixture } from "../worlds/mem/fixture.mjs"
import { fixtureResponse, SYNTHETIC_TOKEN } from "../worlds/mem/http.mjs"
import { stageMemFixture, startMemFixture, memCaptureRecord } from "../src/run/mem-fixture.mjs"

test("the closed synthetic HTTP codec routes records/wiki, rejects real targets and never forwards", () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-codec-"))
  try {
    const f = openFixture(dir)
    const ask = (path, body, headers = {}) => fixtureResponse(f, { method: "POST", path, body, headers: { authorization: `Bearer ${SYNTHETIC_TOKEN}`, ...headers } })
    assert.equal(ask("/records/v1/records.put", { record: { kind: "memory", type: "fact", body: "Quartz is green." } }).status, 200)
    assert.equal(ask("/records/v1/records.list", {}).body.records.length, 1)
    assert.equal(ask("/v3/wiki/raw/write", { wiki_id: "wiki-eval-personal", filename: "design.md", content: "Quartz." }).status, 200)
    assert.equal(ask("/records/v1/records.put", { record: { kind: "memory", body: "leak" } }, { "x-mem-space-id": "real-space" }).status, 403)
    assert.equal(ask("https://production.example/records/v1/records.put", {}).status, 400)
    assert.equal(ask("/v3/wiki/versions", {}).status, 501)
    assert.equal(ask("/records/v1/records.list", {}, { authorization: "Bearer unrelated" }).status, 401)
    assert.equal(f.snapshot().after.personal.records.length, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("capture refuses an ancestor link after removal instead of following it outside the sandbox", async () => {
  const root=mkdtempSync(join(tmpdir(),"mem-capture-link-")),outside=mkdtempSync(join(tmpdir(),"mem-capture-outside-"))
  try {
    const spec=stageMemFixture({root,tmp:join(root,"tmp")})
    openFixture(outside).call("records.put",{record:{kind:"memory",body:"outside"}})
    rmSync(spec.root,{recursive:true,force:true});symlinkSync(outside,spec.root)
    await assert.rejects(memCaptureRecord(spec,{gone:async()=>true}),/unsafe|link/)
  } finally {rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true})}
})

test("fixture lifecycle stages data only, wraps execution only for a container, captures only after confirmed removal", async () => {
  const root = mkdtempSync(join(tmpdir(), "mem-lifecycle-"))
  try {
    const sandbox = { root, tmp: join(root, "tmp") }
    const spec = stageMemFixture(sandbox)
    assert.equal(existsSync(spec.entry), true)
    assert.equal(existsSync(join(spec.root, "capture.json")), false, "staging starts no server or backend")
    const events = [], proc = { id: "injected-handle" }
    const trial = { wrap: (s) => { events.push(["wrap", s]); return s }, ready: async () => ({ ok: true }), gone: async () => false }
    const start = (isolation) => startMemFixture({ spec, trial, isolation, binary: "/opt/evals/bin/bun", launch: (s) => { events.push(["launch", s]); return proc }, stop: async (p) => events.push(["stop", p]) })
    await assert.rejects(start({ name: "none", confines: false }), /container/)
    assert.equal(events.length, 0)
    const running = await start({ name: "container", confines: true })
    assert.equal(events[1][1].command, "/opt/evals/bin/bun")
    assert.equal(events[1][1].env.EVALS_MEM_CONTAINED, "mem-synthetic-v1")
    assert.equal(events[1][1].args[0], spec.entry)
    assert.equal(Object.hasOwn(events[1][1].env, "OPENCODE_API_KEY"), false)
    await assert.rejects(memCaptureRecord(spec, trial), /still present|unverified/)
    const f = openFixture(spec.root)
    f.call("records.put", { record: { kind: "memory", body: "Quartz." } })
    const record = await memCaptureRecord(spec, { gone: async () => true })
    assert.equal(record.path, "mem-fixture/capture.json")
    assert.equal(JSON.parse(record.text).after.personal.records.length, 1)
    await running.stop()
    assert.equal(events.at(-1)[0], "stop")
    assert.match(readFileSync(spec.entry, "utf8"), /container only/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
