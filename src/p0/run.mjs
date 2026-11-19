// The P0 probes' runner: one batch of scripted trials (the harness's own mock model, no credential, no vendor reached),
// each trial one `[[mock:tool:<name>:<json>]]` directive, and the recordings read back as plain facts.
//
// Nothing here talks to a vendor or a paid model: the scripted model costs nothing, a dummy value stands in for any
// credential, and every trial runs in the harness's container with its egress proxy, whose log is read afterwards.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { runBatch } from "../run/runner.mjs"
import { compileCase } from "../case/compile.mjs"
import { DATA_MINIMUM } from "../case/schema.mjs"
import { summarize, DECLINED_MARKER } from "../trace/analyse.mjs"

/** `[[mock:tool:<name>:<json>]]`: the scripted model's one tool call. The arguments may not contain `]`. */
export const mock = (tool, args = {}) => {
  const json = JSON.stringify(args)
  if (json.includes("]")) throw new Error(`a scripted call's arguments cannot contain "]": ${json.slice(0, 60)}`)
  return `[[mock:tool:${tool}:${json}]]`
}

/** A Code Mode `execute` that runs this code. The code may not contain `]`: use `.map(...)` and `.join(...)`, not indexing. */
export const execute = (code) => mock("execute", { code })

const caseText = (id, prompt, extra, plugin = "p0", data = "synthetic") => `# ${id}
- Plugin: ${plugin}
- Skill under test: ${plugin}
- Tier: T3
- Source: probe
- Decision tested: probe
- Data: ${data}
${extra ?? ""}
## Prompt
${prompt}

## Items
- [PZ-OC01] minor · It answers something.
  evidence: text:any matches /./
`

/** The tool calls of a recording: `{ tool, status, input, output, error }`, in order. */
export function toolUses(rawLines) {
  const out = []
  for (const line of rawLines) {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type !== "tool_use") continue
    const part = event.part ?? {}
    const state = part.state ?? {}
    out.push({ tool: part.tool, status: state.status, input: state.input, output: typeof state.output === "string" ? state.output : state.output === undefined ? undefined : JSON.stringify(state.output), error: state.error })
  }
  return out
}

const readLines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [])

/**
 * Runs the cases as one scripted batch and returns what each did.
 *   cases      [{ id, prompt }]
 *   arm        { package: dir | "none", options?, companions?, guard? }, written to an arm file as `evals run` reads it
 *   caller     extra environment for the runner (EVALS_ROUND_CEILING_USD, EVALS_MOCK_USAGE, …)
 *   options    extra runBatch options (tools, guardMode, noWriteAsks, probe, auth, trials, parallel, …)
 */
export async function scriptedRun({ cases, arm = { package: "none" }, caller = {}, options = {}, tmp, env = process.env, keep = false, prepare = null, plugin = "p0" } = {}) {
  const root = mkdtempSync(join(tmp ?? env.TMPDIR ?? "/tmp", "evals-p0-"))
  const casesDir = join(root, "cases")
  mkdirSync(casesDir)
  for (const c of cases) {
    // A probe of a plugin's own tools is a wide case of that plugin (its id `tools-...`), with the least `Data:` its reads allow.
    const own = plugin !== "p0"
    const text = caseText(c.id, c.prompt, own && !/Set:/.test(c.extra ?? "") ? `- Set: wide\n${c.extra ?? ""}` : c.extra, plugin, own ? DATA_MINIMUM[plugin] ?? "seeded" : "synthetic")
    writeFileSync(join(casesDir, `${c.id}.md`), text)
    writeFileSync(join(casesDir, `${c.id}.json`), JSON.stringify(compileCase(`cases/${plugin}/${c.id}.md`, text)))
  }
  const armFile = join(root, "arm.json")
  writeFileSync(armFile, `${JSON.stringify(arm)}\n`)
  const store = options.store ?? join(root, "store")
  const sandboxes = join(root, "tmp")
  mkdirSync(sandboxes, { recursive: true })
  const callerEnv = { PATH: env.PATH, HOME: root, EVALS_STORE: store, EVALS_OPENCODE_BIN: env.EVALS_OPENCODE_BIN ?? env.OPENCODE_BIN_2_3_2 ?? "opencode", EVALS_TMP: sandboxes, ...(env.EVALS_BUN ? { EVALS_BUN: env.EVALS_BUN } : {}), ...(env.EVALS_CONTAINER_IMAGE ? { EVALS_CONTAINER_IMAGE: env.EVALS_CONTAINER_IMAGE } : {}), ...caller }
  // A probe that needs something in the caller's home (a dummy sign-in) makes it here, before the batch starts.
  if (prepare) await prepare(root, callerEnv)
  const log = []
  const iteration = options.iteration ?? "p0"
  const result = await runBatch({ plugin, iteration, model: "mock/m1", auth: "none", scripted: true, isolation: "container", casesDir, set: "all", arm: armFile, ...options, store: undefined }, { caller: callerEnv, log: (line) => log.push(line) })
  const raw = join(store, "raw", iteration, plugin)
  const trials = {}
  for (const c of cases) {
    const base = join(raw, `${c.id}.t1`)
    const lines = readLines(`${base}.jsonl`)
    const summaryFile = `${base}.summary.json`
    const summary = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, "utf8")) : null
    trials[c.id] = { id: c.id, lines, calls: toolUses(lines), summary, guard: readLines(`${base}.guard.jsonl`).map((l) => JSON.parse(l)), analysed: summarize(lines, summary?.stderr ?? "") }
  }
  const everything = existsSync(raw) ? readdirSync(raw).map((name) => readFileSync(join(raw, name), "utf8")).join("\n") : ""
  for (const c of cases) trials[c.id].mock = readLines(join(raw, `${c.id}.t1.mock.jsonl`)).map((l) => JSON.parse(l))
  for (const c of cases) trials[c.id].capture = readLines(join(raw, `${c.id}.t1.capture.jsonl`)).map((l) => JSON.parse(l))
  return { root, store, raw, result, log, trials, everything, egress: result.egress ?? null, ledger: readLedgerFile(store), cleanup: () => rmSync(root, { recursive: true, force: true }), keep }
}

function readLedgerFile(store) {
  const file = join(store, "ledger", "runs.jsonl")
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []
}

/** The text a call ended with: its output or its error. */
export const textOf = (call) => String(call?.output ?? call?.error ?? "")

/** Did Code Mode's inner call decline (the run auto-rejected the ask)? */
export const declinedIn = (call) => textOf(call).includes(DECLINED_MARKER)

/** The JSON an `execute` returned (its output is a JSON-encoded string), or null. */
export function executeValue(call) {
  const text = textOf(call)
  try {
    const first = JSON.parse(text)
    return typeof first === "string" ? JSON.parse(first) : first
  } catch {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }
}

/** How the host refused a call: the shell, file, web and subagent tools are absent or denied, and Code Mode has no process. */
export const REFUSED = /No tool named|Permission denied|is currently available|not available|Unknown identifier|EVALS-ASSERT|Unknown tool|was rejected|cannot ask the user/i
export const refused = (call) => Boolean(call) && (call.status === "error" || REFUSED.test(textOf(call))) && REFUSED.test(textOf(call))
