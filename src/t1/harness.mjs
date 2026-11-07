// The T1 harness: a real plugin, a real OpenCode host from a stock binary, and a scripted model — with no
// network, no credentials and no model. Every process it starts is recorded by PID, and it signals only
// those: a leftover `opencode serve` from an older run is never touched.
//
// Isolation is the same shape as the plugins' own host tests: HOME, XDG_*, TMPDIR under a run directory;
// a git repository as the project so discovery cannot walk up into the owner's config; outbound HTTP
// through a dead proxy so a plugin cannot reach its vendor; a password only this run knows.

import { spawn } from "node:child_process"
import { createWriteStream, existsSync, mkdirSync, writeFileSync, readFileSync, cpSync, readdirSync, statSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { call, until, freePort } from "./http.mjs"

const ROOT = resolve(import.meta.dirname, "..", "..")

export const TESTED = ["2.2.3", "2.2.4", "2.2.5"]

/** Where the stock binaries are. Configuration only: no machine path is written into this repository. */
export function stockBinary(version) {
  const env = process.env[`OPENCODE_BIN_${version.replaceAll(".", "_")}`]
  if (env && existsSync(env)) return env
  const config = process.env.EVALS_STOCK_DIR
  if (config) {
    const candidate = join(config, version, "node_modules/@opencode/cli-darwin-arm64/bin/opencode")
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function availableVersions() {
  return TESTED.filter((version) => stockBinary(version))
}

/** One of the family's three machine-wide check slots, so nine plugins cannot start nine servers at once. */
export async function withSlot(run) {
  const script = process.env.EVALS_WITH_SLOT
  if (!script || !existsSync(script)) return await run()
  const child = spawn("bash", [script, "true"], { stdio: "ignore" })
  await new Promise((done) => child.on("exit", done))
  return await run()
}

const tracked = new Set()

export function track(child) {
  if (child.pid) tracked.add(child.pid)
  return child
}

/** Signals only what this run started: TERM, a short wait, then KILL. */
export async function stopAll({ graceMs = 2000 } = {}) {
  const pids = [...tracked]
  tracked.clear()
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // already gone
    }
  }
  await new Promise((done) => setTimeout(done, graceMs))
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // already gone
    }
  }
}

const mkdir = (dir) => mkdirSync(dir, { recursive: true })

/**
 * A plugin the harness loads. The plugin's own `dist/`, `skills/` and `package.json` are copied into the
 * run directory (never moved), so the checkout stays read-only; when a fake MCP is declared, the single
 * endpoint string in `dist/index.js` is replaced, exactly as the plugins' own pack test does.
 */
export function materialise({ repo, into, endpoint }) {
  const dist = join(into, "dist")
  const skills = join(into, "skills")
  mkdir(dist)
  for (const file of readdirSync(join(repo, "dist"))) {
    if (file.endsWith(".js")) cpSync(join(repo, "dist", file), join(dist, file))
  }
  if (existsSync(join(repo, "skills"))) cpSync(join(repo, "skills"), skills, { recursive: true })
  cpSync(join(repo, "package.json"), join(into, "package.json"))
  if (endpoint) {
    const index = join(dist, "index.js")
    const text = readFileSync(index, "utf8")
    const before = (text.match(/https:\/\/[a-z0-9.-]+\/[a-z/]*/g) ?? []).filter((url) => url.includes("api.") || url.includes("mcp"))
    if (!before.length) throw new Error(`${repo}: no endpoint string found in dist/index.js`)
    writeFileSync(index, text.split(before[0]).join(endpoint))
    return { replaced: before[0], with: endpoint }
  }
  return null
}

/** Starts the run's mock model, its fake MCP (when a pack declares one) and one host server. */
export async function startHost({ version, plugin, runDir, fakeModule, fakePluginOptions = {}, captureOut, runId = "t1", env = {} }) {
  const binary = stockBinary(version)
  if (!binary) throw new Error(`no stock binary for ${version}; set OPENCODE_BIN_${version.replaceAll(".", "_")} or EVALS_STOCK_DIR`)

  const home = join(runDir, "home")
  const project = join(runDir, "project")
  mkdir(join(home, ".config", "opencode"))
  mkdir(join(home, "tmp"))
  mkdir(join(project, ".git"))
  const password = `eval-${Math.random().toString(36).slice(2)}`
  const mockPort = await freePort()
  const port = await freePort()
  const mockLog = join(runDir, "mock.jsonl")
  const mockOut = createWriteStream(join(runDir, "mock.out"))
  const mock = track(spawn(process.env.EVALS_BUN ?? "bun", [join(ROOT, "src/t1/mock/server.ts"), String(mockPort), mockLog], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOME: home, TMPDIR: join(home, "tmp") },
  }))
  mock.stdout.on("data", (data) => mockOut.write(data))
  mock.stderr.on("data", (data) => mockOut.write(data))

  await until("the mock model's port", async () => (await fetch(`http://127.0.0.1:${mockPort}/v1/models`)).ok, { timeoutMs: 15000 })

  let fake = null
  let endpoint = null
  // The fake's control files are per-run: a stale URL from an earlier run would point the plugin at a dead port.
  for (const stale of ["fake.url", "fake.calls.json"]) {
    const file = join(home, stale)
    if (existsSync(file)) rmSync(file)
  }
  if (fakeModule) {
    const fakePort = await freePort()
    const out = createWriteStream(join(runDir, "fake.out"))
    fake = track(
      spawn(process.env.EVALS_BUN ?? "bun", [join(ROOT, "src/t1/fakes/x.ts"), String(fakePort), JSON.stringify(fakePluginOptions)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, HOME: home, TMPDIR: join(home, "tmp"), EVALS_FAKE_MODULE: fakeModule },
      }),
    )
    fake.stdout.on("data", (data) => out.write(data))
    fake.stderr.on("data", (data) => out.write(data))
    endpoint = await until("the fake MCP url", async () => {
      const text = existsSync(join(home, "fake.url")) ? readFileSync(join(home, "fake.url"), "utf8").trim() : ""
      return text || false
    }, { timeoutMs: 25000 })
    fake.url = endpoint
    fake.port = fakePort
  }

  // The plugin's own build, copied into the run directory; its one endpoint is pointed at the fake.
  const pluginDir = join(runDir, "plugin")
  const replaced = materialise({ repo: plugin.repo, into: pluginDir, endpoint })

  const config = {
    plugins: [
      { package: join(ROOT, "src/t1/capture") },
      { package: join(ROOT, "src/t1/mock/provider") },
      { package: pluginDir, ...(plugin.options ? { options: plugin.options } : {}) },
    ],
    model: "mock/m1",
    providers: { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
  }
  // `OPENCODE_CONFIG_CONTENT` seals the config: no config file from the machine, the user or a project is
  // read, which is what keeps the owner's plugins, MCP servers and agents out of an eval run.
  writeFileSync(join(home, ".config", "opencode", "opencode.json"), JSON.stringify(config, null, 2))
  const sealed = JSON.stringify(config)

  // A clean environment, as the plugins' own host tests do: nothing of the runner's OpenCode, provider
  // keys or proxies is inherited, and OPENCODE_TEST_HOME is what stops the host reading the real user's
  // data directory (which is where a running service's plugins and MCP servers would otherwise come from).
  const inherited = {}
  for (const key of ["PATH", "LANG", "TZ", "TERM"]) if (process.env[key]) inherited[key] = process.env[key]
  const hostEnv = {
    ...inherited,
    HOME: home,
    OPENCODE_TEST_HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    TMPDIR: join(home, "tmp"),
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    LANG: "en_US.UTF-8",
    OPENCODE_PASSWORD: password,
    OPENCODE_CONFIG_CONTENT: sealed,
    OPENCODE_CONFIG_DIR: join(home, ".config", "opencode"),
    // The database is per-run too: the host keeps agents, MCP state and settings in it.
    OPENCODE_DB: join(home, "opencode.db"),
    OPENCODE_DISABLE_FILEWATCHER: "1",
    SPIKE_MOCK_URL: `http://127.0.0.1:${mockPort}/v1`,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_FREE_MODELS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    // No proxy at all: a proxy pointed at a dead port also stops the loopback MCP client from reaching the
    // fake, which made the stock host unable to register the plugin's tools.
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
    EVALS_CAPTURE_OUT: captureOut ?? join(runDir, "capture.jsonl"),
    EVALS_RUN_ID: runId,
    ...env,
  }
  const log = createWriteStream(join(runDir, "serve.log"))
  const server = track(spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: project, env: hostEnv, stdio: ["ignore", "pipe", "pipe"] }))
  server.stdout.on("data", (data) => log.write(data))
  server.stderr.on("data", (data) => log.write(data))

  const url = `http://127.0.0.1:${port}`
  process.env.EVALS_HOST_PASSWORD = password
  await until(`${plugin.name} to answer`, async () => (await call(`${url}/api/agent`)).ok, { timeoutMs: 60000 })

  return {
    version,
    pluginDir,
    replaced,
    url,
    binary,
    home,
    project,
    port,
    mockPort,
    mockLog,
    fake,
    password,
    hostEnv,
    async turn(prompt, { model = "mock/m1", timeoutMs = 90000 } = {}) {
      const out = join(runDir, `turn-${Date.now()}.jsonl`)
      const child = track(
        spawn(binary, ["run", "--server", url, "--format", "json", "-m", model, prompt], {
          cwd: project,
          env: hostEnv,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      )
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (data) => (stdout += data))
      child.stderr.on("data", (data) => (stderr += data))
      const exit = await new Promise((done) => {
        const timer = setTimeout(() => {
          try {
            child.kill("SIGKILL")
          } catch {
            // gone
          }
          done("timeout")
        }, timeoutMs)
        child.on("exit", (code) => {
          clearTimeout(timer)
          done(code)
        })
      })
      writeFileSync(out, stdout)
      return { exit, stdout, stderr, lines: stdout.split("\n").filter(Boolean) }
    },
  }
}

export const mockRequests = (logPath) =>
  existsSync(logPath)
    ? readFileSync(logPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter((entry) => entry?.ev === "request")
    : []

export const fakeCalls = (home) => {
  const file = join(home, "fake.calls.json")
  if (!existsSync(file)) return { calls: [], arguments: [] }
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return { calls: [], arguments: [] }
  }
}

export const captureLines = (path) =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter(Boolean)
    : []

export { ROOT }
export const isDirectory = (path) => existsSync(path) && statSync(path).isDirectory()
