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
const seen = () => ({ argv: args, env: process.env, cwd: process.cwd() })
if (args[0] === "--version") { console.log("opencode v2.2.6"); process.exit(0) }
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
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== expected) { res.statusCode = 401; return res.end("{}") }
    res.setHeader("content-type", "application/json"); res.end("[]")
  })
  server.listen(port, "127.0.0.1")
  process.on("SIGTERM", () => process.exit(0))
  return
}
if (args[0] === "run") {
  const prompt = args[args.length - 1]
  note("run.json", seen())
  if (existsSync(join(home, ".claude"))) {
    const dir = join(home, ".claude", "projects", process.cwd().replace(/[^A-Za-z0-9]/g, "-"))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "transcript.jsonl"), "{}\\n")
  }
  const at = Date.now()
  const event = (type, part, dt = 0) => console.log(JSON.stringify({ type, timestamp: at + dt, sessionID: "ses_fake", part }))
  event("step_start", { type: "step-start" })
  event("tool_use", { tool: "skill", state: { status: "completed", input: { id: "demo" }, output: "<skill_content/>" } }, 1)
  event("text", { text: "the answer is eight (" + prompt.length + " chars asked)" }, 2)
  event("step_finish", { cost: 0, tokens: { input: 10, output: 5, cache: { read: 100, write: 0 } } }, 3)
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
