// Existing lookup controls start after deployment. Model only the new warm-up
// child here; keep their original lookup children, schedules and assertions.
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createDarwinIdentityReader } from "../../src/run/darwin-process-identity.mjs"

export function createWarmedDarwinIdentityReader(pins, deps) {
  let warmup
  const owner = createDarwinIdentityReader(pins, { ...deps, spawn(file, args, options) {
    if (args[0] !== "0") return deps.spawn(file, args, options)
    assert.equal(warmup, undefined, "one construction warm-up")
    assert.equal(file, pins.helper.path)
    assert.deepEqual(args, ["0"])
    assert.deepEqual(options, { cwd: pins.cwd, env: {}, shell: false, detached: false, stdio: ["ignore", "pipe", "ignore"] })
    warmup = new EventEmitter(); warmup.pid = 800; warmup.stdout = new EventEmitter()
    return warmup
  } })
  assert.ok(warmup)
  assert.equal(owner.available(), false)
  assert.equal(owner.closed(), false)
  warmup.emit("exit", 64, null); warmup.emit("close", 64, null)
  assert.equal(owner.available(), true)
  assert.equal(owner.closed(), true)
  return owner
}
