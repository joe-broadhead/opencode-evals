// Recorded runs -> `oc-trace/1`.
//
// Input: one `<case>.jsonl` (`opencode run --format json`) and its `<case>.summary.json`, from
// the private store's raw/<iteration>/<plugin>/. Output: one JSONL file whose first line is the run
// header and whose remaining lines are events, carrying no text, handles, ids or links from X.
//
// The privacy rule is structural: arguments go through `safeArgs`, results are reduced to counts, and the
// answer text is replaced by its digest. The raw file stays in the private store and is named here by
// digest, so a text-dependent item can be re-checked and a trace can never leak.

import { readFileSync } from "node:fs"

import { summarize } from "./analyse.mjs"
import { safeArgs, shape } from "./redact.mjs"
import { extractInnerCalls, dataflow, returnKeyFor } from "./innerArgs.mjs"
import { resultCounts, knownExtractor, costLineOf, parseFirstJson } from "./resultCounts.mjs"
import { loadCatalog, loadMapping } from "../cost/catalog.mjs"
import { runCost } from "../cost/rule.mjs"
import { listPrice } from "../cost/catalog.mjs"
import { sha256 } from "../util/canonical.mjs"
import { harnessVersion } from "../version.mjs"
import { endedOnAuth } from "../run/authError.mjs"

/** Classifies a run before any score is computed, so an infra failure is never a zero. */
export function failureClass({ exit, tokens, calls, durationMs, timeoutMs = 900_000 }) {
  if (exit === 0) return null
  const noWork = (calls ?? 0) === 0 && (tokens?.input ?? 0) + (tokens?.output ?? 0) + (tokens?.cacheRead ?? 0) === 0
  if (noWork && durationMs >= timeoutMs * 0.9) return "timeout"
  if (noWork) return "infra"
  if (exit === 130) return "infra"
  if ((tokens?.output ?? 0) > 0 && (calls ?? 0) === 0) return "provider"
  return "unknown"
}

/** Splits a recorded model id into the provider and the model, dropping the reasoning variant. */
export function splitModel(model) {
  const [provider, ...rest] = String(model ?? "").split("/")
  const id = rest.join("/").replace(/#.*$/, "")
  return { provider: provider ?? "unknown", id: id || "unknown" }
}

/** The run header: everything a comparison needs, and nothing about the account. */
export function header({ iteration, caseName, trial = null, plugin = "x", rawLines, summary, stderr, manifest, catalog, mapping, model }) {
  const s = summarize(rawLines, stderr)
  const tokens = s.tokens
  const split = splitModel(model)
  const cost = runCost({
    steps: s.stepCosts ?? [],
    model: split,
    catalog: catalog ?? loadCatalog(),
    mapping: mapping ?? loadMapping(),
  })
  const duration = summary?.durationMs ?? (s.firstAt && s.lastAt ? s.lastAt - s.firstAt : null)
  const exit = summary?.exit ?? 0
  const infraOf = summary?.infra ?? (endedOnAuth(rawLines.join("\n")) ? "auth" : null)
  const text = s.finalText ?? ""
  return {
    schema: "oc-trace/1",
    run_id: trial ? `${iteration}/${caseName}#t${trial}` : `${iteration}/${caseName}`,
    iteration,
    case: caseName,
    trial: trial ?? summary?.trial ?? 1,
    arm: summary?.arm ?? "with-skill",
    // The runner that made the recording, as it recorded itself; a recording that does not say is `unrecorded`.
    source: { kind: "recorded", runner: summary?.runner ?? manifest?.recorded?.runner ?? "unrecorded", version: summary?.runner_version ?? null },
    started_at: s.firstAt ? new Date(s.firstAt).toISOString() : null,
    ended_at: s.lastAt ? new Date(s.lastAt).toISOString() : null,
    duration_ms: duration,
    exit,
    // The runner's own classification wins: a trial refused its credential is infra, whatever it printed. A recording
    // that ended on a refused sign-in, which a runner did not mark, is infra too: the run was cut short.
    failure_class: infraOf ? "infra" : failureClass({ exit, tokens, calls: s.toolCalls, durationMs: duration ?? 0 }),
    ...(infraOf ? { infra: infraOf } : {}),
    model: { id: model, ...split, params: {} },
    provenance: {
      ...manifest,
      harness: { version: harnessVersion() },
    },
    summary: {
      outer_calls: s.toolCalls,
      failed_outer: s.failedCalls,
      inner_calls: s.inner.calls,
      inner_declined: s.inner.declined,
      inner_errored: s.inner.errored,
      steps: s.steps,
      skills_loaded: s.skillsLoaded,
      tokens,
      cost,
      text: { sha256: sha256(text), chars: text.length, lines: text ? text.split("\n").length : 0 },
    },
    privacy: {
      policy: "no-text-no-ids-no-handles",
      raw: rawDescriptor(iteration, plugin, trial ? `${caseName}.t${trial}` : caseName, rawLines, text),
    },
  }
}

function rawDescriptor(iteration, plugin, caseName, rawLines, text) {
  const body = rawLines.join("\n")
  return {
    kind: "recording",
    ref: `raw/${iteration}/${plugin}/${caseName}.jsonl`,
    sha256: sha256(body),
    text_sha256: sha256(text ?? ""),
    text_chars: (text ?? "").length,
  }
}

/** The event stream: one line per event, in recorded order, with content replaced by structure. */
export function events({ rawLines, stderr, caseName, iteration, price = null }) {
  const s = summarize(rawLines, stderr)
  const out = []
  let seq = 0
  const push = (kind, ts, body) => out.push({ seq: ++seq, ts_ms: ts ?? null, kind, ...body })
  for (const call of s.calls) {
    const isExecute = call.via === "execute"
    const args = safeArgs(call.inputRaw, { keep: call.tool === "skill" ? ["id"] : [] })
    const callSeq = seq + 1
    push("tool_call", call.at, {
      tool: call.tool,
      via: call.via,
      span: `execute_tool ${call.tool}`,
      args,
      args_sha256: sha256(JSON.stringify(call.inputRaw ?? {})),
      inner_sites: call.inner.map((site) => site.replace(/^tools\./, "")),
      inner_sites_count: call.inner.length,
      inner_sites_kind: "lower_bound",
    })
    push("tool_result", call.at, {
      tool: call.tool,
      for_seq: callSeq,
      status: call.status === "completed" ? "ok" : call.status === "error" ? "error" : "unknown",
      bytes: call.outputBytes,
      counts: isExecute ? null : resultCounts(call.tool, call.outputRaw),
      counts_known: !isExecute && knownExtractor(call.tool),
      error_class: call.error ? classifyError(call.error) : null,
      http_status: call.error ? ((call.error.match(/\(HTTP (\d{3})\)/) ?? [])[1] ?? null) : null,
    })
    // A skill call that failed ("Unable to load skill …", a plugin without its skills) loaded nothing.
    if (call.tool === "skill") {
      push(call.status === "error" ? "skill_failed" : "skill_load", call.at, { skill: typeof args.id === "string" ? args.id : null, bytes: call.outputBytes })
    }
    if (!isExecute) continue
    // The calls the code makes, with the arguments beside each site.
    const code = call.inputRaw.code
    const sites = extractInnerCalls(code)
    const flow = dataflow(code)
    const payload = parseFirstJson(call.outputRaw)
    const parent = callSeq
    let attributed = false
    for (const site of sites) {
      const keys = Object.keys(site.args ?? {})
      // Whose counts are these? One call in the block, or a binding resolved in what the block returns.
      const variable = [...flow.bindings.entries()].find(([, tool]) => tool === site.name)?.[0]
      const key = variable ? returnKeyFor(flow.returns, variable) : null
      const slice = key && payload && typeof payload === "object" ? payload[key] : undefined
      const sole = sites.length === 1 && site.parsed
      const counts = sole ? resultCounts(site.name, call.outputRaw) : slice !== undefined ? resultCounts(site.name, JSON.stringify(slice)) : null
      const own = counts !== null
      // The plugin appends its cost line after the whole block output, so only a sole call can claim it.
      const appended = sole ? costLineOf(call.outputRaw) : null
      if (own) attributed = true
      push("tool_call", call.at, {
        tool: site.name,
        ns: site.ns,
        via: "execute",
        parent_seq: parent,
        span: `execute_tool ${site.name}`,
        args: safeArgs(site.args),
        args_parsed: site.parsed,
        ...(site.parsed ? {} : { args_why: site.why ?? "unparsed" }),
        args_sha256: sha256(JSON.stringify(site.args ?? null)),
        arg_keys: keys.sort(),
        inner_sites: null,
      })
      if (own) {
        push("tool_result", call.at, {
          tool: site.name,
          for_seq: seq,
          status: call.status === "completed" ? "ok" : "error",
          bytes: call.outputBytes,
          counts,
          counts_known: knownExtractor(site.name),
          counts_source: sole ? "containing-call-output" : `return-key:${key}`,
          ...(appended ? { appended } : {}),
          error_class: call.error ? classifyError(call.error) : null,
          http_status: null,
        })
      }
    }
    if (sites.length && !attributed && call.outputBytes > 0) {
      push("note", call.at, { note: "inner-counts-not-attributable", sites: sites.length })
    }
  }
  // Every model call records both numbers: what the provider billed, and what the catalogue would charge.
  for (const [index, step] of (s.stepCosts ?? []).entries()) {
    const tokens = { input: step.tokens.input, output: step.tokens.output, cacheRead: step.tokens.cache.read, cacheWrite: step.tokens.cache.write }
    push("model_call", null, {
      n: index + 1,
      billed_usd: step.cost,
      tokens,
      list_usd: price ? listPrice(tokens, price) : null,
      source: typeof step.cost === "number" && step.cost > 0 ? "billed" : price ? "list-price" : "missing",
    })
  }

  // Declines: the analyser already reconciled the result text against stderr.
  for (const detail of s.inner.detail) {
    if (detail.kind !== "declined") continue
    push("permission", null, {
      action: detail.tool ? String(detail.tool).split(".").pop() : null,
      decision: "declined",
      reason: "non-interactive run auto-rejects every ask",
      source: detail.source ?? "result",
    })
  }
  for (const detail of s.inner.detail) {
    if (detail.kind !== "errored") continue
    push("tool_result_error", null, {
      tool: detail.tool ? String(detail.tool).split(".").pop() : null,
      http_status: detail.status ?? null,
      shape: shape(detail.message ?? "").slice(0, 80),
    })
  }
  // The answer: structure only. The text is in the private recording, keyed by digest.
  const text = s.finalText ?? ""
  const lines = text.split("\n")
  push("answer", s.lastAt, {
    sha256: sha256(text),
    chars: text.length,
    lines: lines.length,
    last_line_sha256: sha256(lines.length ? lines[lines.length - 1] : ""),
  })
  return out
}

export function classifyError(message) {
  const text = String(message ?? "")
  if (/\(HTTP 5\d\d\)/.test(text)) return "upstream"
  if (/\(HTTP 4\d\d\)/.test(text)) return "client"
  if (/permission|rejected/i.test(text)) return "permission"
  if (/abort|cancel/i.test(text)) return "cancelled"
  if (/not found|unknown/i.test(text)) return "not_found"
  return "tool"
}

/** Reads one recorded case and returns the whole trace file as text (header line + events). */
export function traceFromFiles({ caseName, trial = null, iteration, plugin, base, manifest, catalog, mapping, model, stderr }) {
  const rawLines = readFileSync(`${base}.jsonl`, "utf8").split("\n").filter(Boolean)
  const summary = safeJson(`${base}.summary.json`)
  const head = header({ iteration, caseName, trial, plugin, rawLines, summary: summary ? { ...summary, stderr: stderr ?? summary.stderr } : null, stderr, manifest, catalog, mapping, model })
  const body = events({ rawLines, stderr, caseName, iteration, price: head.summary?.cost?.resolved?.price ?? null })
  return { head, body, lines: [JSON.stringify(head), ...body.map((e) => JSON.stringify(e))] }
}

function safeJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}
