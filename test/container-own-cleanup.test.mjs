import { test } from "node:test"
import assert from "node:assert/strict"
import { containerConfig, containerBackend } from "../src/run/container.mjs"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

test("container cleanup scope is opt-in and rejects invalid enum values", () => {
  assert.equal(containerConfig({ env: {} }).sweepScope, "legacy")
  assert.equal(containerConfig({ env: { EVALS_CONTAINER_SWEEP_SCOPE: "own" } }).sweepScope, "own")
  for (const value of ["", "all", "OWN", "own "]) {
    assert.throws(() => containerConfig({ env: { EVALS_CONTAINER_SWEEP_SCOPE: value } }), /SWEEP_SCOPE/)
  }
})

test("own creation receipts are persisted for an external watchdog, including an interrupted prepare", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "own-journal-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, "resources.json"), fake = fakeDocker()
  let release, started
  const waiting = new Promise(resolve => { started = resolve })
  const backend = containerBackend(containerConfig({ env: { EVALS_CONTAINER_SWEEP_SCOPE: "own", EVALS_CONTAINER_OWNERSHIP: file, EVALS_DOCKER: process.execPath } }), {
    exec: async (bin, args, opts) => {
      if (args[0] === "run") {
        started()
        await new Promise(resolve => { release = resolve })
      }
      return fake.exec(bin, args, opts)
    },
  })
  const preparing = backend.prepare({ batchRoot: root, caller: {} })
  await waiting
  const pending = JSON.parse(readFileSync(file, "utf8"))
  assert.equal(pending.resources.length, 1)
  assert.equal(pending.pending.length, 1)
  await backend.teardown()
  release()
  await assert.rejects(preparing, /teardown/)
  assert.equal(fake.owned.size, 0)
  assert.equal(await backend.allGone(), true)
  assert.equal(JSON.parse(readFileSync(file, "utf8")).resources.length, 2)
})

function fakeDocker() {
  let next = 0
  const calls = [], owned = new Map()
  const foreign = ["foreign-live", "foreign-dead", "foreign-missing-pid", "forged-batch-label"]
  const exec = async (_binary, args) => {
    calls.push(args)
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" })
    if (args[0] === "version") return ok("28.0.0")
    if (args[0] === "image") return ok("sha256:pinned-test-image")
    if (args[0] === "logs") return ok('{"ev":"listening"}')
    if (args[0] === "run" || args[0] === "network" && args[1] === "create") {
      const id = (++next).toString(16).padStart(64, "0")
      owned.set(id, args[0] === "run" ? "container" : "network")
      return ok(id)
    }
    if (args[0] === "ps" || args[0] === "network" && args[1] === "ls") {
      return ok(foreign.map((id, i) => `${id}\t${i === 3 ? f.batch : "other"}\t${i === 0 ? process.pid : "0"}\t`).join("\n"))
    }
    if (args[0] === "rm" || args[0] === "network" && args[1] === "rm") owned.delete(args.at(-1))
    if (args[0] === "inspect" || args[0] === "network" && args[1] === "inspect") {
      return owned.has(args.at(-1)) ? ok(args.at(-1)) : { code: 1, stdout: "", stderr: "No such object" }
    }
    return ok()
  }
  const f = { exec, calls, owned, foreign, batch: "" }
  return f
}

test("own prepare and teardown preserve foreign live/dead/missing-PID and forged-label resources", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "own-cleanup-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fake = fakeDocker()
  const backend = containerBackend(containerConfig({ env: { EVALS_CONTAINER_SWEEP_SCOPE: "own", EVALS_DOCKER: process.execPath } }), { exec: fake.exec })
  fake.batch = backend.batchLabel
  assert.deepEqual(await backend.sweep(), { containers: 0, networks: 0, dirs: 0 })
  await backend.prepare({ batchRoot: root, caller: { PATH: process.env.PATH } })
  assert.equal(fake.calls.some(a => a[0] === "rm" || a[0] === "network" && a[1] === "rm"), false)
  const ids = [...fake.owned.keys()]
  assert.equal(ids.length, 2)
  await backend.sweep({ tmpRoot: root })
  assert.equal(fake.owned.size, 2, "explicit sweep must not reclaim anything in own mode")
  await backend.teardown()
  const removed = fake.calls.filter(a => a[0] === "rm" || a[0] === "network" && a[1] === "rm").map(a => a.at(-1))
  assert.deepEqual(removed.sort(), ids.sort())
  assert.equal(await backend.allGone(), true)
})

test("failed prepare removes only established IDs and reports uncertain creations", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "own-failed-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const throws of [true, false]) {
    const fake = fakeDocker()
    const backend = containerBackend(containerConfig({ env: { EVALS_CONTAINER_SWEEP_SCOPE: "own", EVALS_DOCKER: process.execPath } }), {
      exec: async (bin, args, opts) => {
        if (args[0] === "run") {
          if (throws) throw new Error("lost creation reply")
          return { code: 1, stdout: "", stderr: "failed creation" }
        }
        return fake.exec(bin, args, opts)
      },
    })
    await assert.rejects(backend.prepare({ batchRoot: root, caller: {} }), /creation/)
    const ids = [...fake.owned.keys()]
    await backend.teardown()
    assert.deepEqual(fake.calls.filter(a => a[0] === "rm" || a[0] === "network" && a[1] === "rm").map(a => a.at(-1)), ids)
    assert.equal(await backend.allGone(), false, "a missing receipt must not become proof of absence")
  }
})
