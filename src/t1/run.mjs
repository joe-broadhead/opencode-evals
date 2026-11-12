// T1: run each plugin's pack on each tested host version, with no model and no network.
//
// Per (plugin, version) the harness starts the scripted model, the plugin's fake when it declares one, and
// one isolated host server; it reads the agent rules the plugin inserted, the tools RPC, the status RPC,
// and it drives one scripted turn per MCP case. Everything it learns is in `results/t1/<plugin>/<version>.json`.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { startHost, stopAll, availableVersions, fakeCalls, captureLines, stockBinary, TESTED } from "./harness.mjs"
import { checkRules, checkDescribe, checkStatus, checkScriptedTurn, checkRpcCall } from "./checks.mjs"

const summaryOf = (checks) => ({
  pass: checks.filter((c) => c.state === "pass").length,
  fail: checks.filter((c) => c.state === "fail").length,
  unsupported: checks.filter((c) => c.state === "unsupported").length,
})

/**
 * The scripted cases in groups, one per plugin options value: a case with its own `options` (an access mode) needs a
 * host started with them. The pack's own options come first, and their group also runs the host-level checks.
 */
export function optionGroups(pack) {
  const groups = new Map()
  const keyOf = (options) => JSON.stringify(options ?? null)
  groups.set(keyOf(pack.options), { options: pack.options ?? null, label: null, cases: [] })
  for (const caseDef of pack.t1 ?? []) {
    const options = caseDef.options ?? pack.options ?? null
    const key = keyOf(options)
    if (!groups.has(key)) groups.set(key, { options, label: options?.access ?? `options-${groups.size}`, cases: [] })
    groups.get(key).cases.push(caseDef)
  }
  return [...groups.values()]
}

/**
 * The effect each tool should resolve to under an access value (the family's one option): `all` keeps the declared
 * effects, `ask-changes` asks for every change, `read-only` denies them. Reads are never touched, and a tool declared
 * deny stays denied.
 */
export function toolsAt(pack, options) {
  const access = options?.access ?? pack.access?.default ?? "all"
  if (!pack.access || access === "all") return pack.tools
  const change = (tool) => tool.class === "write" || tool.class === "destructive"
  return (pack.tools ?? []).map((tool) => (!change(tool) || tool.effect === "deny" ? tool : { ...tool, effect: access === "read-only" ? "deny" : "ask" }))
}

/** One (plugin, version) run: a host per options group. */
export async function runOne({ pack, version, store, fakeModule }) {
  const checks = []
  for (const group of optionGroups(pack)) {
    if (group.label && !group.cases.length) continue
    const found = await runGroup({ pack: { ...pack, tools: toolsAt(pack, group.options), options: group.options ?? undefined, t1: group.cases }, version, store, fakeModule, label: group.label })
    checks.push(...(group.label ? found.map((check) => ({ ...check, id: `${check.id}@${group.label}` })) : found))
  }
  const result = {
    plugin: pack.id,
    version,
    harness: "0.1.0-dev",
    host: { version, binary: stockBinary(version) },
    counts: pack.counts,
    summary: summaryOf(checks),
    checks,
    ran_at: new Date().toISOString(),
  }
  const out = join(store, "results", "t1", pack.id)
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, `${version}.json`), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

async function runGroup({ pack, version, store, fakeModule, label }) {
  const runDir = join(store, "t1", pack.id, label ? `${version}-${label}` : version)
  mkdirSync(runDir, { recursive: true })
  const captureOut = join(runDir, "capture.jsonl")
  writeFileSync(captureOut, "")
  const checks = []
  let host = null
  try {
    host = await startHost({
      version,
      plugin: { name: pack.name ?? pack.id, repo: pack.repo, id: pack.id, options: pack.options },
      runDir,
      fakeModule: pack.fake ? fakeModule : null,
      fakePluginOptions: {},
      captureOut,
      runId: `${pack.id}@${version}`,
    })
    const loaded = captureLines(captureOut).find((event) => event.kind === "capture_start")
    const snapshots = captureLines(captureOut).filter((event) => event.kind === "tools")
    const tools = snapshots.find((event) => event.phase === "late") ?? snapshots[snapshots.length - 1]
    checks.push({
      id: `${pack.id}-loads`,
      kind: "loads",
      state: loaded ? "pass" : "fail",
      detail: loaded ? `loaded in pid ${loaded.pid}, ${tools?.count ?? 0} tools registered` : "the capture plugin never started",
      evidence: { pid: loaded?.pid ?? null, tools: tools?.count ?? null, replaced: host.replaced },
    })
    // The rules the plugin inserts, read from the host's resolved agents.
    checks.push(await checkRules(host, pack))
    if (pack.rpc) {
      checks.push(await checkDescribe(host, pack))
      checks.push(await checkStatus(host, pack))
    }
    // A scripted turn per case: the model asks for one tool, and the host's answer is the record. Only when
    // the plugin's own tools are registered in this host: a tool that never arrived cannot be asked for, and
    // "not asked" would be a statement about the harness, not the plugin.
    const registered = (captureLines(captureOut).filter((event) => event.kind === "tools").pop()?.tools ?? []).map((tool) => tool.id)
    const own = registered.filter((id) => (pack.tools ?? []).some((tool) => id.toLowerCase().includes(String(tool.name).toLowerCase())))
    for (const caseDef of pack.t1 ?? []) {
      if (!own.length) {
        checks.push({ id: `${pack.id}-${caseDef.kind}-${caseDef.tool}`, kind: caseDef.kind, state: "unsupported", detail: `the host registered none of this plugin's tools (${registered.length} tools), so a scripted call cannot reach it`, evidence: { tools: registered.length } })
        continue
      }
      const result = await host.turn(caseDef.prompt)
      checks.push({ ...checkScriptedTurn({ pack, caseDef, result, capture: captureLines(captureOut), fakeCalls: fakeCalls(host.home).calls ?? [] }), turn: { exit: result.exit, lines: result.lines.length } })
    }
    // The shapers: the tools RPC runs them, and a direct executor call does not (the host skips the hooks).
    for (const caseDef of (pack.t1 ?? []).filter((entry) => entry.kind === "capped")) {
      checks.push(await checkRpcCall({ host, pack, caseDef, fakeCalls: fakeCalls(host.home).arguments ?? [] }))
    }
  } catch (error) {
    checks.push({ id: `${pack.id}-harness`, kind: "harness", state: "fail", detail: String(error.message ?? error).slice(0, 300), evidence: {} })
  } finally {
    await stopAll()
  }
  return checks
}

/** The in-process SDK run: the checks a direct executor call can settle, with no model. */
async function sdkRun({ pack, store, log }) {
  const sdkDir = process.env.EVALS_SDK_DIR
  if (!sdkDir) return null
  const { spawnSync } = await import("node:child_process")
  const root = join(import.meta.dirname, "..", "..")
  log(`t1 ${pack.id} sdk`)
  const child = spawnSync(
    process.env.EVALS_BUN ?? "bun",
    [join(root, "src/t1/sdk/run.mjs"), "--plugin", pack.id],
    { encoding: "utf8", timeout: 180000, env: { ...process.env, EVALS_VERSION: sdkVersion() } },
  )
  const line = String(child.stdout ?? "").trim().split("\n").filter(Boolean).pop()
  if (!line) return { plugin: pack.id, version: sdkVersion(), checks: [{ id: `${pack.id}-sdk`, kind: "harness", state: "fail", detail: String(child.stderr ?? "").slice(0, 300), evidence: {} }] }
  try {
    return JSON.parse(line)
  } catch {
    return { plugin: pack.id, version: sdkVersion(), checks: [{ id: `${pack.id}-sdk`, kind: "harness", state: "fail", detail: "unreadable sdk output", evidence: {} }] }
  }
}

function sdkVersion() {
  try {
    return JSON.parse(readFileSync(join(process.env.EVALS_SDK_DIR, "node_modules", "@opencode", "plugin", "package.json"), "utf8")).version
  } catch {
    return "sdk"
  }
}

/** Every plugin on every available version, one at a time (each holds a check slot). */
export async function runT1({ packs, store, versions = availableVersions(), fakeModule, log = () => {} }) {
  const all = []
  for (const pack of packs) {
    const sdk = await sdkRun({ pack, store, log })
    if (sdk) all.push({ ...sdk, plugin: pack.id, checks: sdk.checks ?? [] })
    for (const version of versions) {
      log(`t1 ${pack.id} ${version}`)
      all.push(await runOne({ pack, version, store, fakeModule }))
    }
  }
  // Merge the two runners per (plugin, version): one record per host version.
  const merged = new Map()
  for (const result of all) {
    for (const check of result.checks ?? []) {
      const key = `${result.plugin}@${result.version}`
      const record = merged.get(key) ?? { plugin: result.plugin, version: result.version, checks: [] }
      if (!record.checks.some((existing) => existing.id === check.id)) record.checks.push(check)
      merged.set(key, record)
    }
  }
  const out = [...merged.values()].map((record) => ({
    ...record,
    summary: {
      pass: record.checks.filter((c) => c.state === "pass").length,
      fail: record.checks.filter((c) => c.state === "fail").length,
      unsupported: record.checks.filter((c) => c.state === "unsupported").length,
    },
  }))
  for (const record of out) {
    const dir = join(store, "results", "t1", record.plugin)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${record.version}.json`), `${JSON.stringify(record, null, 2)}\n`)
  }
  return out
}

/** The coverage table: plugins down, host versions across. */
export function coverageTable(results) {
  const plugins = [...new Set(results.map((r) => r.plugin))]
  const versions = TESTED
  const cell = (plugin, version) => {
    const found = results.find((r) => r.plugin === plugin && r.version === version)
    if (!found) return "—"
    const { pass, fail, unsupported } = found.summary
    return fail ? `**${pass}p/${fail}f**` : `${pass}p${unsupported ? `/${unsupported}u` : ""}`
  }
  const lines = [
    "| plugin | " + versions.join(" | ") + " |",
    "| --- | " + versions.map(() => "---").join(" | ") + " |",
    ...plugins.map((plugin) => `| ${plugin} | ${versions.map((version) => cell(plugin, version)).join(" | ")} |`),
  ]
  return { lines, plugins, versions }
}
