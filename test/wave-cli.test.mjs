import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { main } from "../scripts/run-mem-wave.mjs"

test("executable refuses missing key without invoking any host adapter", async () => {
  await assert.rejects(main(["--manifest", "/not-read"], { env: {}, adapter: {} }), /OPENCODE_API_KEY/)
})

test("executable freezes input and supervises only one fresh worker with minimal env", async t => {
  const root = mkdtempSync(join(tmpdir(), "wave-cli-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const wave = { id: "test", control: join(root, "control"), store: join(root, "store"), docker_config: join(root, "docker"), runtime: { launcher_node: { path: "/fake-node" }, docker: { path: "/fake-docker" } }, trials: [{ id: "baseline-direct-a-r1", case: "a", arm: "baseline", condition: "direct", repetition: 1 }] }
  mkdirSync(wave.docker_config)
  const file = join(root, "input.json"), text = JSON.stringify(wave)
  writeFileSync(file, text)
  let activated = false, spec
  const adapter = { worker: value => { spec = value; return { pgid: 12345, exited: () => true, finished: () => false, activate: () => { activated = true } } }, alive: () => false, signal: () => assert.fail(), command: () => assert.fail("no resources"), unverified: () => [] }
  const result = await main(["--manifest", file], { env: { PATH: "/bin", OPENCODE_API_KEY: "synthetic-test-key", MALICIOUS_OVERRIDE: "x" }, adapter, identity: () => ({}), qualify: () => ({ wave, plan: { cases: [] }, execution_qualified: true }) })
  assert.equal(activated, true)
  assert.equal(spec.ipc, true)
  assert.equal(spec.env.MALICIOUS_OVERRIDE, undefined)
  assert.equal(spec.env.OPENCODE_API_KEY, "synthetic-test-key")
  assert.equal(spec.args.includes("synthetic-test-key"), false)
  assert.equal(readFileSync(join(wave.control, "manifest.json"), "utf8"), text)
  assert.equal(result.complete, false)
  wave.control = join(root, "blocked-control")
  writeFileSync(file, JSON.stringify(wave))
  const blocked = await main(["--manifest", file], { env: { OPENCODE_API_KEY: "synthetic-test-key" }, adapter: { ...adapter, worker: () => assert.fail("unqualified recorder must not start a worker") }, identity: () => ({}), qualify: () => ({ execution_qualified: false }) })
  assert.equal(blocked.stop_reason, "qualification-failed")
  assert.equal(blocked.complete, false)
})
