// A stand-in for the OpenCode binary, for the runner's tests: no model, no network beyond loopback. It answers
// `--version`, `auth export|import`, `serve` (an HTTP server that checks the run's password) and `run --format json`
// (a scripted recording), and writes what it saw (argv, environment, working directory) into its own HOME, so a test
// can check the sandbox from the inside.
import { chmodSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const SOURCE = `#!/usr/bin/env node
const { writeFileSync, mkdirSync, existsSync, readFileSync } = require("node:fs")
const { join } = require("node:path")
const http = require("node:http")
const args = process.argv.slice(2)
const home = process.env.HOME
const note = (name, data) => writeFileSync(join(home, name), JSON.stringify(data, null, 1))
const seen = () => ({ argv: args, env: process.env, cwd: process.cwd(), pid: process.pid })
// A child in the same process group, the way a provider's CLI runs under a server: it must not outlive the run.
const linger = (name) => {
  const child = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], { stdio: "ignore" })
  writeFileSync(join(home, name), String(child.pid))
  return child
}
if (args[0] === "--version") { note("version.json", seen()); console.log("opencode v2.2.6"); process.exit(0) }
if (args[0] === "auth" && args[1] === "export") {
  if (process.env.FAKE_NO_CREDENTIAL) process.exit(1)
  console.log(JSON.stringify({ integration: args[2], kind: "external" }))
  process.exit(0)
}
if (args[0] === "auth" && args[1] === "import") {
  let input = ""
  process.stdin.on("data", (d) => (input += d))
  process.stdin.on("end", () => { note("imported.json", { input, ...seen() }); process.exit(0) })
  return
}
if (args[0] === "serve") {
  const port = Number(args[args.indexOf("--port") + 1])
  const expected = "Basic " + Buffer.from("opencode:" + process.env.OPENCODE_PASSWORD).toString("base64")
  note("serve-" + port + ".json", seen())
  writeFileSync(join(home, "serve-started"), String(Date.now()))
  linger("serve-child.pid")
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== expected) { res.statusCode = 401; return res.end("{}") }
    res.setHeader("content-type", "application/json"); res.end("[]")
  })
  server.listen(port, "127.0.0.1")
  process.on("SIGTERM", () => process.exit(0))
  return
}
// Like the Claude Agent provider, the host fills its model list a moment after its server answers: before that it
// routes only a model of its own, and a run sent then gets no route.
const routing = () => {
  const file = join(home, "serve-started")
  return existsSync(file) && Date.now() - Number(readFileSync(file, "utf8")) >= 600
}
if (args[0] === "models") { console.log((routing() ? ["opencode/free-1", "mock/m1", "claude-agent/haiku", "claude-agent/sonnet", "claude-agent/opus"] : ["opencode/free-1"]).join(String.fromCharCode(10))); process.exit(0) }
if (args[0] === "run") {
  const prompt = args[args.length - 1]
  note("run.json", seen())
  if (prompt.includes("sleep")) {
    linger("run-child.pid")
    setTimeout(() => process.exit(0), 120000)
    return
  }
  if (existsSync(join(home, ".claude"))) {
    const dir = join(home, ".claude", "projects", process.cwd().replace(/[^A-Za-z0-9]/g, "-"))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "transcript.jsonl"), "{}\\n")
  }
  // A token refresh: claude writes its credentials file (write elsewhere, rename over it).
  if (prompt.includes("refresh") && existsSync(join(home, ".claude"))) {
    const target = join(home, ".claude", ".credentials.json")
    writeFileSync(target + ".tmp", JSON.stringify({ claudeAiOauth: { accessToken: "a2", refreshToken: "r2", expiresAt: Date.now() + 36000000 } }))
    require("node:fs").renameSync(target + ".tmp", target)
  }
  if (prompt.includes("write a note")) {
    mkdirSync(join(process.cwd(), "notes"), { recursive: true })
    writeFileSync(join(process.cwd(), "notes", "answer.md"), "the answer is eight\\n")
  }
  // An agent that prints the token it was given: in a tool's output, in its answer, on stderr and into a file.
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? ""
  const leak = prompt.includes("leak") ? " " + token : ""
  if (leak) {
    process.stderr.write("debug token" + leak + String.fromCharCode(10))
    writeFileSync(join(process.cwd(), "leaked.txt"), "token" + leak + String.fromCharCode(10))
  }
  // The host has no route for the model: one error event, as OpenCode prints it.
  if (prompt.includes("no-route") || !routing()) {
    console.log(JSON.stringify({ type: "error", error: { type: "provider.no-route", message: "Model unavailable: claude-agent/haiku" } }))
    process.exit(1)
  }
  // The provider refuses the credential: no model work, the host's error on stderr.
  if (prompt.includes("auth-fail")) {
    process.stderr.write('Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired"}}' + String.fromCharCode(10))
    process.exit(1)
  }
  // A token that straddles the summary's 4000-character cut of stderr.
  if (prompt.includes("straddle")) process.stderr.write(token + "y".repeat(3990))
  const at = Date.now()
  const event = (type, part, dt = 0) => console.log(JSON.stringify({ type, timestamp: at + dt, sessionID: "ses_fake", part }))
  event("step_start", { type: "step-start" })
  event("tool_use", { tool: "skill", state: { status: "completed", input: { id: "demo" }, output: "<skill_content/>" + leak } }, 1)
  event("text", { text: "the answer is eight (" + prompt.length + " chars asked)" + leak }, 2)
  const billed = /cost=([0-9]+(?:[.][0-9]+)?)/.exec(prompt)
  event("step_finish", { cost: billed ? Number(billed[1]) : 0, tokens: { input: 10, output: 5, cache: { read: 100, write: 0 } } }, 3)
  process.exit(0)
}
process.exit(2)
`

export function installFakeOpencode(dir) {
  const file = join(dir, "opencode")
  writeFileSync(file, SOURCE)
  chmodSync(file, 0o755)
  return file
}

/** A stand-in for bun running T1's mock server: answers /v1/models on the port it is given. */
export function installFakeBun(dir) {
  const file = join(dir, "bun")
  writeFileSync(
    file,
    `#!/usr/bin/env node
const port = Number(process.argv[3])
require("node:http").createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end('{"data":[{"id":"m1"}]}') }).listen(port, "127.0.0.1")
process.on("SIGTERM", () => process.exit(0))
`,
  )
  chmodSync(file, 0o755)
  return file
}
