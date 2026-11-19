// G0 review 4.1: the evals profile starts its own service on its own port, without clashing with the owner's real one.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:net"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { EVALS_PORT, REAL_DEFAULT_PORT, portIsFree, getServicePort, realServicePort, ensureServicePort, assertDistinctPort } from "../src/run/service-port.mjs"
import { checkReal } from "../scripts/profile/check-real.mjs"
import { keepOnce, REFRESH_WINDOW_MS } from "../scripts/profile/keeper.mjs"

const listen = (port) => new Promise((resolve, reject) => {
  const server = createServer()
  server.once("error", reject)
  server.listen(port, "127.0.0.1", () => resolve(server))
})
const close = (server) => new Promise((resolve) => server.close(resolve))

/** A stand-in `opencode service ...`: ports per HOME, so the real and the profile's environments answer differently. */
function service({ ports = {}, running = {} } = {}) {
  const calls = []
  const exec = (command, args, { env }) => {
    calls.push({ home: env.HOME, args: args.join(" ") })
    if (args[0] === "service" && args[1] === "get" && args[2] === "port") return ports[env.HOME] ? { code: 0, stdout: `${ports[env.HOME]}\n`, stderr: "" } : { code: 0, stdout: "", stderr: "" }
    if (args[0] === "service" && args[1] === "set" && args[2] === "port") {
      ports[env.HOME] = Number(args[3])
      return { code: 0, stdout: "", stderr: "" }
    }
    if (args[0] === "service" && args[1] === "status") return { code: 0, stdout: running[env.HOME] ? "running\n" : "stopped\n", stderr: "" }
    return { code: 1, stdout: "", stderr: "unexpected" }
  }
  return { exec, calls, ports }
}
const REAL = { HOME: "/real", PATH: "/usr/bin" }
const MINE = { HOME: "/evals", PATH: "/usr/bin" }

test("a free 47950 is the profile's port, and the real service's port is never it", () => {
  const s = service({ ports: { "/real": 49374 } })
  const out = ensureServicePort({ opencode: "oc", profileEnv: MINE, realEnv: REAL, exec: s.exec, isFree: () => true, env: {} })
  assert.deepEqual(out, { port: EVALS_PORT, real: 49374, changed: true })
  assert.equal(s.ports["/evals"], 47950)
  assert.equal(s.calls.filter((c) => /service set/.test(c.args)).every((c) => c.home === "/evals"), true, "only the profile's own configuration is written")
  assert.equal(s.ports["/real"], 49374, "the real service's configuration is never touched")
})

test("a busy 47950 gives the next free port; one already set and free is kept; one equal to the real service's is replaced", () => {
  const busy = new Set([47950, 47951])
  const s = service({ ports: { "/real": 49374 } })
  assert.equal(ensureServicePort({ opencode: "oc", profileEnv: MINE, realEnv: REAL, exec: s.exec, isFree: (p) => !busy.has(p), env: {} }).port, 47952)
  assert.deepEqual(ensureServicePort({ opencode: "oc", profileEnv: MINE, realEnv: REAL, exec: s.exec, isFree: () => true, env: {} }), { port: 47952, real: 49374, changed: false }, "second call: kept")
  const same = service({ ports: { "/real": 47950, "/evals": 47950 } })
  const moved = ensureServicePort({ opencode: "oc", profileEnv: MINE, realEnv: REAL, exec: same.exec, isFree: () => true, env: {} })
  assert.equal(moved.port, 47951, "the real service holds 47950, so the profile moves off it")
  assert.equal(same.ports["/real"], 47950)
  // a port the profile's own running service holds is its own, though busy
  const mine = service({ ports: { "/real": 49374, "/evals": 47960 }, running: { "/evals": true } })
  assert.equal(ensureServicePort({ opencode: "oc", profileEnv: MINE, realEnv: REAL, exec: mine.exec, isFree: () => false, env: {} }).changed, false)
  assert.throws(() => ensureServicePort({ opencode: "oc", profileEnv: MINE, realEnv: REAL, exec: service().exec, isFree: () => false, env: {} }), /no free port from 47950 to 47999/)
})

test("when the real service's port cannot be read, EVALS_REAL_SERVICE_PORT or the host's default stands in for it", () => {
  const none = service()
  assert.equal(realServicePort({ opencode: "oc", realEnv: REAL, exec: none.exec, env: {} }), REAL_DEFAULT_PORT)
  assert.equal(realServicePort({ opencode: "oc", realEnv: REAL, exec: none.exec, env: { EVALS_REAL_SERVICE_PORT: "50000" } }), 50000)
  assert.equal(getServicePort({ opencode: "oc", env: REAL, exec: () => ({ code: 1, stdout: "47950", stderr: "" }) }), null)
  assert.equal(getServicePort({ opencode: "oc", env: REAL, exec: () => ({ code: 0, stdout: "banana", stderr: "" }) }), null)
})

test("the profile's port is really tried against the kernel: a listening port is not free", async () => {
  const server = await listen(0)
  const port = server.address().port
  try {
    assert.equal(portIsFree(port), false)
  } finally {
    await close(server)
  }
  assert.equal(portIsFree(port), true)
  // and with 47950 genuinely taken, the profile gets another
  let taken = null
  try {
    taken = await listen(47950)
  } catch {
    // something else holds 47950 already: the same claim
  }
  try {
    const s = service({ ports: { "/real": 49374 } })
    const out = ensureServicePort({ opencode: "oc", profileEnv: MINE, realEnv: REAL, exec: s.exec, env: {} })
    assert.notEqual(out.port, 47950)
    assert.ok(out.port > 47950 && out.port < 48000)
  } finally {
    if (taken) await close(taken)
  }
})

test("check-real and the keeper refuse a profile on the real service's port, or on none", () => {
  const same = service({ ports: { "/real": 47950, "/evals": 47950 } })
  assert.throws(() => assertDistinctPort({ opencode: "oc", profileEnv: MINE, realEnv: REAL, exec: same.exec, env: {} }), /is the real service's/)
  assert.throws(() => assertDistinctPort({ opencode: "oc", profileEnv: MINE, realEnv: REAL, exec: service({ ports: { "/real": 49374 } }).exec, env: {} }), /no service port of its own/)
  assert.equal(assertDistinctPort({ opencode: "oc", profileEnv: MINE, realEnv: REAL, exec: service({ ports: { "/real": 49374, "/evals": 47950 } }).exec, env: {} }), 47950)
  const exported = JSON.stringify([{ integrationID: "linear", active: true, value: { type: "oauth", access: "a-token-00000001", refresh: "r-token-00000001" } }])
  const base = (s) => (command, args, o) => (args[0] === "service" ? s.exec(command, args, o) : args[0] === "api" ? { code: 0, stdout: "{}", stderr: "" } : { code: 0, stdout: exported, stderr: "" })
  const env = { EVALS_REAL_HOME: "/real", PATH: "/usr/bin" }
  const out = checkReal({ integration: "linear", profile: "/evals", exec: base(same), env })
  assert.equal(out.ok, false)
  assert.match(out.line, /^FAIL linear: the evals profile's service port \(47950\) is the real service's/)
  assert.throws(() => keepOnce({ profile: "/evals", exec: base(same), env }), /is the real service's/)
})

test("the keeper sees a token that was due and did not move, and one that was refreshed", () => {
  const now = 1_800_000_000_000
  const ports = { "/real": 49374, "/evals": 47950 }
  const run = (expiries) => {
    const s = service({ ports })
    let exports = 0
    const exec = (command, args, o) => {
      if (args[0] === "service") return s.exec(command, args, o)
      if (args[0] === "api") return { code: 0, stdout: "{}", stderr: "" }
      const expires = expiries[Math.min(exports++, expiries.length - 1)]
      return { code: 0, stdout: JSON.stringify([{ integrationID: args[2], active: true, value: { type: "oauth", access: "a-token-00000001", refresh: "r-token-00000001", expires } }]), stderr: "" }
    }
    return keepOnce({ profile: "/evals", exec, env: { EVALS_REAL_HOME: "/real", PATH: "/usr/bin" }, only: ["linear"], now })
  }
  const due = now + REFRESH_WINDOW_MS - 1000
  assert.deepEqual(run([due, due + 3_600_000]), [{ integration: "linear", ok: true, due: true, refreshed: true }])
  const stuck = run([due, due])
  assert.equal(stuck[0].ok, false)
  assert.match(stuck[0].why, /did not refresh it/)
  assert.deepEqual(run([now + 3_600_000, now + 3_600_000]), [{ integration: "linear", ok: true }], "a token with time left need not move")
})

test("evals-profile.sh sets the profile's own port before it runs anything, and never touches the real service's", () => {
  const root = mkdtempSync(join(tmpdir(), "evals-port-sh-"))
  try {
    const bin = join(root, "bin")
    mkdirSync(bin)
    const real = join(root, "real")
    mkdirSync(real)
    // A stand-in `opencode` that keeps its service port in $HOME/port, like the real one keeps it in the profile's config.
    writeFileSync(join(bin, "opencode"), `#!/bin/sh
if [ "$1" = "service" ] && [ "$2" = "get" ]; then cat "$HOME/port" 2>/dev/null; exit 0; fi
if [ "$1" = "service" ] && [ "$2" = "set" ]; then echo "$4" > "$HOME/port"; exit 0; fi
if [ "$1" = "service" ] && [ "$2" = "status" ]; then echo stopped; exit 0; fi
exit 1
`)
    chmodSync(join(bin, "opencode"), 0o755)
    writeFileSync(join(real, "port"), "49374\n")
    const profile = join(root, "profile")
    const env = { PATH: `${bin}:${process.env.PATH}`, HOME: real, OPENCODE_BIN: join(bin, "opencode"), EVALS_PROFILE: profile, EVALS_STORE: join(root, "store") }
    const script = join(import.meta.dirname, "..", "scripts", "profile", "evals-profile.sh")
    const out = spawnSync("bash", [script, "--", "sh", "-c", 'cat "$HOME/port"'], { env, encoding: "utf8" })
    assert.equal(out.status, 0, out.stderr)
    const port = Number(out.stdout.trim())
    assert.ok(port >= 47950 && port < 48000, `the profile's port is ${port}`)
    assert.equal(readFileSync(join(real, "port"), "utf8").trim(), "49374", "the real service's port is untouched")
    assert.match(out.stderr, /service port \d+ \(set\); the real service is on 49374/)
    const again = spawnSync("bash", [script, "--", "sh", "-c", 'cat "$HOME/port"'], { env, encoding: "utf8" })
    assert.equal(Number(again.stdout.trim()), port, "a second run keeps it")
    assert.doesNotMatch(again.stderr, /\(set\)/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
