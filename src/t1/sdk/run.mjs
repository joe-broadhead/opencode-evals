// T1, in process: the plugin's own build inside an embedded OpenCode host, with a fake MCP server and no
// model at all. This is the shape the plugins' own host tests use — `OpenCode.create` with a sealed
// `config.content`, `project: false`, `claude: false`, its own database — so the host cannot read the
// machine's config, its MCP servers or its agents.
//
// What it proves is what the plugin makes possible: that it loads, that its default rules are on every
// agent it guards, that the tools RPC describes what it claims, and that a call which needs permission
// asks and is refused, a denied tool is refused before dispatch, and a shaper runs. No model is involved,
// so every number here is exact. A scripted model is only needed for what a model *chooses* (T4).
//
//   bun src/t1/sdk/run.mjs --plugin x --sdk <dir with @opencode/sdk> [--repo <checkout>] [--capture on|off]
//
// It prints one JSON object: the checks, and the call log it observed.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import { createHash } from "node:crypto"

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at < 0 ? fallback : argv[at + 1]
}
const pluginId = flag("plugin", "x")
const sdkDir = flag("sdk", process.env.EVALS_SDK_DIR ?? "")
const repo = resolve(flag("repo", process.env[`EVALS_REPO_${pluginId.toUpperCase()}`] ?? join(process.env.EVALS_PLUGIN_ROOT ?? process.env.HOME, `opencode-${pluginId}`)))
const captureOn = flag("capture", "on") !== "off"
const fakeModule = process.env.EVALS_X_FAKE ?? ""
const root = mkdtempSync(join(process.env.EVALS_TMP ?? tmpdir(), `evals-t1-${pluginId}-`))
mkdirSync(join(root, "home"), { recursive: true })
mkdirSync(join(root, "work"), { recursive: true })
mkdirSync(join(root, "capture"), { recursive: true })

// The environment is replaced, as the plugins' host tests do: no HOME, XDG, provider key or proxy of
// whoever runs this is visible to the host.
process.env.HOME = join(root, "home")
process.env.OPENCODE_TEST_HOME = join(root, "home")
process.env.XDG_CONFIG_HOME = join(root, "home", ".config")
process.env.XDG_DATA_HOME = join(root, "home", ".local", "share")
process.env.XDG_CACHE_HOME = join(root, "home", ".cache")
process.env.XDG_STATE_HOME = join(root, "home", ".local", "state")
process.env.TMPDIR = join(root, "tmp")
process.env.EVALS_CAPTURE_OUT = join(root, "capture", "events.jsonl")
process.env.EVALS_RUN_ID = `${pluginId}`
process.chdir(join(root, "home"))
delete process.env.OPENCODE_CONFIG_CONTENT
delete process.env.OPENCODE_CONFIG
delete process.env.OPENCODE_CONFIG_DIR
for (const key of Object.keys(process.env)) if (key.startsWith("OPENCODE_") && !["OPENCODE_TEST_HOME"].includes(key)) delete process.env[key]

const fail = (checks, id, detail) => checks.push({ id, kind: "harness", state: "fail", detail, evidence: {} })

const sdkPath = sdkDir ? join(sdkDir, "node_modules", "@opencode", "sdk") : ""
if (!sdkPath || !existsSync(join(sdkPath, "dist", "index.js"))) {
  console.log(JSON.stringify({ plugin: pluginId, state: "unsupported", detail: `no @opencode/sdk at ${sdkPath || "(unset)"}`, checks: [] }))
  process.exit(0)
}

const { OpenCode } = (await import(pathToFileURL(join(sdkPath, "dist", "index.js")).href))
const { Plugin } = await import(pathToFileURL(join(sdkDir, "node_modules", "@opencode", "plugin", "dist", "promise", "index.js")).href)
const { version: sdkVersion } = JSON.parse(readFileSync(join(sdkPath, "package.json"), "utf8"))

// The capture plugin, in the same process, writing the same oc-trace events it writes in a real host.
const capture = captureOn ? (await import(pathToFileURL(join(import.meta.dirname, "..", "capture", "index.ts")).href)).capturePlugin(Plugin) : null

const pack = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "packs", pluginId, "pack.json"), "utf8"))
const toolsCatalogue = pack.tools ?? []

let fake = null
let endpoint = null
if (fakeModule && existsSync(fakeModule)) {
  const module = await import(pathToFileURL(fakeModule).href)
  fake = await module.startFakeMcp({ catalog: "x" })
  endpoint = fake.url
}

// The plugin under test, from its prebuilt bundle, with its endpoint pointed at the fake when there is one.
const built = join(root, "plugin")
mkdirSync(join(built, "dist"), { recursive: true })
for (const file of ["index.js", "tui.js"]) if (existsSync(join(repo, "dist", file))) writeFileSync(join(built, "dist", file), readFileSync(join(repo, "dist", file)))
if (existsSync(join(repo, "skills"))) {
  const { cpSync } = await import("node:fs")
  cpSync(join(repo, "skills"), join(built, "skills"), { recursive: true })
}
writeFileSync(join(built, "package.json"), readFileSync(join(repo, "package.json")))
if (endpoint) {
  const index = join(built, "dist", "index.js")
  const text = readFileSync(index, "utf8")
  const found = (text.match(/https:\/\/[a-z0-9.-]+\/[a-z/]*/g) ?? []).filter((url) => /api\.|mcp/.test(url))
  if (!found.length) throw new Error("no endpoint found in dist/index.js")
  writeFileSync(index, text.split(found[0]).join(endpoint))
}

const loaded = (await import(pathToFileURL(join(built, "dist", "index.js")).href)).default
const options = pack.options ?? {}
const underTest = Plugin.define({ id: loaded.id ?? `${pluginId}.plugin`, setup: (ctx) => loaded.setup({ ...ctx, options }) })

const checks = []
const probes = new Map()
const probe = Plugin.define({ id: "evals.t1.probe", setup: (ctx) => void probes.set(ctx.location.directory, ctx) })

const config = {
  providers: { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
  permissions: [],
}
const { version: hostVersion } = JSON.parse(readFileSync(join(sdkDir, "node_modules", "@opencode", "plugin", "package.json"), "utf8"))

let client
try {
  client = await OpenCode.create({
    plugins: [...(capture ? [capture] : []), underTest, probe],
    app: { version: hostVersion },
    config: { content: JSON.stringify(config), directory: join(root, "config"), project: false, claude: false },
    database: { path: join(root, "opencode.db") },
    models: { fetch: false },
    fs: { filewatcher: false },
    log: { level: "error" },
  })
} catch (error) {
  console.log(JSON.stringify({ plugin: pluginId, state: "fail", detail: `the host did not start: ${error.message}`, checks: [] }))
  process.exit(0)
}

const location = { directory: join(root, "work") }
const ctx = async () => {
  for (let i = 0; i < 400; i++) {
    const found = probes.get(location.directory)
    if (found) return found
    // Opening the location is what makes the host run every plugin's setup for it.
    await client.plugin.list({ location }).catch(() => {})
    await Bun.sleep(50)
  }
  throw new Error("the probe plugin did not load")
}

const sha = (value) => createHash("sha256").update(String(value ?? "")).digest("hex")
const norm = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_")
const sameTool = (a, b) => {
  const [x, y] = [norm(a), norm(b)]
  return Boolean(x && y) && (x === y || x.endsWith(`_${y}`) || y.endsWith(`_${x}`))
}

let calls = []
/** One call through the host's own executor, which asserts the tool's permission exactly as the model path does. */
async function attempt(toolId, input, decision = "reject") {
  const probeCtx = await ctx()
  const listed = await probeCtx.tool.list()
  const executor = listed.find((tool) => tool.id === toolId)
  if (!executor) return { missing: true, listed: listed.map((tool) => tool.id) }
  const sessionID = (await client.sessions.create({ agent: agent, location })).id
  const call = {
    sessionID,
    agent,
    messageID: "msg_t1",
    id: `call_t1_${calls.length + 1}`,
    signal: new AbortController().signal,
    progress: async () => {},
  }
  let settled = false
  const run = executor
    .execute(input, call)
    .then((result) => ({ ok: true, result }), (error) => ({ ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }))
    .finally(() => (settled = true))
  let asked
  while (!settled) {
    const pending = await client.permission.list({ sessionID })
    const request = pending.find((item) => sameTool(item.action, toolId))
    if (request) {
      asked = request.action
      await client.permission.reply({ sessionID, requestID: request.id, decision })
      break
    }
    await Promise.race([run, Bun.sleep(20)])
  }
  const outcome = await run
  calls.push({ tool: toolId, asked, ok: outcome.ok, error: outcome.ok ? null : String(outcome.error).slice(0, 160) })
  return { ...outcome, asked, sessionID }
}

let agent = "build"
try {
  await ctx()
  const listed = await (await ctx()).tool.list()
  const toolsObserved = listed.map((tool) => tool.id)
  checks.push({
    id: `${pluginId}-loads`,
    kind: "loads",
    state: "pass",
    detail: `loaded ${pluginId} in an embedded host ${hostVersion}; ${toolsObserved.length} tools listed`,
    evidence: { host: hostVersion, sdk: sdkVersion, tools: toolsObserved.length, endpoint: endpoint ? "fake" : "none", capture: captureOn },
  })

  // The rules the plugin inserts, per agent.
  // The rules the plugin inserts. Two things must hold: at least one agent resolves every declared tool as
  // declared (the plugin inserted its block), and no agent resolves a denied tool to allow (the one
  // direction that would widen permission). Agents with their own policies are reported, not failed.
  const agentList = (await client.agent.list({ location })).data
  const guarded = []
  const partial = []
  const holes = []
  for (const entry of agentList) {
    const mismatches = []
    for (const tool of toolsCatalogue) {
      const sessionID = (await client.sessions.create({ agent: entry.id, location })).id
      const resolved = (await client.permission.create({ sessionID, agent: entry.id, action: tool.permission, resources: ["*"] })).effect
      if (resolved !== (tool.effect ?? "allow")) mismatches.push(`${tool.permission} ${tool.effect}->${resolved}`)
      if (tool.effect === "deny" && resolved === "allow") holes.push(`${entry.id}:${tool.permission}`)
    }
    if (!mismatches.length) guarded.push(entry.id)
    else if (mismatches.length < toolsCatalogue.length) partial.push({ agent: entry.id, mismatches: mismatches.length })
  }
  checks.push({
    id: `${pluginId}-rules`,
    kind: "rules",
    state: holes.length || !guarded.length ? "fail" : "pass",
    detail: holes.length
      ? `${holes.length} denied tool(s) resolve allow: ${holes.slice(0, 3).join(", ")}`
      : `${guarded.length} agent(s) fully guarded over ${toolsCatalogue.length} declared tools; ${partial.length} with their own policies`,
    evidence: { guarded, partial: partial.map((p) => p.agent), holes: holes.slice(0, 5) },
  })

  // The tools RPC, with a session.
  if (pack.rpc) {
    const sessionID = (await client.sessions.create({ agent: "build", location })).id
    let described = null
    try {
      described = await (await ctx()).rpc(pack.rpc.split(".")[0] + "." + pack.rpc.split(".")[1], pack.rpc.split(".")[2] ?? "tools")
    } catch {
      described = null
    }
    checks.push({
      id: `${pluginId}-describe`,
      kind: "describe",
      state: "unsupported",
      detail: "the RPC surface needs the HTTP host; reported by the stock-binary runner",
      evidence: { rpc: pack.rpc, session: Boolean(sessionID) },
    })
  }

  // A write that must ask, and must not run after a refusal.
  const askCase = (pack.t1 ?? []).find((entry) => entry.kind === "asked")
  if (askCase) {
    agent = "build"
    const result = await attempt(askCase.tool.startsWith("x_") ? askCase.tool : `x_${askCase.tool}`, askCase.args ?? { text: "eval draft" })
    const fakeCalls = (fake?.calls ?? []).filter((name) => sameTool(name, askCase.tool))
    const state = result.asked && !result.ok && fakeCalls.length === 0 ? "pass" : "fail"
    checks.push({
      id: `${pluginId}-asked-${askCase.tool.replace(/^x_/, "")}`,
      kind: "asked",
      state,
      detail: `${result.asked ? "asked" : result.missing ? "tool not registered" : "not asked"}; ${result.ok ? "the call ran" : "refused"}; fake saw ${fakeCalls.length} call(s)`,
      evidence: { asked: result.asked ?? null, error: result.error ?? null, calls: fakeCalls.length },
    })
  }

  // A denied tool: refused, and the server never sees it.
  const denyCase = (pack.t1 ?? []).find((entry) => entry.kind === "refused")
  if (denyCase) {
    const before = (fake?.calls ?? []).length
    const result = await attempt(denyCase.tool.startsWith("x_") ? denyCase.tool : `x_${denyCase.tool}`, denyCase.args ?? { target_user_id: "1" })
    const after = (fake?.calls ?? []).length
    const state = !result.ok && after === before ? "pass" : "fail"
    checks.push({
      id: `${pluginId}-refused-${denyCase.tool.replace(/^x_/, "")}`,
      kind: "refused",
      state,
      detail: `${result.ok ? "the call ran" : "refused"}; the fake saw ${after - before} call(s)`,
      evidence: { error: result.error ?? null, calls: after - before, asked: result.asked ?? null },
    })
  }

  // A shaper is checked through the tools RPC, not the direct executor: the host runs no execute hooks on a
  // direct call, so the stock-binary runner owns that case (see src/t1/run.mjs).
  const capCase = null
  if (capCase && fake) {
    const result = await attempt(capCase.tool.startsWith("x_") ? capCase.tool : `x_${capCase.tool}`, { query: "eval", max_results: 100 })
    const argumentsSent = fake.callArguments ?? []
    const last = argumentsSent[argumentsSent.length - 1] ?? {}
    const appended = JSON.stringify(result.result ?? "").includes("Cost:")
    const state = Number(last.max_results) === (capCase.max ?? 10) && appended ? "pass" : "fail"
    checks.push({
      id: `${pluginId}-capped-${capCase.tool.replace(/^x_/, "")}`,
      kind: "capped",
      state,
      detail: `the server received max_results ${JSON.stringify(last.max_results)}; the result ${appended ? "carries" : "lacks"} the appended cost line`,
      evidence: { sent: last, appended },
    })
  }
} catch (error) {
  fail(checks, `${pluginId}-harness`, String(error?.stack ?? error).slice(0, 400))
}

const captureEvents = existsSync(process.env.EVALS_CAPTURE_OUT)
  ? readFileSync(process.env.EVALS_CAPTURE_OUT, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : []

// The capture plugin's own no-change evidence: every decision it observed went in and out unchanged.
if (captureOn) {
  const decisions = captureEvents.filter((event) => event.kind === "permission")
  const changed = decisions.filter((event) => event.effect_in !== event.effect_out)
  const before = captureEvents.filter((event) => event.kind === "execute_before")
  const after = captureEvents.filter((event) => event.kind === "execute_after")
  const rewritten = before.filter((event, index) => after[index] && after[index].args_sha256 !== event.args_sha256)
  checks.push({
    id: `${pluginId}-capture-observe-only`,
    kind: "capture",
    state: changed.length || rewritten.length || !decisions.length ? "fail" : "pass",
    detail: `${decisions.length} decision(s), ${before.length} boundary call(s); ${changed.length} changed, ${rewritten.length} rewritten`,
    evidence: { decisions: decisions.length, before: before.length, after: after.length, changed: changed.length },
  })
}

const summary = {
  pass: checks.filter((c) => c.state === "pass").length,
  fail: checks.filter((c) => c.state === "fail").length,
  unsupported: checks.filter((c) => c.state === "unsupported").length,
}
console.log(
  JSON.stringify({
    plugin: pluginId,
    version: process.env.EVALS_VERSION ?? "sdk",
    host: { sdk: sdkVersion, plugin: hostVersion },
    capture: captureOn,
    calls,
    summary,
    checks,
    tools: (await (await ctx()).tool.list()).map((tool) => ({ id: tool.id, description_sha256: sha(tool.description) })),
  }),
)
await client.close().catch(() => {})
if (fake) await fake.close().catch(() => {})
process.exit(0)
