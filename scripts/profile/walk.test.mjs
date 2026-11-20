// node --test ~/evals-232/bin/walk.test.mjs
// The walk's real-profile rules: every opencode call made with the owner's HOME carries `--server http://127.0.0.1:4096` and the password only in
// OPENCODE_SERVER_PASSWORD; the guard refuses while a real background service runs or anything listens on its port. A stub `opencode` records each call.
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync, spawn } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, chownSync, chmodSync, lstatSync, openSync, closeSync, unlinkSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { IDENTITY, IDENTITY_INPUT, IDENTITY_ACTION, IDENTITY_INNER, IDENTITY_EXPECT, judgeAnswer, errorSignal, shapeProblem, identityCheck, rpcFailure, realServiceProblem, realServerPassword, realServerUrl, refreshChain, recordBaseline, profileConfig, loadPins, WALK_ORDER, appClientEntry, activeCredential as activeCredentialOf } from "./profile-lib.mjs"
import { keepOnce } from "./keeper.mjs"
import { createHash, randomBytes } from "node:crypto"
import { statSync } from "node:fs"

const HERE = dirname(fileURLToPath(import.meta.url))
const SECRET = "pw-SECRET-for-test-0123456789"
const WEB = "http://127.0.0.1:4096"

// The answers the real tools RPC gives (shapes: probe from each plugin's describe; ashby's get_pending_tasks seen live on 20 Nov; gws read from describe;
// elevenlabs/wisprflow as their tools' schemas declare). A credential-only `probe` result has the PROBE shape and carries none of the others' fields.
const PROBE_ANSWER = { output: { source: "x", account: "acct", owner: { id: "mailto:a@b.c", label: "A" }, trust: { accountOwnedBy: "owner" } } }
const ANSWERS = {
  "ashby.recruiting.tools/get_pending_tasks": { output: { output: { data: { scorecardTasks: [], approvalTasks: [], sequenceTasks: [], surveyTasks: [], mentionTasks: [], followUpTasks: [], textingTasks: [], reviewTasks: [], totalCount: 0 } }, text: "{}" } },
  "google-workspace.gws.tools/read": { output: { ok: true, operation: "gmail.users.getProfile", category: "read", data: { emailAddress: "a@b.c" }, truncated: false, diagnostics: { exitCode: 0, durationMs: 1, bytes: 10 }, trust: { workspaceContent: "untrusted" } } },
  "elevenlabs.tools/creative_list_voices": { output: { output: { voices: [{ voice_id: "v1", name: "Voice" }], total_count: 1 }, text: "1 voice" } },
  "slack.workspace.tools/slack_read_user_profile": { output: { output: { result: "joe (joe)\nOrg\nTitle\njoe@example.com\nStatus: " }, text: "{\"result\":\"joe\"}" } },
  "wisprflow.meetings.tools/list_folders": { output: { output: { folders: [{ id: "f1", name: "F" }] }, text: "1 folder" } },
}

function rig() {
  const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "walk-"))
  const realHome = join(root, "real")
  const profile = join(root, "profile")
  const store = join(root, "store")
  for (const d of [realHome, profile, store, join(realHome, ".config", "opencode-web"), join(profile, ".config", "opencode")]) mkdirSync(d, { recursive: true })
  writeFileSync(join(profile, ".config", "opencode", "service.json"), JSON.stringify({ port: 47950 }))
  writeFileSync(join(realHome, ".config", "opencode-web", "server.env"), `OPENCODE_API_KEY=x\nOPENCODE_PASSWORD=${SECRET}\n`)
  const log = join(root, "calls.jsonl")
  const stub = join(root, "opencode")
  writeFileSync(stub, `#!${process.execPath}
const fs = require("fs")
const a = process.argv.slice(2)
const real = process.env.HOME === ${JSON.stringify(realHome)}
const at = a.indexOf("--server")
const server = at >= 0 ? a[at + 1] : null
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ a, real, server, hasPw: Boolean(process.env.OPENCODE_SERVER_PASSWORD), pwInArgv: a.some((x) => x.includes(${JSON.stringify(SECRET)})) }) + "\\n")
if (real && server !== ${JSON.stringify(WEB)}) { console.error("STUB: a real-env call without --server " + ${JSON.stringify(WEB)}); process.exit(97) }
if (a[0] === "service" && a[1] === "get") { console.log("47950"); process.exit(0) }
const fx = (side, id) => ${JSON.stringify(root)} + "/" + side + "-" + id + ".json"
if (a[0] === "auth" && a[1] === "export" && real && process.env.STUB_FAIL_REAL_EXPORT) { console.error("STUB: the web server is not reachable"); process.exit(5) }
if (a[0] === "auth" && a[1] === "export" && a[2] && fs.existsSync(fx(real ? "real" : "evals", a[2]))) { console.log(fs.readFileSync(fx(real ? "real" : "evals", a[2]), "utf8")); process.exit(0) }
if (a[0] === "auth" && a[1] === "export" && /-app$|^gws-default$/.test(a[2])) { const f = fx(real ? "real" : "evals", a[2]); console.log(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "[]"); process.exit(0) }
if (a[0] === "auth" && a[1] === "import") { const input = fs.readFileSync(0, "utf8"); fs.writeFileSync(${JSON.stringify(root)} + "/import-stdin.json", input); for (const c of JSON.parse(input)) fs.writeFileSync(fx("evals", c.integrationID), input); process.exit(0) }
if (a[0] === "auth" && a[1] === "export") { console.log(JSON.stringify([{ integrationID: a[2], active: true, value: { access: real ? "REAL-ACCESS" : "EVALS-ACCESS" } }])); process.exit(0) }
if (a[0] === "api") {
  const flag = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null }
  const path = a[2] || ""
  if (a[1] === "post" && path === "/api/session") { fs.appendFileSync(${JSON.stringify(root)} + "/created.log", "ses_stub0001\\n"); fs.writeFileSync(${JSON.stringify(root)} + "/perms.json", JSON.stringify((JSON.parse(flag("-d")) || {}).permissions || null)); fs.appendFileSync(${JSON.stringify(root)} + "/perms.log", JSON.stringify((JSON.parse(flag("-d")) || {}).permissions || null) + "\\n"); console.log(JSON.stringify({ data: { id: "ses_stub0001", agent: "build" } })); process.exit(0) }
  if (a[1] === "delete" && path.startsWith("/api/session/ses_")) { fs.appendFileSync(${JSON.stringify(root)} + "/deleted.log", path + "\\n"); process.exit(process.env.STUB_FAIL_DELETE ? 1 : 0) }
  const parts = path.split("/")
  if (a[1] === "post" && parts.length === 5 && parts[1] === "api" && parts[2] === "rpc") {
    const err = (type, message) => { console.log(JSON.stringify({ _tag: "RpcError", type, message })); process.exit(1) }
    const ns = parts[3], method = parts[4]
    const methods = (JSON.parse(fs.readFileSync(${JSON.stringify(join(HERE, "rpc-methods.fixture.json"))}, "utf8")).methods[ns]) || []
    // A service that has just started: its plugins are still loading, and every evals route answers rpc.unavailable for a while.
    if (process.env.STUB_RPC_UNAVAILABLE && !real) {
      const seen = ${JSON.stringify(root)} + "/rpc-unavailable-seen"
      if (process.env.STUB_RPC_UNAVAILABLE !== "once" || !fs.existsSync(seen)) { fs.writeFileSync(seen, "1"); err("rpc.unavailable", "RPC is unavailable: " + ns) }
    }
    if (method !== "describe" && !methods.includes(method)) err("rpc.method_not_found", "Unknown RPC method: " + ns + "." + method)
    if (method === "describe") { console.log(JSON.stringify({ output: { methods: methods.map((name) => ({ name, action: ns.split(".")[0] + "_" + name, class: /^(create|delete|update|send|merge)/.test(name) ? "write" : "read" })) } })); process.exit(0) }
    // A read killed by its own timeout: the real side always, once, or the evals side always.
    const slow = () => { console.log(JSON.stringify({ _tag: "RpcError", type: "rpc.timeout", message: "the read timed out" })); process.exit(143) }
    if (real && process.env.STUB_RPC_TIMEOUT) slow()
    if (real && process.env.STUB_TIMEOUT_ONCE) { const seen = ${JSON.stringify(root)} + "/rpc-timeout-seen"; if (!fs.existsSync(seen)) { fs.writeFileSync(seen, "1"); slow() } }
    if (!real && process.env.STUB_TIMEOUT_EVALS) slow()
    if (real && process.env.STUB_RPC_401) err("rpc.tool_failed", "401 Unauthorized")
    let body = null
    try { body = JSON.parse(flag("-d") || flag("--data")) } catch {}
    if (!body || typeof body !== "object" || !body.input || typeof body.input.sessionID !== "string" || !body.input.sessionID.startsWith("ses_") || typeof body.input.input !== "object" || body.input.input === null) err("rpc.invalid_input", "the envelope must be an object, such as sessionID and input")
    if (!(flag("-H") || "").startsWith("x-opencode-directory:")) err("rpc.invalid_input", "no location")
    if (process.env.STUB_FAIL_RPC) err("rpc.tool_failed", "the vendor answered 500")
    let perms = null
    try { perms = JSON.parse(fs.readFileSync(${JSON.stringify(root)} + "/perms.json", "utf8")) } catch {}
    const allowedBy = (action) => { if (!perms) return true; let ok = false; for (const r of perms) if (r.action === "*" || r.action === action) ok = r.effect === "allow"; return ok }
    const own = ${JSON.stringify(IDENTITY_ACTION)}[Object.entries(${JSON.stringify(IDENTITY)}).find(([, route]) => route === ns + "/" + method)?.[0]]
    if (own && !allowedBy(own)) err("failed", "PERMISSION_DENIED: " + own + " was refused by a deny rule for this session's agent")
    if (process.env.STUB_GWS_MISSING && method === "read" && ns.startsWith("google-workspace") && !allowedBy("gws.native_install")) err("failed", "GWS_UNAVAILABLE: gws is not installed, and this call may not download it under this session's access. Next step: Run /gws-install, which downloads and verifies it.")
    if (process.env.STUB_INNER && !allowedBy(process.env.STUB_INNER)) err("failed", "PERMISSION_DENIED: " + (own || method) + " needs " + process.env.STUB_INNER + ", which a deny rule refuses for this session's agent: deny rule")
    const answers = ${JSON.stringify(ANSWERS)}
    console.log(process.env.STUB_ANSWER || JSON.stringify(answers[ns + "/" + method] || ${JSON.stringify(PROBE_ANSWER)})); process.exit(0)
  }
  console.log("{}"); process.exit(0)
}
process.exit(0)
`, { mode: 0o700 })
  const env = { ...process.env, HOME: realHome, EVALS_REAL_HOME: realHome, EVALS_STORE: store, EVALS_PROFILE: profile, OPENCODE_BIN: stub, EVALS_REAL_SERVICE_PORT: "49999" }
  delete env.EVALS_REAL_SERVER
  delete env.EVALS_REAL_SERVER_ENV
  const calls = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  return { root, realHome, env, calls, done: () => rmSync(root, { recursive: true, force: true }) }
}

const fakeProc = (root, procs, listening = []) => {
  const p = join(root, "proc")
  for (const [pid, { argv, home }] of Object.entries(procs)) {
    mkdirSync(join(p, pid), { recursive: true })
    writeFileSync(join(p, pid, "cmdline"), argv.join("\0") + "\0")
    writeFileSync(join(p, pid, "environ"), `PATH=/bin\0HOME=${home}\0`)
  }
  mkdirSync(join(p, "net"), { recursive: true })
  writeFileSync(join(p, "net", "tcp"), "  sl  local_address rem_address   st\n" + listening.map((port, i) => `   ${i}: 0100007F:${port.toString(16).toUpperCase().padStart(4, "0")} 00000000:0000 0A 0 0\n`).join(""))
  return p
}

test("check-real: every real-env call carries --server <web server>, with the password in env only", () => {
  const r = rig()
  try {
    const out = spawnSync(process.execPath, [join(HERE, "check-real.mjs"), "linear"], { env: r.env, encoding: "utf8" })
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stdout, /^PASS linear/)
    const calls = r.calls()
    const real = calls.filter((c) => c.real)
    assert.deepEqual(real.map((c) => c.a.slice(0, 3).join(" ")).map((x) => x.replace(/ses_\w+/, "ses")), ["api post /api/session", "api post /api/rpc/linear.workspace.tools/probe", "api delete /api/session/ses", "auth export linear"], "a check session, the identity read (probe), the session deleted, one export")
    for (const c of real) {
      assert.equal(c.server, WEB, JSON.stringify(c.a))
      assert.ok(c.hasPw, "password in that call's env")
      assert.equal(c.pwInArgv, false)
    }
    for (const c of calls.filter((x) => !x.real)) assert.equal(c.server, null, "the evals profile talks to its own service")
    assert.ok(!(out.stdout + out.stderr).includes(SECRET))
    assert.ok(!readFileSync(join(r.env.EVALS_STORE, "round-232.log"), "utf8").includes(SECRET))
  } finally {
    r.done()
  }
})

test("check-real: EVALS_REAL_SERVER and EVALS_REAL_SERVER_ENV override the URL and the password file", () => {
  const r = rig()
  try {
    const other = join(r.root, "other.env")
    writeFileSync(other, `OPENCODE_PASSWORD="quoted"\n`)
    const env = { ...r.env, EVALS_REAL_SERVER: "http://127.0.0.1:5000", EVALS_REAL_SERVER_ENV: other }
    assert.equal(realServerPassword(env), "quoted")
    const out = spawnSync(process.execPath, [join(HERE, "check-real.mjs"), "linear"], { env, encoding: "utf8" })
    assert.equal(out.status, 1, "the stub refuses a real-env call to another server")
    assert.ok(r.calls().some((c) => c.real && c.server === "http://127.0.0.1:5000"))
  } finally {
    r.done()
  }
})

test("guard: a real background service (owner's HOME) is refused; the evals service and the web server are not", () => {
  const r = rig()
  try {
    const bin = "/opt/opencode/bin/opencode"
    const env = { EVALS_REAL_HOME: r.realHome, EVALS_REAL_SERVICE_PORT: "49374" }
    const web = { argv: ["/usr/local/bin/opencode", "serve", "--hostname", "127.0.0.1", "--port", "4096"], home: r.realHome }
    const evals = { argv: [bin, "serve", "--service"], home: join(r.root, "profile") }
    assert.equal(realServiceProblem(env, { procRoot: fakeProc(r.root, { 10: web, 11: evals }, [4096, 47950]) }), null)
    const msg = realServiceProblem(env, { procRoot: fakeProc(r.root, { 10: web, 12: { argv: [bin, "serve", "--service"], home: r.realHome } }) })
    assert.match(msg, /real background service \(pid 12\)/)
    assert.match(msg, /opencode service stop/)
    assert.match(msg, /--from <vendor>/)
  } finally {
    r.done()
  }
})

test("guard: a listener on the real service's port is refused, by check-real and by guard-real", async () => {
  const r = rig()
  const server = spawn(process.execPath, ["-e", "require('node:net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port)})"], { stdio: ["ignore", "pipe", "inherit"] })
  try {
    const port = await new Promise((res) => server.stdout.once("data", (d) => res(Number(String(d).trim()))))
    const env = { ...r.env, EVALS_REAL_SERVICE_PORT: String(port) }
    const out = spawnSync(process.execPath, [join(HERE, "check-real.mjs"), "linear"], { env, encoding: "utf8" })
    assert.equal(out.status, 5)
    assert.match(out.stdout, /^FAIL linear: a listener on the real service's port/)
    const g = spawnSync(process.execPath, [join(HERE, "guard-real.mjs")], { env, encoding: "utf8" })
    assert.equal(g.status, 1)
    assert.match(g.stdout, /FAIL guard/)
    assert.equal(existsSync(join(r.root, "calls.jsonl")), false, "refused before any opencode call")
  } finally {
    server.kill()
    r.done()
  }
})

test("the profile config lists the pins beside the claude-agent deny", () => {
  const r = rig()
  try {
    const file = join(r.root, "pins.json")
    writeFileSync(file, JSON.stringify({ a: "github:o/opencode-a#v1", b: "github:o/opencode-b#v2" }))
    const list = loadPins({ EVALS_PLUGINS: file })
    assert.deepEqual(list, ["github:o/opencode-a#v1", "github:o/opencode-b#v2"])
    const config = profileConfig(list)
    assert.deepEqual(config.plugins, list)
    assert.equal(config.policies[0].resource, "claude-agent")
    assert.throws(() => loadPins({ EVALS_PLUGINS: join(r.root, "none.json") }), /missing/)
  } finally {
    r.done()
  }
})

// ---- the app-client steps: slack-app, x-app, gws-app --------------------------------------------------------------------------------------
const CLIENT_ID = "1234567890.1234567890"
const TOKEN = "xoxp-USER-TOKEN-must-not-travel-0123456789"
const realApp = (id, extra = {}) => JSON.stringify([{ id: "cred_real", integrationID: id, label: "App", active: true, value: { type: "key", key: CLIENT_ID, metadata: { client_secret: "cs-secret-value" }, refresh: TOKEN, access: TOKEN, ...extra } }])
const runCopy = (r, step, env = r.env) => spawnSync(process.execPath, [join(HERE, "copy-client.mjs"), step], { env, encoding: "utf8" })

test("walk order: each app client is its own step, before its vendor", () => {
  const i = (x) => WALK_ORDER.indexOf(x)
  assert.ok(i("slack-app") + 1 === i("slack") && i("x-app") + 1 === i("x") && i("gws-app") + 1 === i("gws"))
  const out = spawnSync(join(HERE, "signin.sh"), ["--list"], { env: { ...process.env, EVALS_STORE: mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "walk-")) }, encoding: "utf8" })
  assert.match(out.stdout, /slack-app\s+not yet/)
  assert.match(out.stdout, /x-app\s+not yet/)
  assert.match(out.stdout, /gws-app\s+not yet/)
})

for (const id of ["slack-app", "x-app"]) {
  test(`${id}: the client entry (client id and secret) is imported into the evals profile, with no user token, through --server`, () => {
    const r = rig()
    try {
      writeFileSync(join(r.root, `real-${id}.json`), realApp(id))
      const out = runCopy(r, id)
      assert.equal(out.status, 0, out.stdout + out.stderr)
      assert.match(out.stdout, new RegExp(`^PASS ${id}: the app client was copied`))
      const imported = readFileSync(join(r.root, "import-stdin.json"), "utf8")
      assert.ok(!imported.includes(TOKEN), "no user token travels")
      assert.deepEqual(Object.keys(JSON.parse(imported)[0].value).sort(), ["key", "metadata", "type"])
      for (const c of r.calls().filter((x) => x.real)) assert.equal(c.server, WEB)
      assert.ok(!(out.stdout + out.stderr).includes(CLIENT_ID) && !(out.stdout + out.stderr).includes("cs-secret-value") && !(out.stdout + out.stderr).includes(SECRET))
      const again = runCopy(r, id)
      assert.match(again.stdout, /already in the evals profile, client id matches/)
    } finally {
      r.done()
    }
  })
}

test("slack-app: an evals entry with a different client id is never overwritten", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "real-slack-app.json"), realApp("slack-app"))
    writeFileSync(join(r.root, "evals-slack-app.json"), realApp("slack-app").replace(CLIENT_ID, "9999.9999"))
    const out = runCopy(r, "slack-app")
    assert.equal(out.status, 1)
    assert.match(out.stdout, /different client id: nothing was overwritten/)
    assert.equal(existsSync(join(r.root, "import-stdin.json")), false)
  } finally {
    r.done()
  }
})

test("copy-client and the walk refuse while a real background service's port is listening", async () => {
  const r = rig()
  const server = spawn(process.execPath, ["-e", "require('node:net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port)})"], { stdio: ["ignore", "pipe", "inherit"] })
  try {
    const port = await new Promise((res) => server.stdout.once("data", (d) => res(Number(String(d).trim()))))
    writeFileSync(join(r.root, "real-slack-app.json"), realApp("slack-app"))
    const env = { ...r.env, EVALS_REAL_SERVICE_PORT: String(port), EVALS_BIN: HERE }
    assert.match(runCopy(r, "slack-app", env).stdout, /^FAIL slack-app: a listener on the real service's port/)
    const walk = spawnSync(join(HERE, "signin.sh"), ["--only", "slack-app", "--yes"], { env, encoding: "utf8" })
    assert.equal(walk.status, 1)
    assert.match(walk.stdout, /STOP before slack-app/)
    assert.equal(existsSync(join(r.root, "calls.jsonl")), false)
  } finally {
    server.kill()
    r.done()
  }
})

test("walk: a missing real client stops before x-app with the exact command, and what the owner is asked for", () => {
  const r = rig()
  try {
    const out = spawnSync(join(HERE, "signin.sh"), ["--only", "x-app", "--yes"], { env: { ...r.env, EVALS_BIN: HERE }, encoding: "utf8" })
    assert.equal(out.status, 1, out.stdout)
    assert.match(out.stdout, /STOP at x-app\. Run: \S*evals-profile\.sh -- \S+ auth login x-app/)
    assert.match(out.stdout, /client ID.*Client secret/s)
    assert.match(out.stdout, /--from x-app/)
    assert.doesNotMatch(readFileSync(join(r.env.EVALS_STORE, "signin-passed"), "utf8"), /x-app/)
  } finally {
    r.done()
  }
})

test("gws-app: the real Desktop client (not its tokens) becomes the gws plugin's oauthClient option, in a 600 file", () => {
  const r = rig()
  try {
    const cred = [{ id: "c", integrationID: "gws-default", label: "me", active: true, value: { type: "oauth", refresh: TOKEN, access: TOKEN, metadata: { clientId: "abc.apps.googleusercontent.com", clientSecret: "GOCSPX-clientsecret-0123456789", clientSource: "pasted", requestedScopes: [] } } }]
    writeFileSync(join(r.root, "real-gws-default.json"), JSON.stringify(cred))
    const out = runCopy(r, "gws-app")
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stdout, /^PASS gws-app/)
    const file = join(r.env.EVALS_STORE, "evals-gws-client.json")
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8"))).sort(), ["clientId", "clientSecret"])
    assert.ok(!readFileSync(file, "utf8").includes(TOKEN))
    assert.ok(!(out.stdout + out.stderr).includes("GOCSPX") && !out.stdout.includes("abc.apps"))
    const pins = join(r.root, "pins.json")
    writeFileSync(pins, JSON.stringify({ gws: "github:o/opencode-gws#v0.0.10", slack: "github:o/opencode-slack#v1" }))
    const list = loadPins({ EVALS_PLUGINS: pins, EVALS_STORE: r.env.EVALS_STORE })
    assert.deepEqual(list[0], { package: "github:o/opencode-gws#v0.0.10", options: { oauthClient: { clientId: "abc.apps.googleusercontent.com", clientSecret: "GOCSPX-clientsecret-0123456789" } } })
    assert.equal(list[1], "github:o/opencode-slack#v1")
    assert.ok(createHash("sha256").update(JSON.stringify(list)).digest("hex"))
  } finally {
    r.done()
  }
})

test("gws-app: a Web client (with redirect URIs) is not copied: SKIPPED", () => {
  const r = rig()
  try {
    const cred = [{ id: "c", integrationID: "gws-default", label: "me", active: true, value: { type: "oauth", refresh: TOKEN, access: TOKEN, metadata: { clientId: "abc.apps.googleusercontent.com", clientSecret: "GOCSPX-web-0123456789", clientRedirectUris: ["https://h.example/oauth/return"], clientSource: "pasted" } } }]
    writeFileSync(join(r.root, "real-gws-default.json"), JSON.stringify(cred))
    const out = runCopy(r, "gws-app")
    assert.equal(out.status, 3, "skipped: the form will ask")
    assert.match(out.stdout, /^SKIPPED gws-app:.*Web client, which is not copied/)
    assert.equal(existsSync(join(r.env.EVALS_STORE, "evals-gws-client.json")), false)
  } finally {
    r.done()
  }
})

test("slack-app: refuses when the evals profile has no service port of its own, or the real one", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "real-slack-app.json"), realApp("slack-app"))
    const file = join(r.root, "profile", ".config", "opencode", "service.json")
    writeFileSync(file, JSON.stringify({ port: 49999 }))
    assert.match(runCopy(r, "slack-app").stdout, /on the real service's port 49999: refusing/)
    rmSync(file)
    assert.match(runCopy(r, "slack-app").stdout, /own service port is not set/)
    assert.equal(existsSync(join(r.root, "calls.jsonl")) ? r.calls().filter((c) => !c.real).length : 0, 0, "no evals call was made")
  } finally {
    r.done()
  }
})

test("walk --list shows slack-app, x-app and gws-app as their own steps", () => {
  const out = spawnSync(join(HERE, "signin.sh"), ["--list"], { env: { ...process.env, EVALS_STORE: mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "walk-")) }, encoding: "utf8" })
  const names = out.stdout.split("\n").map((l) => l.trim().split(/\s+/)[1])
  assert.ok(names.indexOf("gws-app") + 1 === names.indexOf("gws") && names.indexOf("slack-app") + 1 === names.indexOf("slack") && names.indexOf("x-app") + 1 === names.indexOf("x"))
})

// ---- review round: real export shapes, the NOT_IN_REAL branch, printed fix lines, gws-app, arguments ------------------------------------------------
const cred = (integrationID, label, access, refresh) => JSON.stringify([{ id: "cred_x", integrationID, label, active: true, value: { type: "oauth", access, refresh } }])
const checkReal = (r, vendor, extra = {}) => spawnSync(process.execPath, [join(HERE, "check-real.mjs"), vendor], { env: { ...r.env, ...extra }, encoding: "utf8" })

test("check-real gws: exports gws-default and matches its integrationID (the credential is labelled `default`)", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "real-gws-default.json"), cred("gws-default", "default", "REAL-A", "REAL-R"))
    writeFileSync(join(r.root, "evals-gws-default.json"), cred("gws-default", "default", "EVALS-A", "EVALS-R"))
    const out = checkReal(r, "gws")
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stdout, /^PASS gws:/)
    const exports = r.calls().filter((c) => c.a[0] === "auth" && c.a[1] === "export")
    assert.ok(exports.length >= 2 && exports.every((c) => c.a[2] === "gws-default"), JSON.stringify(exports.map((c) => c.a)))
  } finally {
    r.done()
  }
})

test("check-real wisprflow: exports `Wispr Flow` and matches the label, normalised (the id is mcp_<hash>)", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "real-Wispr Flow.json"), cred("mcp_47716809b9e42913", "Wispr Flow", "REAL-A", "REAL-R"))
    writeFileSync(join(r.root, "evals-Wispr Flow.json"), cred("mcp_47716809b9e42913", "wispr flow", "EVALS-A", "EVALS-R"))
    const out = checkReal(r, "wisprflow")
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stdout, /^PASS wisprflow:/)
    assert.ok(r.calls().filter((c) => c.a[1] === "export").every((c) => c.a[2] === "Wispr Flow"))
    assert.equal(activeCredentialOf(cred("mcp_1", "Wispr Flow", "a", "b"), "wisprflow")?.integrationID, "mcp_1")
    assert.equal(activeCredentialOf(cred("gws-default", "default", "a", "b"), "gws"), null, "the walk key alone matches nothing: the export target is what is matched")
  } finally {
    r.done()
  }
})

test("check-real affinity: a FAILED real export is a FAIL, never `not in the real profile`", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "evals-affinity.json"), cred("affinity", "Affinity", "E-A", "E-R"))
    const out = checkReal(r, "affinity", { STUB_FAIL_REAL_EXPORT: "1" })
    assert.equal(out.status, 5, out.stdout)
    assert.match(out.stdout, /^FAIL affinity: could not read the real profile through the web server/)
    assert.doesNotMatch(out.stdout, /PASS/)
  } finally {
    r.done()
  }
})

test("check-real affinity: a successful real export with no credential takes the not-in-real path", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "real-affinity.json"), "[]")
    writeFileSync(join(r.root, "evals-affinity.json"), cred("affinity", "Affinity", "E-A", "E-R"))
    const out = checkReal(r, "affinity")
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stdout, /^PASS affinity: not in the real profile/)
  } finally {
    r.done()
  }
})

// A copy of the walk with a fake sign-in and a check-real that fails: nothing it prints may tell the owner to run a plain `opencode auth login`.
function failingWalk(r, vendor, extraEnv = {}) {
  const bin = join(r.root, "bin")
  mkdirSync(bin, { recursive: true })
  for (const f of ["signin.sh", "guard-real.mjs", "log-signin.mjs", "profile-lib.mjs", "copy-client.mjs", "identity-methods.json"]) writeFileSync(join(bin, f), readFileSync(join(HERE, f)), { mode: 0o700 })
  writeFileSync(join(bin, "evals-profile.sh"), "#!/bin/sh\ntouch " + join(r.root, "login-ran") + "\nexit 0\n", { mode: 0o700 })
  writeFileSync(join(bin, "check-real.sh"), "#!/bin/sh\necho \"FAIL $1: the check failed\"\nexit ${CHECK_EXIT:-1}\n", { mode: 0o700 })
  return spawnSync(join(bin, "signin.sh"), ["--only", vendor, "--yes"], { env: { ...r.env, EVALS_BIN: bin, ...extraEnv }, encoding: "utf8" })
}

for (const [vendor, target] of [["gws", "gws-default"], ["wisprflow", "Wispr Flow"], ["linear", "linear"]]) {
  test(`walk: the fix line after a failed check-real for ${vendor} is safe and uses the right login target`, () => {
    const r = rig()
    try {
      const out = failingWalk(r, vendor)
      assert.equal(out.status, 1, out.stdout + out.stderr)
      const text = out.stdout + out.stderr
      assert.match(text, /STOP at \S+: check-real FAILED/)
      assert.match(text, /sign \S+ back in from your normal OpenCode/)
      const lines = text.split("\n").filter((l) => /opencode auth login/.test(l))
      assert.ok(lines.length >= 1)
      for (const l of lines) assert.match(l, /--server http:\/\/127\.0\.0\.1:4096/, `a plain opencode auth login: ${l}`)
      assert.ok(lines.some((l) => l.includes(`"${target}"`)), `login target ${target}`)
      assert.ok(!text.includes(SECRET) && !/OPENCODE_PASSWORD=\S{6,}/.test(text), "no password value printed")
    } finally {
      r.done()
    }
  })
}

test("walk: no line the script prints holds `opencode auth login` without --server or evals-profile.sh", () => {
  const src = readFileSync(join(HERE, "signin.sh"), "utf8") + readFileSync(join(HERE, "copy-client.mjs"), "utf8") + readFileSync(join(HERE, "check-real.mjs"), "utf8")
  for (const l of src.split("\n").filter((x) => /(echo|console\.log|`)/.test(x) && /opencode auth login|\$OC auth login/.test(x))) {
    assert.ok(/--server|evals-profile\.sh/.test(l) || /^\s*#/.test(l), `unsafe printed line: ${l.trim().slice(0, 120)}`)
  }
})

test("gws-app: a store file with a different client id STOPs the walk with its fix; it is not recorded as passed", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "real-gws-default.json"), JSON.stringify([{ integrationID: "gws-default", label: "default", active: true, value: { type: "oauth", metadata: { clientId: "real.apps.googleusercontent.com", clientSecret: "GOCSPX-real-0123456789" } } }]))
    writeFileSync(join(r.env.EVALS_STORE, "evals-gws-client.json"), JSON.stringify({ clientId: "other.apps.googleusercontent.com", clientSecret: "x" }))
    const out = spawnSync(join(HERE, "signin.sh"), ["--only", "gws-app", "--yes"], { env: { ...r.env, EVALS_BIN: HERE }, encoding: "utf8" })
    assert.equal(out.status, 1, out.stdout)
    assert.match(out.stdout, /differs from the real profile's/)
    assert.match(out.stdout, /--from gws-app/)
    assert.doesNotMatch(readFileSync(join(r.env.EVALS_STORE, "signin-passed"), "utf8"), /gws-app/)
  } finally {
    r.done()
  }
})

test("gws-app: no Desktop client to copy is SKIPPED (the form will ask), never PASS", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "real-gws-default.json"), JSON.stringify([{ integrationID: "gws-default", label: "default", active: true, value: { type: "oauth", metadata: { access: "read" } } }]))
    const out = spawnSync(join(HERE, "signin.sh"), ["--only", "gws-app", "--yes"], { env: { ...r.env, EVALS_BIN: HERE }, encoding: "utf8" })
    assert.equal(out.status, 0, out.stdout)
    assert.match(out.stdout, /gws-app: SKIPPED \(the form will ask\)/)
    assert.doesNotMatch(out.stdout, /gws-app: PASS/)
    assert.equal(existsSync(join(r.env.EVALS_STORE, "evals-gws-client.json")), false)
    const list = spawnSync(join(HERE, "signin.sh"), ["--list"], { env: r.env, encoding: "utf8" })
    assert.match(list.stdout, /gws-app\s+skipped/)
  } finally {
    r.done()
  }
})

test("gws-app: a failed real export STOPs (it is not a skip)", () => {
  const r = rig()
  try {
    const out = spawnSync(join(HERE, "signin.sh"), ["--only", "gws-app", "--yes"], { env: { ...r.env, EVALS_BIN: HERE, STUB_FAIL_REAL_EXPORT: "1" }, encoding: "utf8" })
    assert.equal(out.status, 1, out.stdout)
    assert.match(out.stdout, /could not read the real profile through the web server/)
  } finally {
    r.done()
  }
})

test("signin.sh: --from and --only without a value exit 2 with a message", () => {
  for (const flag of ["--from", "--only"]) {
    const out = spawnSync(join(HERE, "signin.sh"), [flag], { env: { ...process.env, EVALS_STORE: mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "walk-")) }, encoding: "utf8", timeout: 10_000 })
    assert.equal(out.status, 2, `${flag}: ${out.stdout}${out.stderr}`)
    assert.match(out.stderr, new RegExp(`${flag} needs a vendor`))
  }
})

test("check-real: an inactive stale credential beside the active one is never compared (Linear / Linear 2)", () => {
  const r = rig()
  try {
    const entry = (label, active, access, refresh) => ({ id: `cred_${label}`, integrationID: "mcp_lin", label, active, value: { type: "oauth", access, refresh } })
    // the real profile: an inactive `Linear` with OLD tokens, and the active `Linear 2`; the evals profile holds the ACTIVE real tokens (one grant, not two)
    writeFileSync(join(r.root, "real-linear.json"), JSON.stringify([entry("Linear", false, "OLD-A", "OLD-R"), entry("Linear 2", true, "LIVE-A", "LIVE-R")]))
    writeFileSync(join(r.root, "evals-linear.json"), JSON.stringify([entry("Linear 2", true, "LIVE-A", "LIVE-R")]))
    const out = checkReal(r, "linear")
    assert.equal(out.status, 1, out.stdout)
    assert.match(out.stdout, /SAME access token/)
    // and the keeper-style lookup picks the active one
    assert.equal(activeCredentialOf(readFileSync(join(r.root, "real-linear.json"), "utf8"), "linear").label, "Linear 2")
    // only an inactive entry: no credential
    assert.equal(activeCredentialOf(JSON.stringify([entry("Linear", false, "a", "b")]), "linear"), null)
    // x-app shape: ids equal the name, the active entry has another label
    assert.equal(activeCredentialOf(JSON.stringify([{ integrationID: "x-app", label: "X app", active: false }, { integrationID: "x-app", label: "X app 2", active: true }]), "x-app").label, "X app 2")
  } finally {
    r.done()
  }
})

test("check-real: a failed real export is `could not read the real profile`, not `holds no credential`", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "evals-linear.json"), cred("linear", "Linear", "E-A", "E-R"))
    const out = checkReal(r, "linear", { STUB_FAIL_REAL_EXPORT: "1" })
    assert.equal(out.status, 5, out.stdout)
    assert.match(out.stdout, /^FAIL linear: could not read the real profile through the web server \(exit 5\); check the web server, then run signin\.sh --recheck linear/)
    assert.doesNotMatch(out.stdout, /holds no/)
  } finally {
    r.done()
  }
})

test("affinity: the organisation's own OAuth app's client ID becomes the affinity plugin's clientId option; a bad id is refused", () => {
  const store = mkdtempSync(join(tmpdir(), "walk-aff-"))
  try {
    writeFileSync(join(store, "evals-plugins.json"), JSON.stringify({ affinity: "github:o/opencode-affinity#v0.0.6", ashby: "github:o/opencode-ashby#v0.0.6" }))
    // Absent: the pin stays a plain string (OpenCode's client URL).
    assert.deepEqual(loadPins({ EVALS_STORE: store }), ["github:o/opencode-affinity#v0.0.6", "github:o/opencode-ashby#v0.0.6"])
    writeFileSync(join(store, "evals-affinity-client.json"), JSON.stringify({ clientId: "721fc1cd-2287-4ce6-b06a-2835acf4138a" }))
    const list = loadPins({ EVALS_STORE: store })
    assert.deepEqual(list[0], { package: "github:o/opencode-affinity#v0.0.6", options: { clientId: "721fc1cd-2287-4ce6-b06a-2835acf4138a" } })
    assert.equal(list[1], "github:o/opencode-ashby#v0.0.6")
    // It reaches the profile's config.
    assert.ok(JSON.stringify(profileConfig(list)).includes("721fc1cd-2287-4ce6-b06a-2835acf4138a"))
    writeFileSync(join(store, "evals-affinity-client.json"), JSON.stringify({ clientId: "not-a-uuid" }))
    assert.throws(() => loadPins({ EVALS_STORE: store }), /must hold clientId, a UUID/)
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})

// ---- identity reads: the real method names and the real envelope (round 3) -----------------------------------------------------------------------
const stubCall = (r, side = "evals") => (args) => {
  const home = side === "real" ? r.realHome : join(r.root, "profile")
  const server = side === "real" ? ["--server", WEB] : []
  const out = spawnSync(r.env.OPENCODE_BIN, [...args, ...server], { env: { ...r.env, HOME: home, ...(side === "real" ? { OPENCODE_SERVER_PASSWORD: SECRET } : {}) }, encoding: "utf8" })
  return { code: out.status, stdout: out.stdout, stderr: out.stderr }
}
const fixture = JSON.parse(readFileSync(join(HERE, "rpc-methods.fixture.json"), "utf8")).methods

test("identity: every vendor's route names a method its plugin's describe lists (never <plugin>_<tool>)", () => {
  for (const [vendor, route] of Object.entries(IDENTITY)) {
    const [ns, method] = route.split("/")
    assert.ok(fixture[ns], `${vendor}: namespace ${ns}`)
    assert.ok(fixture[ns].includes(method), `${vendor}: ${method} is not in ${ns}'s describe`)
    if (["ashby", "elevenlabs", "wisprflow", "gws"].includes(vendor)) assert.notEqual(method, "probe", `${vendor}: its probe calls nothing (a credential-only check)`)
  }
  assert.equal(IDENTITY.affinity, "affinity.crm.tools/probe")
  assert.deepEqual(IDENTITY_INPUT.gws, { operation: "gmail.users.getProfile", params: { userId: "me" }, fields: "emailAddress" })
})

test("identity: each vendor's check runs in a session with an agent, sends the {input:{sessionID,input}} envelope, and deletes the session", () => {
  const r = rig()
  try {
    for (const vendor of Object.keys(IDENTITY)) {
      const out = identityCheck(stubCall(r), { vendor, directory: join(r.root, "profile") })
      assert.deepEqual({ ok: out.ok, why: out.why }, { ok: true, why: undefined }, vendor)
    }
    const calls = r.calls()
    const rpc = calls.filter((c) => c.a[2]?.startsWith("/api/rpc/"))
    assert.equal(rpc.length, Object.keys(IDENTITY).length)
    for (const c of rpc) {
      const body = JSON.parse(c.a[c.a.indexOf("-d") + 1])
      assert.deepEqual(Object.keys(body), ["input"])
      assert.deepEqual(Object.keys(body.input).sort(), ["input", "sessionID"])
      assert.match(body.input.sessionID, /^ses_/)
      assert.ok(c.a.some((x) => x.startsWith("x-opencode-directory:")))
    }
    const made = calls.filter((c) => c.a[1] === "post" && c.a[2] === "/api/session")
    assert.equal(made.length, rpc.length)
    assert.equal(JSON.parse(made[0].a[made[0].a.indexOf("-d") + 1]).agent, "build")
    assert.equal(readFileSync(join(r.root, "deleted.log"), "utf8").trim().split("\n").length, made.length, "every session deleted")
  } finally {
    r.done()
  }
})

test("identity: the stub (and the real server) refuses the old shapes: `{}`, a plain method name, a missing session", () => {
  const r = rig()
  try {
    const call = stubCall(r)
    const post = (route, body) => call(["api", "post", `/api/rpc/${route}`, "-H", "x-opencode-directory:/x", "-d", body])
    assert.match(post("affinity.crm.tools/probe", "{}").stdout, /rpc\.invalid_input/)
    assert.match(post("affinity.crm.tools/probe", '{"input":{}}').stdout, /rpc\.invalid_input/)
    assert.match(post("affinity.crm.tools/affinity_get_current_user", '{"input":{"sessionID":"ses_a","input":{}}}').stdout, /rpc\.method_not_found/)
    assert.equal(rpcFailure(post("affinity.crm.tools/probe", "{}")).startsWith("rpc.invalid_input"), true)
    assert.equal(rpcFailure(post("affinity.crm.tools/probe", '{"input":{"sessionID":"ses_a","input":{}}}')), null)
  } finally {
    r.done()
  }
})

test("check-real affinity: a failed EVALS identity read says so and never tells the owner to sign the real profile back in; the session is deleted", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "real-affinity.json"), "[]")
    writeFileSync(join(r.root, "evals-affinity.json"), cred("affinity", "Affinity", "E-A", "E-R"))
    const out = checkReal(r, "affinity", { STUB_FAIL_RPC: "1" })
    assert.equal(out.status, 4, out.stdout)
    assert.match(out.stdout, /^FAIL affinity: the evals profile's identity read \(probe\) failed: rpc\.tool_failed/)
    assert.match(out.stdout, /Your normal profile is not involved/)
    assert.match(out.stdout, /signin\.sh --recheck affinity/)
    assert.doesNotMatch(out.stdout, /sign the real profile back in/)
    assert.equal(readFileSync(join(r.root, "deleted.log"), "utf8").trim().split("\n").length, 1, "the check session was deleted on the failure path")
    assert.equal(r.calls().filter((c) => c.real).length, 1, "only the real export touched the real profile (no real vendor read)")
  } finally {
    r.done()
  }
})

test("check-real linear: a failed REAL identity read deletes its real session too, and is a real-profile failure", () => {
  const r = rig()
  try {
    const out = checkReal(r, "linear", { STUB_FAIL_RPC: "1" })
    assert.equal(out.status, 1, out.stdout)
    assert.match(out.stdout, /^FAIL linear: the real profile's identity read \(probe\) failed/)
    const real = r.calls().filter((c) => c.real)
    assert.deepEqual(real.map((c) => c.a[1]), ["post", "post", "delete"])
    for (const c of real) assert.equal(c.server, WEB)
  } finally {
    r.done()
  }
})

test("check-real: a check session that cannot be deleted is named, not hidden", () => {
  const r = rig()
  try {
    const out = checkReal(r, "linear", { STUB_FAIL_DELETE: "1" })
    assert.equal(out.status, 0, out.stdout)
    assert.match(out.stdout + "", /^PASS linear/)
    const loud = checkReal(r, "linear", { STUB_FAIL_DELETE: "1", STUB_FAIL_RPC: "1" })
    assert.match(loud.stdout, /could not be deleted: delete the session titled "evals walk check"/)
  } finally {
    r.done()
  }
})

for (const [exit, expect, forbid] of [[4, /Nothing is wrong with your normal profile[\s\S]*signin\.sh --recheck gws/, /sign gws back in from your normal OpenCode/], [5, /could not be read[\s\S]*--recheck gws/, /sign gws back in from your normal OpenCode/], [1, /sign gws back in from your normal OpenCode/, null]]) {
  test(`walk: a check-real exit ${exit} prints the fix for that side`, () => {
    const r = rig()
    try {
      const out = failingWalk(r, "gws", { CHECK_EXIT: String(exit) })
      assert.equal(out.status, 1, out.stdout + out.stderr)
      assert.match(out.stdout, expect)
      if (forbid) assert.doesNotMatch(out.stdout, forbid)
      for (const l of out.stdout.split("\n").filter((x) => /opencode auth login/.test(x))) assert.match(l, /--server http:\/\/127\.0\.0\.1:4096/)
    } finally {
      r.done()
    }
  })
}

test("signin.sh --recheck: runs only the check (no sign-in), marks the vendor passed, and a failure keeps it unmarked", () => {
  const r = rig()
  try {
    const bin = join(r.root, "bin")
    failingWalk(r, "affinity", { CHECK_EXIT: "0" }) // builds the fake bin; this run signs in (fake) and passes
    rmSync(join(r.root, "login-ran"), { force: true })
    writeFileSync(join(r.env.EVALS_STORE, "signin-passed"), "")
    const ok = spawnSync(join(bin, "signin.sh"), ["--recheck", "affinity"], { env: { ...r.env, EVALS_BIN: bin, CHECK_EXIT: "0" }, encoding: "utf8" })
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    assert.match(ok.stdout, /affinity: check only \(no sign-in\)/)
    assert.match(ok.stdout, /affinity: PASS/)
    assert.equal(existsSync(join(r.root, "login-ran")), false, "no sign-in ran")
    assert.match(readFileSync(join(r.env.EVALS_STORE, "signin-passed"), "utf8"), /^affinity$/m)
    writeFileSync(join(r.env.EVALS_STORE, "signin-passed"), "")
    const bad = spawnSync(join(bin, "signin.sh"), ["--recheck", "affinity"], { env: { ...r.env, EVALS_BIN: bin, CHECK_EXIT: "4" }, encoding: "utf8" })
    assert.equal(bad.status, 1)
    assert.doesNotMatch(readFileSync(join(r.env.EVALS_STORE, "signin-passed"), "utf8"), /affinity/)
  } finally {
    r.done()
  }
})

// ---- strict identity answers (round 4): a real call, a real shape, no error signal ---------------------------------------------------------------------
const answerOf = (obj) => ({ code: 0, stdout: JSON.stringify(obj), stderr: "" })
const REAL_ANSWER = (vendor) => ANSWERS[IDENTITY[vendor]] ?? PROBE_ANSWER

test("identity: the real answer of every vendor passes, and only its own shape passes", () => {
  for (const vendor of Object.keys(IDENTITY)) assert.equal(judgeAnswer(answerOf(REAL_ANSWER(vendor)), vendor), null, vendor)
})

test("identity: an error-free exit-0 answer WITHOUT the expected field FAILs, for every vendor", () => {
  const shapeless = [{}, { output: null }, { output: {} }, { output: { output: {} } }, { output: { output: { data: {} }, text: "" } }, { output: { text: "ok" } }, { output: [] }, { output: { account: "stub" }, text: "ok" }]
  for (const vendor of Object.keys(IDENTITY)) for (const a of shapeless) assert.notEqual(judgeAnswer(answerOf(a), vendor), null, `${vendor}: ${JSON.stringify(a)}`)
  assert.notEqual(judgeAnswer({ code: 0, stdout: "[]", stderr: "" }, "linear"), null)
  assert.notEqual(judgeAnswer({ code: 0, stdout: "not json", stderr: "" }, "linear"), null)
})

test("identity: error shapes with exit 0 FAIL even beside a real-looking answer", () => {
  const withError = (vendor, extra) => { const a = JSON.parse(JSON.stringify(REAL_ANSWER(vendor))); Object.assign(a.output && typeof a.output === "object" ? a.output : a, extra); return a }
  for (const extra of [{ code: "AUTH_REQUIRED" }, { status: "UNAVAILABLE" }, { failed: true }, { refused: "denied" }, { error: "boom" }, { isError: true }, { code: "UPSTREAM_UNREADABLE" }, { errors: ["x"] }]) {
    for (const vendor of Object.keys(IDENTITY)) assert.notEqual(judgeAnswer(answerOf(withError(vendor, extra)), vendor), null, `${vendor}: ${JSON.stringify(extra)}`)
  }
  assert.ok(errorSignal({ data: { _tag: "RpcError" } }))
  assert.ok(errorSignal({ isError: true }))
})

for (const vendor of ["ashby", "elevenlabs", "wisprflow", "gws"]) {
  test(`identity ${vendor}: a credential-only probe result would have passed the old check and FAILs now`, () => {
    // what `${vendor}`'s probe answers: source, account, owner, trust, and no vendor call
    const probe = { output: { source: vendor, account: "default", owner: { id: "default", label: "default" }, trust: { accountOwnedBy: "owner" } } }
    assert.equal(rpcFailureCompat(probe), null, "the old judge (no error, exit 0) accepted it")
    assert.notEqual(judgeAnswer(answerOf(probe), vendor), null, "the vendor's real-call shape is required")
    assert.notEqual(IDENTITY[vendor].split("/")[1], "probe")
  })
}

const rpcFailureCompat = (a) => (/"error"\s*:/.test(JSON.stringify(a).slice(0, 400)) ? "error" : null)

test("slack: a probe answering UPSTREAM_UNREADABLE falls back to nothing: it FAILs, never PASSes (the identity read is slack_read_user_profile)", () => {
  assert.equal(IDENTITY.slack, "slack.workspace.tools/slack_read_user_profile")
  assert.equal(IDENTITY_ACTION.slack, "slack_slack_read_user_profile")
  const unreadable = { output: { code: "UPSTREAM_UNREADABLE", message: "Slack's slack_read_user_profile answered in a shape events_list does not read" } }
  assert.match(judgeAnswer(answerOf(unreadable), "slack"), /UPSTREAM_UNREADABLE|carries/)
  assert.match(judgeAnswer(answerOf({ _tag: "RpcError", type: "rpc.tool_failed", message: "UPSTREAM_UNREADABLE" }), "slack"), /rpc\.tool_failed/)
  // a profile answer with no email is not an identity either
  assert.notEqual(judgeAnswer(answerOf({ output: { output: { result: "someone" }, text: "x" } }), "slack"), null)
  assert.equal(shapeProblem(REAL_ANSWER("slack"), IDENTITY_EXPECT.slack), null)
})

test("slack: the profile answer must carry an address on its own line (or an `email:` line) and must not be error text", () => {
  const ok = (result) => judgeAnswer(answerOf({ output: { output: { result }, text: "{}" } }), "slack")
  assert.equal(ok("joe (joe)\nOrg\nTitle\njoe@example.com\nStatus: "), null, "the live shape")
  assert.equal(ok("joe\nemail: joe@example.com"), null, "an email: line")
  // Free text that merely CONTAINS an address is not the profile line: the old unanchored test passed it.
  assert.notEqual(ok("joe (joe) - contact joe@example.com for help"), null, "an unanchored address is not a profile line")
  // An error text that quotes an address must FAIL, on its leading error word even when the address is on its own line.
  assert.notEqual(ok("contact joe@example.com"), null)
  assert.notEqual(ok("Error: the profile could not be read\njoe@example.com"), null)
  assert.notEqual(ok("UNAVAILABLE while reading joe@example.com"), null)
  assert.notEqual(ok("Error: could not read the profile for joe@example.com"), null)
  // the rest of the strict judge still applies to a good-looking profile text
  const withError = { output: { output: { result: "joe\njoe@example.com" }, isError: true } }
  assert.match(judgeAnswer(answerOf(withError), "slack"), /isError/)
})

test("slack: check-real (real profile) calls slack_read_user_profile in a session limited to that action, and deletes it", () => {
  const r = rig()
  try {
    const out = checkReal(r, "slack")
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stdout, /identity read slack_read_user_profile \(Slack slack_read_user_profile/)
    const calls = r.calls().filter((c) => c.real)
    const made = calls.find((c) => c.a[2] === "/api/session")
    const body = JSON.parse(made.a[made.a.indexOf("-d") + 1])
    assert.deepEqual(body.permissions, [{ action: "*", resource: "*", effect: "deny" }, { action: "slack_slack_read_user_profile", resource: "*", effect: "allow" }])
    assert.ok(calls.some((c) => c.a[2] === "/api/rpc/slack.workspace.tools/slack_read_user_profile"))
    assert.deepEqual(calls.map((c) => c.a[1]).slice(0, 3), ["post", "post", "delete"])
    // and the unreadable answer fails check-real
    const bad = checkReal(r, "slack", { STUB_ANSWER: JSON.stringify({ output: { code: "UPSTREAM_UNREADABLE" } }) })
    assert.equal(bad.status, 1, bad.stdout)
    assert.match(bad.stdout, /^FAIL slack: the real profile's identity read \(slack_read_user_profile\) failed/)
  } finally {
    r.done()
  }
})

test("check-real: a left-over check session is named on a PASS too", () => {
  const r = rig()
  try {
    const out = checkReal(r, "linear", { STUB_FAIL_DELETE: "1" })
    assert.equal(out.status, 0, out.stdout)
    assert.match(out.stdout, /WARNING: \(the check session ses_\w+ could not be deleted: delete the session titled "evals walk check"/)
  } finally {
    r.done()
  }
})

// ---- the refresh chain (round 8): a baseline, then a later refresh. No lifetime is inferred ------------------------------------------------------
// Two bugs: `expires − RECHECK_HOURS` treated a recheck interval as a token lifetime (Notion's token lives 8 h, not 1 h), and "verified" needed
// no baseline, so a vendor signed in before the baseline could never resolve. And recheck_at was now + hours, so every run moved the deadline.
const HOUR = 3_600_000
const NOW = Date.now()
const refreshCred = (integrationID, access, refresh, extra = {}, id = "cred_x") => JSON.stringify([{ id, integrationID, label: "Linear", active: true, value: { type: "oauth", access, refresh, ...extra } }])
const roundLogOf = (r) => readFileSync(join(r.env.EVALS_STORE, "round-232.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const lastCheck = (r) => roundLogOf(r).filter((e) => e.event === "check-real").at(-1)
const baselineOf = (r, integration = "linear") => JSON.parse(readFileSync(join(r.env.EVALS_STORE, "refresh-baseline.json"), "utf8"))[integration]
const writeBaseline = (r, expires, { integration = "linear", at = new Date(NOW - 2 * HOUR).toISOString(), source = "sign-in", evalsId = "cred_x" } = {}) => {
  const file = join(r.env.EVALS_STORE, "refresh-baseline.json")
  const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
  all[integration] = { expires, at, source, ...(evalsId ? { evalsId } : {}) }
  writeFileSync(file, JSON.stringify(all))
}
const realLinear = (r, expires) => writeFileSync(join(r.root, "real-linear.json"), refreshCred("linear", "REAL-A", "REAL-R", expires === undefined ? {} : { expires }))
const evalsLinear = (r) => writeFileSync(join(r.root, "evals-linear.json"), refreshCred("linear", "EVALS-A", "EVALS-R"))

test("check-real: an 8 h token minted two hours before the sign-in is NOT verified (RECHECK_HOURS is not a lifetime)", () => {
  const r = rig()
  // Notion's real lifetime is 8 h; RECHECK_HOURS says 1 h. This token was minted 2 h before the sign-in and expires 6 h after it, and the
  // sign-in's baseline is exactly this expiry: no refresh since. The old inference (expires - 1 h) called this "verified".
  const expires = NOW + 6 * HOUR
  try {
    writeBaseline(r, expires, { integration: "notion", at: new Date(NOW).toISOString() })
    writeFileSync(join(r.root, "evals-notion.json"), refreshCred("notion", "EVALS-A", "EVALS-R"))
    writeFileSync(join(r.root, "real-notion.json"), refreshCred("notion", "REAL-A", "REAL-R", { expires }))
    const out = checkReal(r, "notion")
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.doesNotMatch(out.stdout, /refresh chain verified/)
    assert.match(out.stdout, /provisional: the real refresh chain is checked again by/)
    assert.equal(lastCheck(r).provisional, true)
  } finally {
    r.done()
  }
})

test("check-real: no baseline is never verified; the first run records it, stays provisional, and the deadline does not move on a second run", () => {
  const r = rig()
  const expires = NOW + 6 * HOUR
  const at = new Date(expires + 5 * 60_000).toISOString()
  try {
    evalsLinear(r)
    realLinear(r, expires)
    const first = checkReal(r, "linear")
    assert.equal(first.status, 0, first.stdout + first.stderr)
    assert.doesNotMatch(first.stdout, /refresh chain verified/)
    assert.ok(first.stdout.includes(`provisional: the real refresh chain is checked again by ${at}`), first.stdout)
    const recorded = baselineOf(r)
    assert.deepEqual({ expires: recorded.expires, source: recorded.source }, { expires, source: "check-real" })
    assert.ok(!Number.isNaN(Date.parse(recorded.at)), "the baseline carries when it was taken")
    assert.equal(statSync(join(r.env.EVALS_STORE, "refresh-baseline.json")).mode & 0o777, 0o600, "times only, in a 600 file")
    const second = checkReal(r, "linear")
    assert.equal(second.status, 0, second.stdout + second.stderr)
    assert.doesNotMatch(second.stdout, /refresh chain verified/)
    const [a, b] = roundLogOf(r).filter((e) => e.event === "check-real")
    assert.deepEqual({ provisional: a.provisional, recheck_at: a.recheck_at }, { provisional: true, recheck_at: at })
    assert.equal(b.recheck_at, a.recheck_at, "the deadline is the baseline's, so it does not move")
  } finally {
    r.done()
  }
})

test("check-real: a later expiry than the baseline verifies the refresh chain, naming the baseline's time", () => {
  const r = rig()
  const baseline = NOW + 6 * HOUR
  const at = new Date(NOW - 3 * HOUR).toISOString()
  try {
    writeBaseline(r, baseline, { at })
    evalsLinear(r)
    realLinear(r, baseline + 8 * HOUR)
    const out = checkReal(r, "linear")
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.ok(out.stdout.includes(`refresh chain verified: the real token was refreshed after ${at}`), out.stdout)
    assert.doesNotMatch(out.stdout, /provisional/)
    assert.deepEqual({ provisional: lastCheck(r).provisional, recheck_at: lastCheck(r).recheck_at, chain: lastCheck(r).refresh_chain }, { provisional: false, recheck_at: null, chain: "verified" })
    assert.equal(baselineOf(r).evalsId, "cred_x", "the same evals credential: the baseline is kept")
    assert.ok(!(out.stdout + JSON.stringify(lastCheck(r))).includes("REAL-A"), "no token is printed or logged")
  } finally {
    r.done()
  }
})

test("check-real: expires in seconds and in milliseconds are both read and normalised", () => {
  const baseline = NOW + 6 * HOUR
  const later = NOW + 14 * HOUR
  const cases = [
    ["a baseline in seconds, the export in ms", Math.round(baseline / 1000), later],
    ["the baseline in ms, the export in seconds", baseline, Math.round(later / 1000)],
  ]
  for (const [name, stored, exported] of cases) {
    const r = rig()
    try {
      writeBaseline(r, stored)
      evalsLinear(r)
      realLinear(r, exported)
      const out = checkReal(r, "linear")
      assert.equal(out.status, 0, `${name}: ${out.stdout}${out.stderr}`)
      assert.match(out.stdout, /refresh chain verified/, name)
    } finally {
      r.done()
    }
  }
})

test("check-real: a missing or untrusted expiry says so, never claims verified, and keeps the baseline's fixed deadline", () => {
  const baseline = NOW + 6 * HOUR
  const fixed = new Date(baseline + 5 * 60_000).toISOString()
  const cases = [
    ["missing", undefined],
    ["far in the future", NOW + 60 * 24 * HOUR],
    ["far in the past", NOW - 60 * 24 * HOUR],
  ]
  for (const [name, expires] of cases) {
    const r = rig()
    try {
      writeBaseline(r, baseline)
      evalsLinear(r)
      realLinear(r, expires)
      const out = checkReal(r, "linear")
      assert.equal(out.status, 0, `${name}: ${out.stdout}${out.stderr}`)
      assert.match(out.stdout, /provisional: unknown: no expiry on the real credential/, name)
      assert.doesNotMatch(out.stdout, /refresh chain verified/, name)
      assert.deepEqual({ provisional: lastCheck(r).provisional, recheck_at: lastCheck(r).recheck_at }, { provisional: true, recheck_at: fixed }, name)
    } finally {
      r.done()
    }
  }
  // and with no baseline at all, unknown carries no deadline
  const r = rig()
  try {
    evalsLinear(r)
    realLinear(r) // no expires
    const out = checkReal(r, "linear")
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stdout, /provisional: unknown: no expiry on the real credential/)
    assert.deepEqual({ provisional: lastCheck(r).provisional, recheck_at: lastCheck(r).recheck_at }, { provisional: true, recheck_at: null })
  } finally {
    r.done()
  }
})

test("refreshChain: a later expiry is not verified unless the identity read passed, and never without a baseline", () => {
  const baseline = { expires: NOW + 6 * HOUR, at: new Date(NOW).toISOString() }
  assert.equal(refreshChain({ expires: NOW + 14 * HOUR, baseline, identityOk: false, now: NOW }).verified, false)
  assert.equal(refreshChain({ expires: NOW + 14 * HOUR, baseline, identityOk: true, now: NOW }).verified, true)
  assert.equal(refreshChain({ expires: NOW + 14 * HOUR, baseline: null, identityOk: true, now: NOW }).verified, false, "no baseline: never verified")
})

test("the real web server is loopback only: a non-loopback URL is refused before any call", () => {
  for (const url of ["http://127.0.0.1:4096", "http://localhost:4096", "http://[::1]:4096"]) assert.equal(realServerUrl({ EVALS_REAL_SERVER: url }), url)
  for (const url of ["http://example.com:4096", "https://10.0.0.1:4096", "ftp://127.0.0.1:4096", "http://127.0.0.1.evil.com:4096", "not a url"]) assert.throws(() => realServerUrl({ EVALS_REAL_SERVER: url }), /loopback/, url)
  // The reviewer's parser cases: refused, or normalised to a loopback origin with no userinfo, path, query or fragment.
  const normalised = new Map([
    ["http://127.0.0.1:4096\\@evil.com", "http://127.0.0.1:4096"],
    ["HTTP://LOCALHOST", "http://localhost"],
    ["http://127.0.0.1:4096/anything?x=1#f", "http://127.0.0.1:4096"],
    ["http://[::1]:4096/path", "http://[::1]:4096"],
  ])
  for (const [input, expected] of normalised) {
    const out = realServerUrl({ EVALS_REAL_SERVER: input })
    assert.equal(out, expected, input)
    assert.ok(!out.includes("@") && !out.includes("?") && !out.includes("#"), `${input}: no userinfo, query or fragment`)
  }
  // (built from parts: the privacy gate reads a userinfo URL as an email address)
  const userinfoUrl = ["http://127.0.0.1", "evil.com"].join("@")
  // Bare forms are not URLs at all, so they are refused; with a scheme, WHATWG normalises each host to 127.0.0.1 and the origin has no userinfo.
  for (const input of ["0x7f000001", "2130706433", "127.1", "user:pw@127.0.0.1"]) assert.throws(() => realServerUrl({ EVALS_REAL_SERVER: input }), /loopback/, input)
  for (const input of ["http://0x7f000001", "http://2130706433", "http://127.1", "http://user:pw@127.0.0.1"]) assert.equal(realServerUrl({ EVALS_REAL_SERVER: input }), "http://127.0.0.1", input)
  for (const input of [userinfoUrl, "http://[::ffff:127.0.0.1]"]) assert.throws(() => realServerUrl({ EVALS_REAL_SERVER: input }), /loopback/, input)
  const r = rig()
  try {
    const out = checkReal(r, "linear", { EVALS_REAL_SERVER: "http://example.com:4096" })
    assert.equal(out.status, 5, out.stdout)
    assert.match(out.stdout, /^FAIL linear: EVALS_REAL_SERVER \(or --real-server\) must be a loopback URL/)
    assert.equal(existsSync(join(r.root, "calls.jsonl")), false, "no call was made")
  } finally {
    r.done()
  }
})

test("signin.sh: a completed sign-in logs its time and records the real expiry as the baseline", () => {
  const r = rig()
  const expires = NOW + 6 * HOUR
  try {
    writeFileSync(join(r.root, "real-linear.json"), refreshCred("linear", "REAL-A", "REAL-R", { expires }))
    writeFileSync(join(r.root, "evals-linear.json"), refreshCred("linear", "EVALS-A", "EVALS-R")) // id cred_x
    const out = failingWalk(r, "linear", { CHECK_EXIT: "0" })
    assert.equal(out.status, 0, out.stdout + out.stderr)
    const entry = readFileSync(join(r.env.EVALS_STORE, "round-232.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.event === "sign-in" && e.integration === "linear")
    assert.ok(entry, "a sign-in line was recorded")
    assert.ok(!Number.isNaN(Date.parse(entry.at)), "with the time it completed")
    assert.deepEqual({ expires: baselineOf(r).expires, source: baselineOf(r).source, evalsId: baselineOf(r).evalsId }, { expires, source: "sign-in", evalsId: "cred_x" })
  } finally {
    r.done()
  }
})

// ---- round 8: a re-sign-in is the new fixed point; a corrupt baseline is ignored; writers share the file --------------------------------
const logSignin = (r, integration = "linear", extra = {}) => spawnSync(process.execPath, [join(HERE, "log-signin.mjs"), r.env.EVALS_STORE, integration], { env: { ...r.env, ...extra }, encoding: "utf8" })
const baselineFile = (r) => join(r.env.EVALS_STORE, "refresh-baseline.json")

test("check-real: a re-sign-in replaces the baseline, so a refresh between two sign-ins does not count as one after the second", () => {
  const r = rig()
  const first = NOW + 4 * HOUR
  try {
    realLinear(r, first)
    assert.equal(logSignin(r).status, 0)
    assert.equal(baselineOf(r).expires, first)
    // A real refresh between the two sign-ins: this proves the chain against the FIRST sign-in...
    realLinear(r, NOW + 12 * HOUR)
    assert.match(checkReal(r, "linear").stdout, /refresh chain verified/)
    // ...but the second sign-in is the fixed point now, so that refresh no longer counts.
    assert.equal(logSignin(r).status, 0)
    assert.equal(baselineOf(r).expires, NOW + 12 * HOUR, "the sign-in replaced the baseline")
    const afterSecond = checkReal(r, "linear")
    assert.match(afterSecond.stdout, /provisional: the real refresh chain is checked again by/)
    assert.doesNotMatch(afterSecond.stdout, /refresh chain verified/)
    // Only a refresh after the second sign-in verifies.
    realLinear(r, NOW + 20 * HOUR)
    assert.match(checkReal(r, "linear").stdout, /refresh chain verified: the real token was refreshed after/)
  } finally {
    r.done()
  }
})

test("baselines: a sign-in replaces, check-real keeps (pinned)", () => {
  const r = rig()
  const first = NOW + 4 * HOUR
  try {
    const kept = recordBaseline(r.env.EVALS_STORE, "linear", first, { now: NOW, at: new Date(NOW - 2 * HOUR).toISOString(), evalsId: "cred_x" })
    assert.equal(kept.expires, first)
    // check-real's record (replace false) never moves an existing baseline for the same evals credential...
    const same = recordBaseline(r.env.EVALS_STORE, "linear", NOW + 12 * HOUR, { now: NOW, evalsId: "cred_x" })
    assert.equal(same.expires, first)
    assert.equal(baselineOf(r).expires, first)
    // ...and always keeps it when the check itself runs beside a later real expiry.
    realLinear(r, NOW + 12 * HOUR)
    evalsLinear(r)
    assert.match(checkReal(r, "linear").stdout, /refresh chain verified/)
    assert.equal(baselineOf(r).expires, first, "check-real did not move the baseline")
    // a sign-in (replace true) does move it
    assert.equal(logSignin(r).status, 0)
    assert.equal(baselineOf(r).expires, NOW + 12 * HOUR)
    // and a sign-in whose real expiry cannot be trusted clears the old fixed point rather than keeping it
    writeFileSync(baselineFile(r), JSON.stringify({ linear: { expires: NOW + 12 * HOUR, at: new Date(NOW).toISOString(), source: "sign-in" } }))
    writeFileSync(join(r.root, "real-linear.json"), refreshCred("linear", "REAL-A", "REAL-R")) // no expires
    assert.equal(logSignin(r).status, 0)
    assert.equal(JSON.parse(readFileSync(baselineFile(r), "utf8")).linear, undefined, "no stale baseline survives an untrusted re-sign-in")
  } finally {
    r.done()
  }
})

test("signin.sh --redo clears the baseline file (a full redo)", () => {
  const r = rig()
  try {
    writeBaseline(r, NOW + 6 * HOUR)
    writeBaseline(r, NOW + 7 * HOUR, { integration: "notion" })
    const out = spawnSync(join(HERE, "signin.sh"), ["--redo", "--list"], { env: { ...r.env, EVALS_BIN: HERE }, encoding: "utf8" })
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.equal(existsSync(baselineFile(r)), false, "every vendor's baseline is gone")
    assert.match(out.stdout, /openrouter\s+not yet/)
  } finally {
    r.done()
  }
})

test("check-real: a new evals credential id (a manual sign-in) makes the baseline stale and does not verify", () => {
  const r = rig()
  try {
    writeBaseline(r, NOW + 6 * HOUR) // cred_x
    realLinear(r, NOW + 14 * HOUR)
    writeFileSync(join(r.root, "evals-linear.json"), refreshCred("linear", "EVALS-A", "EVALS-R", {}, "cred_new"))
    const out = checkReal(r, "linear")
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stdout, /a new evals sign-in since the last baseline: re-baselined/)
    assert.doesNotMatch(out.stdout, /refresh chain verified/)
    assert.deepEqual({ expires: baselineOf(r).expires, id: baselineOf(r).evalsId }, { expires: NOW + 14 * HOUR, id: "cred_new" })
    assert.deepEqual({ provisional: lastCheck(r).provisional, rebaselined: lastCheck(r).rebaselined }, { provisional: true, rebaselined: true })
    // the fresh baseline is the new fixed point: the same credential and expiry stay provisional, with the baseline's deadline
    const again = checkReal(r, "linear")
    assert.doesNotMatch(again.stdout, /refresh chain verified/)
    assert.doesNotMatch(again.stdout, /re-baselined/)
  } finally {
    r.done()
  }
})

test("check-real: an old baseline with no evals credential id does not verify", () => {
  const r = rig()
  try {
    writeBaseline(r, NOW + 6 * HOUR, { evalsId: null })
    realLinear(r, NOW + 14 * HOUR)
    evalsLinear(r) // cred_x
    const out = checkReal(r, "linear")
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stdout, /a new evals sign-in since the last baseline: re-baselined/)
    assert.doesNotMatch(out.stdout, /refresh chain verified/)
    assert.equal(baselineOf(r).evalsId, "cred_x")
  } finally {
    r.done()
  }
})

test("check-real: a sign-in whose log-signin was skipped by the guard re-baselines on the new credential id", async () => {
  const r = rig()
  const server = spawn(process.execPath, ["-e", "require('node:net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port)})"], { stdio: ["ignore", "pipe", "inherit"] })
  try {
    const port = await new Promise((res) => server.stdout.once("data", (d) => res(Number(String(d).trim()))))
    writeBaseline(r, NOW + 6 * HOUR, { evalsId: "cred_old" })
    realLinear(r, NOW + 14 * HOUR) // a real refresh between the two sign-ins
    writeFileSync(join(r.root, "evals-linear.json"), refreshCred("linear", "EVALS-A", "EVALS-R", {}, "cred_new"))
    const gl = spawnSync(process.execPath, [join(HERE, "log-signin.mjs"), r.env.EVALS_STORE, "linear"], { env: { ...r.env, EVALS_REAL_SERVICE_PORT: String(port) }, encoding: "utf8" })
    assert.equal(gl.status, 0, gl.stdout + gl.stderr)
    assert.match(gl.stderr, /no baseline was taken here/)
    assert.deepEqual({ expires: baselineOf(r).expires, id: baselineOf(r).evalsId }, { expires: NOW + 6 * HOUR, id: "cred_old" }, "the guard left the old baseline alone")
    // ...and it must not verify: the evals credential it belongs to is gone.
    const out = checkReal(r, "linear")
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stdout, /a new evals sign-in since the last baseline: re-baselined/)
    assert.doesNotMatch(out.stdout, /refresh chain verified/)
  } finally {
    server.kill()
    r.done()
  }
})

test("log-signin --forget removes one vendor's baseline and keeps the others", () => {
  const r = rig()
  try {
    writeBaseline(r, NOW + 6 * HOUR)
    writeBaseline(r, NOW + 7 * HOUR, { integration: "notion" })
    const out = spawnSync(process.execPath, [join(HERE, "log-signin.mjs"), "--forget", r.env.EVALS_STORE, "linear"], { env: r.env, encoding: "utf8" })
    assert.equal(out.status, 0, out.stdout + out.stderr)
    const all = JSON.parse(readFileSync(baselineFile(r), "utf8"))
    assert.equal(all.linear, undefined)
    assert.ok(all.notion, "another vendor's baseline is kept")
  } finally {
    r.done()
  }
})

test("signin.sh deletes the vendor's baseline before the login, so a login that fails leaves none", () => {
  const r = rig()
  const bin = join(r.root, "bin")
  try {
    mkdirSync(bin)
    for (const f of ["signin.sh", "guard-real.mjs", "log-signin.mjs", "profile-lib.mjs", "identity-methods.json"]) writeFileSync(join(bin, f), readFileSync(join(HERE, f)), { mode: 0o700 })
    writeFileSync(join(bin, "evals-profile.sh"), "#!/bin/sh\nexit 3\n", { mode: 0o700 })
    writeFileSync(join(bin, "check-real.sh"), "#!/bin/sh\nexit 1\n", { mode: 0o700 })
    writeBaseline(r, NOW + 6 * HOUR)
    writeBaseline(r, NOW + 7 * HOUR, { integration: "notion" })
    const out = spawnSync(join(bin, "signin.sh"), ["--only", "linear", "--yes"], { env: { ...r.env, EVALS_BIN: bin }, encoding: "utf8" })
    assert.equal(out.status, 1, out.stdout + out.stderr)
    assert.match(out.stdout, /the sign-in did not complete \(exit 3\)/)
    const all = JSON.parse(readFileSync(baselineFile(r), "utf8"))
    assert.equal(all.linear, undefined, "the baseline was deleted before the login")
    assert.ok(all.notion, "another vendor's baseline is untouched")
  } finally {
    r.done()
  }
})

test("check-real: a corrupt or hand-edited baseline is ignored with one line, and re-recorded", () => {
  const cases = [
    ["expires 1", { expires: 1, at: new Date(NOW - 2 * HOUR).toISOString() }],
    ["at in the future", { expires: NOW + 6 * HOUR, at: new Date(NOW + 2 * HOUR).toISOString() }],
    ["expires far from when it was taken", { expires: NOW + 6 * HOUR, at: new Date(NOW - 35 * 24 * HOUR).toISOString() }],
  ]
  for (const [name, entry] of cases) {
    const r = rig()
    try {
      writeFileSync(baselineFile(r), JSON.stringify({ linear: entry }))
      evalsLinear(r)
      realLinear(r, NOW + 6 * HOUR)
      const out = checkReal(r, "linear")
      assert.equal(out.status, 0, `${name}: ${out.stdout}${out.stderr}`)
      assert.match(out.stderr, /refresh baseline for linear: .*; ignoring it and taking a new one/, name)
      assert.doesNotMatch(out.stdout, /refresh chain verified/, name)
      assert.equal(baselineOf(r).expires, NOW + 6 * HOUR, `${name}: re-recorded from the current real expiry`)
    } finally {
      r.done()
    }
  }
})

test("baselines: unreadable JSON is moved aside, and a corrupt entry does not drop another vendor's", () => {
  const r = rig()
  const broken = '{"linear":{"expires":1,"at":"2026-01-01T00:00:00Z"},"notion":{"expires":'
  try {
    writeFileSync(baselineFile(r), broken)
    evalsLinear(r)
    realLinear(r, NOW + 6 * HOUR)
    const out = checkReal(r, "linear")
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stderr, /was not readable JSON; moved it aside and started a new file/)
    const aside = readdirSync(r.env.EVALS_STORE).find((n) => n.startsWith("refresh-baseline.json.corrupt-"))
    assert.ok(aside, "the unreadable file is kept")
    assert.equal(readFileSync(join(r.env.EVALS_STORE, aside), "utf8"), broken)
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(baselineFile(r), "utf8"))), ["linear"])
    // a readable file with one bad entry: the other vendor's baseline survives the rewrite
    const valid = { linear: { expires: 1, at: new Date(NOW - 2 * HOUR).toISOString() }, notion: { expires: NOW + 7 * HOUR, at: new Date(NOW - 2 * HOUR).toISOString(), source: "sign-in" } }
    writeFileSync(baselineFile(r), JSON.stringify(valid))
    const again = checkReal(r, "linear")
    assert.equal(again.status, 0, again.stdout + again.stderr)
    const all = JSON.parse(readFileSync(baselineFile(r), "utf8"))
    assert.equal(all.linear.expires, NOW + 6 * HOUR)
    assert.deepEqual(all.notion, valid.notion, "the other vendor's baseline is kept")
  } finally {
    r.done()
  }
})

test("baselines: eight concurrent writers keep every vendor's entry and none throws", async () => {
  const r = rig()
  const vendors = ["affinity", "ashby", "plaud", "gws", "slack", "x", "linear", "notion"]
  try {
    const lib = new URL(`file://${join(HERE, "profile-lib.mjs")}`).href
    const code = `import(${JSON.stringify(lib)}).then((m) => { m.recordBaseline(process.argv[1], process.argv[2], Number(process.argv[3])) })`
    const children = vendors.map((v, i) => spawn(process.execPath, ["-e", code, r.env.EVALS_STORE, v, String(NOW + (i + 1) * HOUR)], { env: r.env, stdio: "ignore" }))
    const codes = await Promise.all(children.map((c) => new Promise((resolve) => c.on("close", resolve))))
    assert.deepEqual(codes, vendors.map(() => 0), "no writer threw")
    const all = JSON.parse(readFileSync(baselineFile(r), "utf8"))
    for (const [i, v] of vendors.entries()) assert.equal(all[v]?.expires, NOW + (i + 1) * HOUR, v)
  } finally {
    r.done()
  }
})

test("baselines: a writer waits for another holder's lock instead of writing through it", async () => {
  const r = rig()
  const lock = join(r.env.EVALS_STORE, "refresh-baseline.json.lock")
  try {
    closeSync(openSync(lock, "wx", 0o600))
    const lib = new URL(`file://${join(HERE, "profile-lib.mjs")}`).href
    const code = `import(${JSON.stringify(lib)}).then((m) => { m.recordBaseline(process.argv[1], process.argv[2], Number(process.argv[3])) })`
    const child = spawn(process.execPath, ["-e", code, r.env.EVALS_STORE, "linear", String(NOW + 6 * HOUR)], { env: r.env, stdio: "ignore" })
    let exited = false
    const done = new Promise((resolve) => child.on("close", (status) => { exited = true; resolve(status) }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(exited, false, "the writer waits while the lock is held")
    assert.equal(existsSync(baselineFile(r)), false, "nothing was written while the lock was held")
    unlinkSync(lock)
    assert.equal(await done, 0)
    assert.equal(baselineOf(r).expires, NOW + 6 * HOUR)
  } finally {
    try {
      unlinkSync(lock)
    } catch {}
    r.done()
  }
})

test("log-signin: the real-service guard runs again, and with a problem no baseline is taken", async () => {
  const r = rig()
  const server = spawn(process.execPath, ["-e", "require('node:net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port)})"], { stdio: ["ignore", "pipe", "inherit"] })
  try {
    const port = await new Promise((res) => server.stdout.once("data", (d) => res(Number(String(d).trim()))))
    const out = spawnSync(process.execPath, [join(HERE, "log-signin.mjs"), r.env.EVALS_STORE, "linear"], { env: { ...r.env, EVALS_REAL_SERVICE_PORT: String(port) }, encoding: "utf8" })
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stderr, /log-signin: a listener on the real service's port \d+: .*; no baseline was taken/)
    assert.equal(existsSync(baselineFile(r)), false, "no baseline while a real service problem exists")
    assert.match(readFileSync(join(r.env.EVALS_STORE, "round-232.log"), "utf8"), /"event":"sign-in"/, "the sign-in time is still logged")
  } finally {
    server.kill()
    r.done()
  }
})

// ---- the check session's rules: exactly the one read, never a false FAIL from them (round 4) -----------------------------------------------------------
const permsLog = (r) => (existsSync(join(r.root, "perms.log")) ? readFileSync(join(r.root, "perms.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [])
const rulesOf = (perms) => ({ deny: perms.filter((x) => x.effect === "deny").map((x) => x.action), allow: perms.filter((x) => x.effect === "allow").map((x) => x.action) })

test("x: the check session allows x_probe AND the x_get_users_me it reads, so a deny rule never fails the X check; nothing wider", () => {
  const r = rig()
  try {
    const out = checkReal(r, "x", { STUB_INNER: "x_get_users_me" })
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stdout, /^PASS x:/)
    const sessions = permsLog(r)
    assert.equal(sessions.length, 1, "no retry was needed")
    assert.deepEqual(rulesOf(sessions[0]), { deny: ["*"], allow: ["x_probe", "x_get_users_me"] })
    assert.ok(sessions[0][0].action === "*" && sessions[0][0].effect === "deny", "deny everything first")
  } finally {
    r.done()
  }
})

test("every vendor: the check session allows its own action plus its listed inner reads, deny-all first, and nothing else", () => {
  for (const vendor of Object.keys(IDENTITY)) {
    const r = rig()
    try {
      const out = identityCheck(stubCall(r), { vendor, directory: join(r.root, "profile") })
      assert.equal(out.ok, true, `${vendor}: ${out.why}`)
      const [perms] = permsLog(r)
      assert.deepEqual(rulesOf(perms), { deny: ["*"] , allow: [IDENTITY_ACTION[vendor], ...IDENTITY_INNER[vendor]] }, vendor)
      assert.equal(perms.filter((x) => x.action.includes("*")).length, 1, "the only wildcard is the deny")
    } finally {
      r.done()
    }
  }
})

test("a read the host says the call also needs is learned once, from a read of the same plugin, into a NEW session (and both are deleted)", () => {
  const r = rig()
  try {
    const out = checkReal(r, "linear", { STUB_INNER: "linear_get_workspace" })
    assert.equal(out.status, 0, out.stdout + out.stderr)
    const sessions = permsLog(r).map(rulesOf)
    assert.equal(sessions.length, 2)
    assert.deepEqual(sessions[0].allow, ["linear_probe", "linear_get_user"])
    assert.deepEqual(sessions[1].allow, ["linear_probe", "linear_get_user", "linear_get_workspace"])
    assert.equal(readFileSync(join(r.root, "deleted.log"), "utf8").trim().split("\n").length, 2, "every session deleted")
  } finally {
    r.done()
  }
})

test("a needed action that is not a read of the plugin (a write, or another plugin's) is refused, never allowed", () => {
  for (const inner of ["linear_create_issue", "slack_slack_search_users"]) {
    const r = rig()
    try {
      const out = checkReal(r, "linear", { STUB_INNER: inner })
      assert.equal(out.status, 1, out.stdout)
      assert.match(out.stdout, new RegExp(`not allowed: ${inner} is not a read of this plugin`))
      assert.equal(permsLog(r).length, 1, "no wider session was made")
    } finally {
      r.done()
    }
  }
})

test("keeper: each vendor's session allows its identity action AND its inner reads, so a probe that reads through the host is not denied", () => {
  const r = rig()
  try {
    // x's probe reads x_get_users_me through the host: its session must allow both, as check-real does.
    writeFileSync(join(r.root, "evals-x.json"), JSON.stringify([{ integrationID: "x", label: "x", active: true, value: { type: "oauth", access: "A", refresh: "R", expires: Date.now() + 60 * 60_000 } }]))
    const results = keepOnce({ opencode: r.env.OPENCODE_BIN, profile: r.env.EVALS_PROFILE, env: { ...r.env, STUB_INNER: "x_get_users_me" }, only: ["x"] })
    assert.deepEqual(results, [{ integration: "x", ok: true }])
    const sessions = permsLog(r)
    assert.equal(sessions.length, 1, "one session for the one vendor")
    assert.deepEqual(rulesOf(sessions[0]), { deny: ["*"], allow: ["x_probe", "x_get_users_me"] })
    assert.equal(readFileSync(join(r.root, "deleted.log"), "utf8").trim().split("\n").length, 1, "its session was deleted")
  } finally {
    r.done()
  }
})

// ---- signin.sh --recheck all -----------------------------------------------------------------------------------------------------------------------
const TARGETS = { gws: "gws-default", wisprflow: "Wispr Flow" }
function allRig(signed) {
  const r = rig()
  for (const v of ["openrouter", "affinity", "ashby", "plaud", "gws", "slack", "x", "elevenlabs", "wisprflow", "metaview", "granola", "notion", "linear"]) {
    if (!signed.includes(v)) writeFileSync(join(r.root, `evals-${TARGETS[v] ?? v}.json`), "[]")
  }
  return r
}
const recheckAll = (r, args = ["--recheck"], extra = {}) => spawnSync(join(HERE, "signin.sh"), args, { env: { ...r.env, EVALS_BIN: HERE, ...extra }, encoding: "utf8" })

test("--recheck (and --recheck all): every vendor signed into the evals profile gets one line; the others are skipped; passes are recorded", () => {
  for (const args of [["--recheck"], ["--recheck", "all"], ["--recheck", "--yes"]]) {
    const r = allRig(["linear", "x", "slack"])
    try {
      const out = recheckAll(r, args)
      assert.equal(out.status, 0, out.stdout + out.stderr)
      const lines = out.stdout.trim().split("\n")
      assert.equal(lines.filter((l) => /^PASS /.test(l)).length, 3, out.stdout)
      for (const v of ["linear", "x", "slack"]) assert.ok(lines.some((l) => l.startsWith(`PASS ${v}:`)), v)
      assert.equal(lines.filter((l) => /^SKIPPED /.test(l)).length, 10)
      assert.match(lines.at(-1), /^recheck: 3 passed, 0 failed, 10 not signed in \(skipped\)\.$/)
      assert.equal(lines.length, 3 + 10 + 1, "one line per vendor and a summary")
      const passed = readFileSync(join(r.env.EVALS_STORE, "signin-passed"), "utf8")
      for (const v of ["linear", "x", "slack"]) assert.match(passed, new RegExp(`^${v}$`, "m"))
      assert.doesNotMatch(passed, /^ashby$/m)
      assert.ok(!existsSync(join(r.root, "created.log")) || readFileSync(join(r.root, "created.log"), "utf8").trim().split("\n").length === readFileSync(join(r.root, "deleted.log"), "utf8").trim().split("\n").length, "every check session deleted")
    } finally {
      r.done()
    }
  }
})

test("--recheck all: a failing vendor does not stop the others; one line each; exit 1; the failed ones are named", () => {
  const r = allRig(["linear", "x", "slack"])
  try {
    const out = recheckAll(r, ["--recheck"], { STUB_FAIL_RPC: "1" })
    assert.equal(out.status, 1, out.stdout)
    const lines = out.stdout.trim().split("\n")
    for (const v of ["linear", "x", "slack"]) assert.ok(lines.some((l) => l.startsWith(`FAIL ${v}:`)), `${v}: ${out.stdout}`)
    assert.match(out.stdout, /recheck: 0 passed, 3 failed, 10 not signed in/)
    assert.match(out.stdout, /Failed: slack x linear\./)
    assert.doesNotMatch(readFileSync(join(r.env.EVALS_STORE, "signin-passed"), "utf8"), /linear|slack|^x$/m)
    assert.equal(readFileSync(join(r.root, "created.log"), "utf8").trim().split("\n").length, readFileSync(join(r.root, "deleted.log"), "utf8").trim().split("\n").length)
  } finally {
    r.done()
  }
})

test("--recheck <vendor> works for a vendor never marked passed, and reports a vendor not signed in as a failure", () => {
  const r = allRig(["linear"])
  try {
    const ok = recheckAll(r, ["--recheck", "linear"])
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    assert.match(ok.stdout, /linear: PASS/)
    const none = recheckAll(r, ["--recheck", "ashby"])
    assert.equal(none.status, 1)
    assert.match(none.stdout, /FAIL ashby: the evals profile holds no credential/)
  } finally {
    r.done()
  }
})

test("--recheck all refuses while a real background service's port is listening", async () => {
  const r = allRig(["linear"])
  const server = spawn(process.execPath, ["-e", "require('node:net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port)})"], { stdio: ["ignore", "pipe", "inherit"] })
  try {
    const port = await new Promise((res) => server.stdout.once("data", (d) => res(Number(String(d).trim()))))
    const out = recheckAll(r, ["--recheck"], { EVALS_REAL_SERVICE_PORT: String(port) })
    assert.equal(out.status, 1)
    assert.match(out.stdout, /FAIL guard/)
    assert.equal(existsSync(join(r.root, "calls.jsonl")), false)
  } finally {
    server.kill()
    r.done()
  }
})

// ---- gws: the check never downloads the binary (round 4) --------------------------------------------------------------------------------------------
const gwsCred = (access) => JSON.stringify([{ integrationID: "gws-default", label: "default", active: true, value: { type: "oauth", access, refresh: `${access}-R` } }])

test("gws: with the binary installed the check runs its one read (gws.read, the Gmail profile) in a session that allows that action only", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "real-gws-default.json"), gwsCred("REAL"))
    writeFileSync(join(r.root, "evals-gws-default.json"), gwsCred("EVALS"))
    const out = checkReal(r, "gws", { STUB_GWS_MISSING: "1" })
    assert.equal(out.status, 6, "missing binary: see below")
    const ok = checkReal(r, "gws")
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    assert.match(ok.stdout, /identity read read \(Gmail users\.getProfile/)
    const rpc = r.calls().filter((c) => c.real && c.a[2] === "/api/rpc/google-workspace.gws.tools/read").pop()
    const body = JSON.parse(rpc.a[rpc.a.indexOf("-d") + 1])
    assert.deepEqual(body.input.input, { operation: "gmail.users.getProfile", params: { userId: "me" }, fields: "emailAddress" })
  } finally {
    r.done()
  }
})

test("gws: a binary that is not installed is NOT downloaded by the check: no gws.native_install is ever allowed; the owner is told to run /gws-install", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "real-gws-default.json"), gwsCred("REAL"))
    writeFileSync(join(r.root, "evals-gws-default.json"), gwsCred("EVALS"))
    const out = checkReal(r, "gws", { STUB_GWS_MISSING: "1" })
    assert.equal(out.status, 6, out.stdout)
    assert.match(out.stdout, /^FAIL gws: the gws plugin's program is not installed in your normal profile yet/)
    assert.match(out.stdout, /\/gws-install[\s\S]*signin\.sh --recheck gws/)
    assert.doesNotMatch(out.stdout, /sign the real profile back in/)
    const sessions = permsLog(r)
    assert.equal(sessions.length, 1, "no retry, no wider session")
    assert.deepEqual(rulesOf(sessions[0]), { deny: ["*"], allow: ["gws.read"] })
    assert.ok(!JSON.stringify(sessions).includes("native_install"), "a download is never granted")
    assert.equal(readFileSync(join(r.root, "deleted.log"), "utf8").trim().split("\n").length, 1, "the session was deleted")
  } finally {
    r.done()
  }
})

test("walk: a check-real exit 6 prints the /gws-install fix, not a sign-in fix", () => {
  const r = rig()
  try {
    const out = failingWalk(r, "gws", { CHECK_EXIT: "6" })
    assert.equal(out.status, 1, out.stdout)
    assert.match(out.stdout, /program is not installed in your normal profile yet[\s\S]*\/gws-install[\s\S]*--recheck gws/)
    assert.doesNotMatch(out.stdout, /sign gws back in/)
  } finally {
    r.done()
  }
})

// ---- round 10: transient failures (a read's own timeout, a service that has just started) ----------------------------------------------
// A read killed by its own timeout (exit 124, 137 or 143, or a timeout error) is not a sign-out: on the real side it is a read failure (exit 5)
// and is retried once; on the evals side it is an evals failure (exit 4). `rpc.unavailable` on the evals side while the service loads its
// plugins is "not ready": wait, then fail the evals side only. Auth errors and wrong answers stay real-profile failures (exit 1).
test("check-real: a real read killed by its own timeout is a read failure (exit 5), not a sign-out", () => {
  const r = rig()
  try {
    const out = checkReal(r, "linear", { STUB_RPC_TIMEOUT: "1" })
    assert.equal(out.status, 5, out.stdout + out.stderr)
    assert.match(out.stdout, /^FAIL linear: could not read the real profile in time; check the web server, then run signin\.sh --recheck linear/)
    assert.doesNotMatch(out.stdout, /sign the real profile back in/)
    // retried once: two sessions, both deleted
    assert.equal(readFileSync(join(r.root, "created.log"), "utf8").trim().split("\n").length, 2, "one retry")
    assert.equal(readFileSync(join(r.root, "deleted.log"), "utf8").trim().split("\n").length, 2, "both sessions deleted")
  } finally {
    r.done()
  }
})

test("check-real: a 401 on the real side is still a real-profile failure (exit 1)", () => {
  const r = rig()
  try {
    const out = checkReal(r, "linear", { STUB_RPC_401: "1" })
    assert.equal(out.status, 1, out.stdout + out.stderr)
    assert.match(out.stdout, /^FAIL linear: the real profile's identity read \(probe\) failed: rpc\.tool_failed: 401 Unauthorized/)
    assert.match(out.stdout, /sign the real profile back in/)
    assert.doesNotMatch(out.stdout, /in time/)
  } finally {
    r.done()
  }
})

test("check-real: a timed-out read is retried once, then passes", () => {
  const r = rig()
  try {
    const out = checkReal(r, "linear", { STUB_TIMEOUT_ONCE: "1" })
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stdout, /^PASS linear/)
    assert.equal(readFileSync(join(r.root, "created.log"), "utf8").trim().split("\n").length, 2, "the first session was replaced by the retry")
    assert.equal(readFileSync(join(r.root, "deleted.log"), "utf8").trim().split("\n").length, 2, "both sessions deleted")
  } finally {
    r.done()
  }
})

test("check-real: rpc.unavailable while the evals service starts is waited out, then the check passes", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "real-affinity.json"), "[]") // not in the real profile
    writeFileSync(join(r.root, "evals-affinity.json"), cred("affinity", "Affinity", "E-A", "E-R"))
    const out = checkReal(r, "affinity", { STUB_RPC_UNAVAILABLE: "once", EVALS_RPC_WAIT_MS: "2000" })
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stdout, /^PASS affinity/)
    assert.doesNotMatch(out.stdout, /not ready|unavailable/)
  } finally {
    r.done()
  }
})

test("check-real: an evals service that never answers rpc.unavailable is an evals failure (exit 4), never the real side", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "real-affinity.json"), "[]")
    writeFileSync(join(r.root, "evals-affinity.json"), cred("affinity", "Affinity", "E-A", "E-R"))
    const out = checkReal(r, "affinity", { STUB_RPC_UNAVAILABLE: "1", EVALS_RPC_WAIT_MS: "200" })
    assert.equal(out.status, 4, out.stdout + out.stderr)
    assert.match(out.stdout, /^FAIL affinity: the evals profile's service was not ready: rpc\.unavailable/)
    assert.match(out.stdout, /Your normal profile is not involved/)
    assert.doesNotMatch(out.stdout, /sign the real profile back in/)
    assert.equal(r.calls().filter((c) => c.real).length, 0, "no real call was made")
    assert.equal(existsSync(join(r.root, "created.log")), false, "not even a session")
  } finally {
    r.done()
  }
})

test("check-real: a timed-out evals read is an evals failure (exit 4), never the real side", () => {
  const r = rig()
  try {
    writeFileSync(join(r.root, "real-affinity.json"), "[]") // not in the real profile
    writeFileSync(join(r.root, "evals-affinity.json"), cred("affinity", "Affinity", "E-A", "E-R"))
    const out = checkReal(r, "affinity", { STUB_TIMEOUT_EVALS: "1" })
    assert.equal(out.status, 4, out.stdout + out.stderr)
    assert.match(out.stdout, /^FAIL affinity: the evals profile's identity read \(probe\) timed out/)
    assert.doesNotMatch(out.stdout, /sign the real profile back in/)
  } finally {
    r.done()
  }
})

// ---- the profile's symbolic links: judged one by one, with PulseAudio's own runtime directory the only exception (round 5) ---------------------
// No real profile is touched: every case is a scratch profile in a temp dir, and the only /tmp paths are ones this file creates.
const pulseTarget = () => {
  const dir = join("/tmp", `pulse-${randomBytes(6).toString("hex")}`)
  mkdirSync(dir, { mode: 0o700 })
  return dir
}

function linkRig() {
  const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "walk-links-"))
  const profile = join(root, "profile")
  const store = join(root, "store")
  const realHome = join(root, "real")
  for (const d of [profile, store, realHome, join(profile, ".config", "pulse"), join(profile, ".config", "opencode")]) mkdirSync(d, { recursive: true })
  writeFileSync(join(store, "evals-plugins.json"), JSON.stringify({ linear: "github:o/opencode-linear#v1" }))
  writeFileSync(join(profile, ".config", "opencode", "service.json"), JSON.stringify({ port: 47952 }))
  // `opencode` on PATH (evals-profile.sh unsets OPENCODE_* itself): it answers the service port and does nothing else.
  const stub = join(root, "opencode")
  writeFileSync(stub, `#!${process.execPath}\nconst a = process.argv.slice(2)\nif (a[0] === "service" && a[1] === "get" && a[2] === "port") { console.log("47952"); process.exit(0) }\nprocess.exit(0)\n`, { mode: 0o700 })
  const ran = join(root, "ran")
  const env = { ...process.env, HOME: root, EVALS_PROFILE: profile, EVALS_STORE: store, EVALS_PLUGINS: join(store, "evals-plugins.json"), EVALS_REAL_HOME: realHome, EVALS_REAL_SERVICE_PORT: "49998", PATH: `${root}:${process.env.PATH ?? ""}` }
  const run = () => spawnSync(join(HERE, "evals-profile.sh"), ["--", process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(ran)}, "ran")`], { env, encoding: "utf8", timeout: 30_000 })
  return { root, profile, realHome, run, ran, done: () => rmSync(root, { recursive: true, force: true }) }
}

const pulseLink = (r, name, target) => symlinkSync(target, join(r.profile, ".config", "pulse", name))
const assertRefused = (out, ran, name) => {
  assert.equal(out.status, 1, `${name}: ${out.stdout}${out.stderr}`)
  assert.match(out.stderr, /evals-profile: a symbolic link under .*refusing to run/, name)
  assert.equal(existsSync(ran), false, `${name}: nothing ran`)
}

test("evals-profile.sh: the one link it accepts is .config/pulse/<name>-runtime -> a real, user-owned /tmp/pulse-<id> directory", () => {
  const r = linkRig()
  const target = pulseTarget()
  try {
    pulseLink(r, "abcdef-runtime", target)
    const out = r.run()
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.equal(readFileSync(r.ran, "utf8"), "ran", "the command ran with the pulse link in place")
  } finally {
    rmSync(target, { recursive: true, force: true })
    r.done()
  }
})

test("evals-profile.sh: a pulse link is refused unless its path is exactly .config/pulse/<one name>-runtime", () => {
  const target = pulseTarget()
  const cases = [
    ["nested", (r) => { mkdirSync(join(r.profile, ".config", "pulse", "deep", "er"), { recursive: true }); symlinkSync(target, join(r.profile, ".config", "pulse", "deep", "er", "nested-runtime")) }],
    ["another directory", (r) => { mkdirSync(join(r.profile, ".config", "other")); symlinkSync(target, join(r.profile, ".config", "other", "x-runtime")) }],
    ["an empty name", (r) => pulseLink(r, "-runtime", target)],
    ["no -runtime suffix", (r) => pulseLink(r, "notruntime", target)],
  ]
  try {
    for (const [name, make] of cases) {
      const r = linkRig()
      try {
        make(r)
        assertRefused(r.run(), r.ran, name)
      } finally {
        r.done()
      }
    }
  } finally {
    rmSync(target, { recursive: true, force: true })
  }
})

test("evals-profile.sh: a pulse link is refused unless its readlink is exactly /tmp/pulse-<letters or digits>", () => {
  const real = pulseTarget()
  const pivot = pulseTarget()
  const dotted = join("/tmp", "pulse-a.b")
  mkdirSync(dotted, { mode: 0o700 })
  const emptyId = "/tmp/pulse-"
  const madeEmptyId = !existsSync(emptyId)
  if (madeEmptyId) mkdirSync(emptyId, { mode: 0o700 })
  try {
    const cases = [
      ["a traversal to a real pulse directory", (r) => pulseLink(r, "trav-runtime", `${pivot}/../${real.split("/").pop()}`)],
      ["another target", (r) => pulseLink(r, "home-runtime", r.realHome)],
      ["a dot after the prefix", (r) => pulseLink(r, "dot-runtime", dotted)],
      ...(madeEmptyId ? [["an empty id", (r) => pulseLink(r, "empty-runtime", emptyId)]] : []),
    ]
    for (const [name, make] of cases) {
      const r = linkRig()
      try {
        make(r)
        assertRefused(r.run(), r.ran, name)
      } finally {
        r.done()
      }
    }
  } finally {
    rmSync(real, { recursive: true, force: true })
    rmSync(pivot, { recursive: true, force: true })
    rmSync(dotted, { recursive: true, force: true })
    if (madeEmptyId) rmSync(emptyId, { recursive: true, force: true })
  }
})

test("evals-profile.sh: a /tmp/pulse-<id> target that is not a real directory (a link, or a file) is refused", () => {
  const r = linkRig()
  const real = pulseTarget()
  const link = join("/tmp", `pulse-${randomBytes(6).toString("hex")}`)
  const file = join("/tmp", `pulse-${randomBytes(6).toString("hex")}`)
  try {
    symlinkSync(real, link)
    pulseLink(r, "abcdef-runtime", link)
    assertRefused(r.run(), r.ran, "target is a link")
    const r2 = linkRig()
    try {
      writeFileSync(file, "not a directory\n", { mode: 0o600 })
      pulseLink(r2, "abcdef-runtime", file)
      assertRefused(r2.run(), r2.ran, "target is a file")
    } finally {
      r2.done()
    }
  } finally {
    rmSync(link, { force: true })
    rmSync(file, { force: true })
    rmSync(real, { recursive: true, force: true })
    r.done()
  }
})

test("evals-profile.sh: a /tmp/pulse-<id> target owned by another user is refused", (t) => {
  const r = linkRig()
  const target = pulseTarget()
  try {
    let foreign = false
    try { chownSync(target, 65534, 65534); foreign = true } catch {}
    if (!foreign) foreign = spawnSync("sudo", ["-n", "chown", "65534:65534", target], { encoding: "utf8" }).status === 0
    if (!foreign) return t.skip("cannot stage a target owned by another user here")
    pulseLink(r, "abcdef-runtime", target)
    assertRefused(r.run(), r.ran, "owned by another user")
  } finally {
    // Once the target belongs to nobody, /tmp's sticky bit keeps its removal to root: remove it the same way it was staged.
    try { rmSync(target, { recursive: true, force: true }) } catch { spawnSync("sudo", ["-n", "rm", "-rf", target], { encoding: "utf8" }) }
    r.done()
  }
})

// ---- review 6, note 1: find's own errors fail the run (fail closed) ----------------------------------------------------------------
test("evals-profile.sh: a directory find cannot read refuses the run, so a link it cannot see cannot pass (fail closed)", (t) => {
  // As root every directory is readable, so the case cannot be staged; the guard is still the code path under test.
  if (typeof process.getuid === "function" && process.getuid() === 0) return t.skip("running as root: a 000 directory does not stop find")
  const r = linkRig()
  const locked = join(r.profile, "locked")
  try {
    mkdirSync(locked, { recursive: true })
    symlinkSync(join(r.realHome, ".local", "share", "opencode"), join(locked, "escape"))
    chmodSync(locked, 0o000)
    const out = r.run()
    // The old process substitution swallowed find's status and stderr: 1 link seen, the run went on.
    assert.equal(out.status, 1, `${out.stdout}${out.stderr}`)
    assert.match(out.stderr, /evals-profile: find could not read every directory under .*refusing to run/)
    assert.equal(existsSync(r.ran), false, "nothing ran")
  } finally {
    try { chmodSync(locked, 0o700) } catch {}
    r.done()
  }
})

// ---- review 7, finding 7: a file vanishing mid-scan is not a refusal; permission errors still are --------------------------------
test("evals-profile.sh: find runs with -ignore_readdir_race, so a file vanishing mid-scan is not a refusal", () => {
  const r = linkRig()
  const record = join(r.root, "find-args")
  const realFind = (process.env.PATH ?? "").split(":").map((d) => join(d, "find")).find((p) => existsSync(p))
  try {
    assert.ok(realFind, "find is on PATH")
    // A stand-in find: without the flag it refuses, so dropping it fails this test; with it, the real find does the work.
    writeFileSync(join(r.root, "find"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(record)}\ncase " $* " in *" -ignore_readdir_race "*) ;; *) echo "STUB find: called without -ignore_readdir_race" >&2; exit 9 ;; esac\nexec ${JSON.stringify(realFind)} "$@"\n`, { mode: 0o700 })
    const out = r.run()
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(readFileSync(record, "utf8"), /-ignore_readdir_race/)
    assert.equal(readFileSync(r.ran, "utf8"), "ran")
  } finally {
    r.done()
  }
})

// ---- review 6, note 2: a stale pulse link is named and removed, and only that link ------------------------------------------------
test("evals-profile.sh: a stale pulse link (its exact target is gone) is removed, said so, and the run continues", () => {
  const r = linkRig()
  const gone = join("/tmp", `pulse-${randomBytes(6).toString("hex")}`)
  const link = join(r.profile, ".config", "pulse", "abcdef-runtime")
  const linkExists = () => { try { lstatSync(link); return true } catch { return false } }
  try {
    pulseLink(r, "abcdef-runtime", gone)
    const out = r.run()
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stderr, /^evals-profile: removed the stale PulseAudio link .*abcdef-runtime \(its target \S+ no longer exists/m)
    assert.equal(linkExists(), false, "the stale link itself was removed")
    assert.equal(readFileSync(r.ran, "utf8"), "ran", "the command ran afterwards")
  } finally {
    r.done()
  }
})

test("evals-profile.sh: a missing target with any other name or target is still refused, and the link is left alone", () => {
  const id = () => `pulse-${randomBytes(6).toString("hex")}`
  const cases = [
    ["another name", (r, gone) => pulseLink(r, "notruntime", gone)],
    ["an empty name", (r, gone) => pulseLink(r, "-runtime", gone)],
    ["a nested path", (r, gone) => { mkdirSync(join(r.profile, ".config", "pulse", "deep")); symlinkSync(gone, join(r.profile, ".config", "pulse", "deep", "nested-runtime")) }],
    ["another directory", (r, gone) => { mkdirSync(join(r.profile, ".config", "other")); symlinkSync(gone, join(r.profile, ".config", "other", "x-runtime")) }],
    ["a target that is not /tmp/pulse-<id>", (r) => pulseLink(r, "abcdef-runtime", join("/tmp", `not-${id()}`))],
    ["a target with a dot", (r) => pulseLink(r, "abcdef-runtime", `${join("/tmp", id())}.x`)],
    ["a traversal whose target is gone", (r, gone) => pulseLink(r, "abcdef-runtime", `${join("/tmp", id())}/../${gone.split("/").pop()}`)],
  ]
  for (const [name, make] of cases) {
    const r = linkRig()
    try {
      make(r, join("/tmp", id()))
      assertRefused(r.run(), r.ran, name)
    } finally {
      r.done()
    }
  }
  // A target that is itself a dangling link is a wrong target, not a missing one: it is refused, and the link stays.
  const r = linkRig()
  const gone = join("/tmp", id())
  const dangling = join("/tmp", id())
  const link = join(r.profile, ".config", "pulse", "abcdef-runtime")
  try {
    symlinkSync(gone, dangling)
    pulseLink(r, "abcdef-runtime", dangling)
    assertRefused(r.run(), r.ran, "a target that is a dangling link")
    assert.ok(lstatSync(link).isSymbolicLink(), "the refused link is not removed")
  } finally {
    rmSync(dangling, { force: true })
    r.done()
  }
})
