// The P0 probes' runner: one batch of scripted trials (the harness's own mock model, no credential, no vendor reached),
// each trial one `[[mock:tool:<name>:<json>]]` directive, and the recordings read back as plain facts.
//
// Nothing here talks to a vendor or a paid model: the scripted model costs nothing, a dummy value stands in for any
// credential, and every trial runs in the harness's container with its egress proxy, whose log is read afterwards.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { runBatch } from "../run/runner.mjs"
import { capsFile } from "../cost/ledger.mjs"
import { rawRoot } from "../store.mjs"
import { compileCase } from "../case/compile.mjs"
import { DATA_MINIMUM, fakeModePlugins } from "../case/schema.mjs"
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
 *   ownerStore a vendor probe's real store: caps.json, targets.json, data-matrix.json, canaries.json and the ledger are
 *              the owner's (the vendor spend counts in the round's caps); only the recordings stay in the probe's raw
 */
export async function scriptedRun({ cases, arm = { package: "none" }, caller = {}, options = {}, tmp, env = process.env, keep = false, prepare = null, plugin = "p0", expectStop = false, ownerStore = null, run = runBatch } = {}) {
  const root = mkdtempSync(join(tmp ?? env.TMPDIR ?? "/tmp", "evals-p0-"))
  const casesDir = join(root, "cases")
  mkdirSync(casesDir)
  for (const c of cases) {
    // A probe of a plugin's own tools is a wide case of that plugin (its id `tools-...`), with the least `Data:` its reads allow.
    const own = plugin !== "p0"
    const text = caseText(c.id, c.prompt, own && !/Set:/.test(c.extra ?? "") ? `- Set: wide\n${c.extra ?? ""}` : c.extra, plugin, own ? (fakeModePlugins().has(plugin) ? "synthetic" : DATA_MINIMUM[plugin] ?? "seeded") : "synthetic")
    writeFileSync(join(casesDir, `${c.id}.md`), text)
    writeFileSync(join(casesDir, `${c.id}.json`), JSON.stringify(compileCase(`cases/${plugin}/${c.id}.md`, text)))
  }
  const armFile = join(root, "arm.json")
  writeFileSync(armFile, `${JSON.stringify(arm)}\n`)
  const store = options.store ?? join(root, "store")
  const sandboxes = join(root, "tmp")
  const rawBase = join(root, "raw")
  mkdirSync(sandboxes, { recursive: true })
  const callerEnv = { PATH: env.PATH, HOME: root, EVALS_STORE: store, EVALS_OPENCODE_BIN: env.EVALS_OPENCODE_BIN ?? env.OPENCODE_BIN_2_3_2 ?? "opencode", EVALS_TMP: sandboxes, ...(env.EVALS_BUN ? { EVALS_BUN: env.EVALS_BUN } : {}), ...(env.EVALS_CONTAINER_IMAGE ? { EVALS_CONTAINER_IMAGE: env.EVALS_CONTAINER_IMAGE } : {}), ...caller, EVALS_RAW: rawBase }
  // A vendor probe (p7, live, gws) runs against the owner's store: caps.json (the vendor caps, the container assets and
  // limits), targets.json, data-matrix.json and canaries.json are the owner's, and the real ledger records the spend so
  // the round's caps count it. Only the recordings stay here, under EVALS_RAW, and are removed with the probe.
  if (ownerStore) {
    callerEnv.EVALS_STORE = ownerStore
    callerEnv.EVALS_CAPS = callerEnv.EVALS_CAPS ?? capsFile(ownerStore, callerEnv)
  } else {
    // No owner store: every input and the ledger are the scratch store's (the scratch store's own caps.json if any).
    callerEnv.EVALS_STORE = store
  }
  // A probe that needs something in the caller's home (a dummy sign-in) makes it here, before the batch starts.
  if (prepare) await prepare(root, callerEnv)
  const log = []
  const iteration = options.iteration ?? "p0"
  const result = await run({ plugin, iteration, model: "mock/m1", auth: "none", scripted: true, isolation: "container", casesDir, set: "all", arm: armFile, ...options, store: undefined }, { caller: callerEnv, log: (line) => log.push(line) })
  const raw = join(rawRoot(callerEnv), iteration, plugin)
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
  for (const c of cases) trials[c.id].fake = Object.fromEntries(readdirSync(raw).filter((name) => name.startsWith(`${c.id}.t1.fake-`) && name.endsWith(".jsonl")).map((name) => [name.replace(`${c.id}.t1.fake-`, "").replace(/\.jsonl$/, ""), readLines(join(raw, name)).map((l) => JSON.parse(l))]))
  // What each fake plugin said of itself (its status RPC, read in the trial once the run was over), by plugin.
  for (const c of cases) trials[c.id].fakeStatus = Object.fromEntries(readdirSync(raw).filter((name) => name.startsWith(`${c.id}.t1.fake-`) && name.endsWith(".status.json")).map((name) => [name.replace(`${c.id}.t1.fake-`, "").replace(/\.status\.json$/, ""), readFileSync(join(raw, name), "utf8")]))
  for (const c of cases) {
    const outcome = (result.results ?? []).find((r) => r.case === c.id && r.trial === 1) ?? null
    trials[c.id].outcome = outcome
    const why = infraReason(trials[c.id], { outcome, log, stopped: result.stopped ?? null, expectStop })
    if (why) HUNG.push({ id: c.id, iteration, why })
    const restarts = trials[c.id].summary?.client_restarts ?? []
    if (restarts.length) NOTES.push({ id: c.id, iteration, why: `its client made no model request within ${Math.round(restarts[0].after_ms / 1000)} s and was restarted ${restarts.length === 1 ? "once" : `${restarts.length} times`}${diagnosisText(restarts[0].diagnosis)}` })
  }
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

// ---------------------------------------------------------------------------------------------- refused: an attempt that failed, never one that completed

/**
 * How a refusal reads. A refusal is a call that ENDED IN AN ERROR whose text is the guard's own marker AT THE START of the result (`EVALS-ASSERT tool: shell refused (…)`, `EVALS-ASSERT write: …`: not anywhere in it, because a bad-arguments error echoes the call's own arguments) or
 * the host's own first words (`No tool named …`, `Permission denied …`, `Unknown tool …`). The words are not looked for anywhere in the text: a completed `grep` whose
 * output holds "not available", or a `shell` that printed "FOO=Unknown tool", is a call that completed, and a safety probe that passes on one guards nothing
 * (review of #13, P2).
 */
export const GUARD_MARKER = /^\s*(?:Error:\s*)?EVALS-ASSERT (?:tool|write): [A-Za-z0-9_.-]+ refused \(/
export const HOST_REFUSAL = /^\s*(?:Error:\s*)?(?:No tool named|Permission denied|Unknown tool)\b/i
export const REFUSED = new RegExp(`${GUARD_MARKER.source}|${HOST_REFUSAL.source}`, "i")

/** An attempted call the guard or the host refused, and that did not complete: status `error` AND a refusal's own words. */
export const refused = (call) => Boolean(call) && call.status === "error" && (GUARD_MARKER.test(textOf(call)) || HOST_REFUSAL.test(textOf(call)))

/** An `execute` whose script tried a tool or a global and returned what the host answered (`refused: Permission denied: webfetch`): the script's own catch, with the host's words after it. */
export const refusedInCode = (call) => Boolean(call) && call.tool === "execute" && /^refused: (?:Permission denied|Unknown identifier|No tool named|Unknown tool)\b/.test(textOf(call).trim())

/** Did any call of the trial COMPLETE (other than Code Mode's own `execute`, whose completion says nothing of what its code tried)? */
export const completedCalls = (trial) => (trial?.calls ?? []).filter((call) => call.tool !== "execute" && call.status !== "error")

// ---------------------------------------------------------------------------------------------- a trial that never reached its model

/**
 * Why a trial is an infrastructure event and not an answer, or null. A trial that hung before its first model request (the client and its own server inside the trial made
 * no progress: found in 1 of 360 under load, killed at the 420 s timeout with an empty recording) has said nothing about any guarantee; a probe that reads its missing call as
 * "refused" or "not refused" is reading nothing.
 */
export function hungReason(trial) {
  const summary = trial?.summary
  if (summary?.infra === "no_model_request") return summary.infra_why ?? "the trial made no model request"
  const empty = (trial?.lines ?? []).length === 0
  if (summary && summary.exit === 124 && empty && (trial.mock ?? []).filter((e) => e.ev === "request").length === 0) return `killed at its timeout (exit 124) with an empty recording and no model request: the trial hung before its first request`
  return null
}

/**
 * Why a trial is an infrastructure event, or null: it hung before its first model request (`hungReason`), it left NO summary (the runner's own line for it, or that it was never launched), its
 * job failed (`infra: trial_error`, with the phase, the error and what Docker said of the container), or it was begun and never finished (`trial_incomplete`). A probe that reads such a
 * trial's missing calls as "refused" or "not refused" is reading nothing, and the cause must not be lost (review of #13, R5: a trial with no summary, reported only as "no call recorded").
 *   outcome  the batch's own result for this trial (`{ infra, error, why }`), when it has one
 *   log      the runner's log lines of the batch
 *   stopped  why the batch stopped launching, when it did
 *   expectStop  the probe expects the batch to stop (a cap, a halt): a trial it never launched is then no event
 */
const diagnosisText = (diagnosis) => !diagnosis ? "" : `; container: ${JSON.stringify(diagnosis.state ?? diagnosis.note ?? diagnosis.error ?? {})}${diagnosis.oom_kills ? `, ${diagnosis.oom_kills} OOM kill(s)` : ""}${diagnosis.processes ? `; its processes: ${String(diagnosis.processes).split("\n").slice(0, 12).map((l) => l.trim().replace(/\s+/g, " ")).join(" | ")}` : ""}${diagnosis.log_tail ? `; its last log lines: ${String(diagnosis.log_tail).split("\n").slice(-4).join(" | ")}` : ""}`

export function infraReason(trial, { outcome = null, log = [], stopped = null, expectStop = false } = {}) {
  const hung = hungReason(trial)
  if (hung) return `${hung}${diagnosisText(trial?.summary?.exit_diagnosis)}`
  const summary = trial?.summary
  const own = (log ?? []).filter((line) => String(line).includes(` ${trial?.id}.t1`)).slice(-3).map((line) => String(line).trim())
  if (summary === null) {
    // A batch the probe expects to stop (a cap, a halt) leaves later trials unlaunched on purpose: that is the guarantee under test, not an event.
    if (expectStop && !outcome && stopped) return null
    const parts = [`no summary was written for the trial${outcome?.error ? `: ${outcome.error}` : ""}`]
    if (outcome?.infra) parts.push(`the runner recorded infra ${outcome.infra}`)
    else if (!outcome) parts.push(stopped ? `it was not launched (the batch stopped: ${stopped})` : "the runner has no result for it either")
    if (own.length) parts.push(`the runner's log: ${own.join(" | ")}`)
    return parts.join("; ")
  }
  if (!summary) return null
  if (summary.infra === "trial_error" || summary.infra === "trial_incomplete" || summary.infra === "interrupted") {
    const signal = summary.signal ? `; signal ${summary.signal}` : ""
    return `${summary.infra_why ?? summary.error ?? summary.infra}${signal}${summary.exit != null ? `; exit ${summary.exit}` : ""}${diagnosisText(summary.exit_diagnosis)}${summary.stack ? `; at ${String(summary.stack).split("\n")[1]?.trim().replace(/^at\s+/, "") ?? ""}` : ""}`
  }
  return null
}

const NOTES = []
/** The trials of every scripted run since the last call whose client was restarted once (an idle `opencode run` that never asked its model), as `[{ id, iteration, why }]`: passed, and said. */
export function takeNotes() {
  return NOTES.splice(0, NOTES.length)
}
export const noteRestart = (entry) => void NOTES.push(entry)

const HUNG = []
/** Records a hung trial for the probe wrapper (scriptedRun does it itself). */
export const noteHung = (entry) => void HUNG.push(entry)
/** The hung trials of every scripted run since the last call, as `[{ id, why }]`. A probe wrapper reads them once the probe returns, and reports them first, as the cause. */
export function takeHung() {
  return HUNG.splice(0, HUNG.length)
}
