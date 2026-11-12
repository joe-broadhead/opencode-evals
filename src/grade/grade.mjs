// Items -> a verdict. Code decides everything it can; a judge item is advisory and cannot move a verdict
// (D2). A clause that cannot be settled makes its item BLOCKED, and a case with any BLOCKED item is
// BLOCKED — never silently passed.

import { evaluateClause } from "./evidence.mjs"
import { selectCalls } from "./select.mjs"
import { redactEvidence } from "../trace/redact.mjs"
import { sha256 } from "../util/canonical.mjs"

const BILLED_EXCEPTIONS = new Set(["get_usage_credits"])

/** A call made by the code inside Code Mode's `execute`, as opposed to the `execute` call that ran it. */
export const isInner = (call) => call.via === "execute" && call.tool !== "execute"

/** A run view: the one shape every grader reads. Built from a trace file's lines. */
export function runView(traceLines, { text = null, state = null, scope = null } = {}) {
  const parsed = traceLines.map((line) => (typeof line === "string" ? JSON.parse(line) : line))
  const head = parsed.find((event) => event.schema === "oc-trace/1") ?? parsed[0]
  const events = parsed.filter((event) => event.kind)
  const calls = events
    .filter((event) => event.kind === "tool_call")
    .map((event) => ({ ...event, counts: null, appended: null, status: "unknown" }))
  // Attach each result to its call (results follow their call; for inner calls the `for_seq` names it).
  const bySeq = new Map(calls.map((call) => [call.seq, call]))
  for (const event of events) {
    if (event.kind !== "tool_result") continue
    const target = event.for_seq ? bySeq.get(event.for_seq) : null
    if (!target) continue
    target.counts = event.counts ?? null
    target.appended = event.appended ?? null
    target.status = event.status ?? "unknown"
  }
  const permissions = events.filter((event) => event.kind === "permission").map((event) => ({ action: event.action, decision: event.decision }))
  const skills = events.filter((event) => event.kind === "skill_load").map((event) => event.skill).filter(Boolean)
  const tokens = head?.summary?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  // Two counts, the same as the trace head's: outer is every call the model made (a skill load, Code Mode's
  // `execute` and a direct tool alike), inner is every call the code inside an `execute` made.
  const inner = calls.filter(isInner)
  const direct = calls.filter((call) => !isInner(call))
  const billed = [...calls].filter((call) => {
    const ns = call.ns ?? (call.via === "execute" ? call.ns : call.tool.startsWith("x_") ? "x" : null)
    if (ns !== "x") return false
    return !BILLED_EXCEPTIONS.has(call.tool)
  })
  return {
    head,
    events,
    // The case's plugin and the tools it declares: a bare tool name in a clause is that plugin's tool (select.mjs).
    scope,
    calls,
    permissions,
    skills,
    answer: { text, sha256: head?.summary?.text?.sha256 ?? null, available: text !== null },
    state,
    tokens,
    cost: head?.summary?.cost ?? { amount_usd: null, source: "missing" },
    duration_ms: head?.duration_ms ?? null,
    exit: head?.exit ?? 0,
    failure_class: head?.failure_class ?? null,
    budget: {
      outer_calls: direct.length,
      inner_calls: inner.length,
      billed_calls: billed.length,
      tokens: (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0),
      wall_ms: head?.duration_ms ?? null,
      turns: head?.summary?.steps ?? null,
      cost_usd: head?.summary?.cost?.amount_usd ?? null,
    },
  }
}

const worst = (states) => {
  if (states.includes("fail")) return "fail"
  if (states.includes("unverifiable")) return "blocked"
  return "ok"
}

/** One item's result. `advisory` for judge items, `na` when its condition says it has nothing to check. */
export function gradeItem(item, view) {
  if (item.grader === "judge") {
    return { id: item.id, state: "advisory", severity: item.severity, forbidden: item.forbidden, results: [], detail: "advisory: no model in this tier" }
  }
  const naClauses = item.na_when ?? []
  if (naClauses.length) {
    const naResults = naClauses.map((clause) => evaluateClause(clause, view))
    if (naResults.every((r) => r.state === "ok")) {
      return {
        id: item.id,
        state: "na",
        severity: item.severity,
        forbidden: item.forbidden,
        results: naResults.map((r) => ({ clause: "", ...r, detail: redactEvidence(r.detail) })),
        detail: `n/a: ${redactEvidence(naResults.map((r) => r.detail).join("; "))}`,
      }
    }
  }
  const results = (item.evidence ?? []).map((clause) => ({ ...evaluateClause(clause, view), kind: clause.kind }))
  const anyGroups = (item.evidence_any ?? []).map((alternatives) => {
    const evaluated = alternatives.map((clause) => evaluateClause(clause, view))
    const state = evaluated.some((r) => r.state === "ok") ? "ok" : evaluated.some((r) => r.state === "unverifiable") ? "unverifiable" : "fail"
    return { state, detail: evaluated.map((r) => r.detail).join(" | "), kind: "any" }
  })
  const all = [...results, ...anyGroups]
  const state = worst(all.map((r) => r.state))
  return {
    id: item.id,
    state: state === "ok" ? "pass" : state === "fail" ? "fail" : "blocked",
    severity: item.severity,
    forbidden: item.forbidden,
    results: all.map((r) => ({ kind: r.kind, state: r.state, detail: redactEvidence(r.detail) })),
    detail: redactEvidence(all.map((r) => r.detail).join("; ")),
  }
}

/** Computes the case verdict from settled items, oc-factory's way. */
export function verdictOf(itemResults, caseObject) {
  const code = itemResults.filter((r) => r.state === "pass" || r.state === "fail" || r.state === "blocked")
  const failedBlockers = code.filter((r) => r.state === "fail" && r.severity === "blocker")
  const failed = code.filter((r) => r.state === "fail")
  // A minor is a note by definition, so an unsettled minor does not block the case; a blocker or a major does.
  const blocked = code.filter((r) => r.state === "blocked" && r.severity !== "minor")
  const blockedMinor = code.filter((r) => r.state === "blocked" && r.severity === "minor")
  const na = itemResults.filter((r) => r.state === "na")
  const advisory = itemResults.filter((r) => r.state === "advisory")
  const verdict = failedBlockers.length ? "FAIL" : blocked.length ? "BLOCKED" : "PASS"
  return {
    case: caseObject?.id ?? null,
    verdict,
    failed: failed.map((r) => r.id),
    failed_blockers: failed.filter((r) => r.severity === "blocker").map((r) => r.id),
    failed_majors: failed.filter((r) => r.severity === "major").map((r) => r.id),
    failed_minors: failed.filter((r) => r.severity === "minor").map((r) => r.id),
    blocked: blocked.map((r) => r.id),
    na: na.map((r) => r.id),
    advisory: advisory.map((r) => r.id),
    passed: code.filter((r) => r.state === "pass").map((r) => r.id),
    findings: failed.filter((r) => r.severity !== "blocker").map((r) => r.id),
    blocked_minor: blockedMinor.map((r) => r.id),
    forbidden_violations: code.filter((r) => r.state === "fail" && r.forbidden).map((r) => r.id),
    coverage: {
      declared: itemResults.length,
      executed: code.length,
      testable: code.filter((r) => r.state !== "blocked").length,
      passed: code.filter((r) => r.state === "pass").length,
      blocked: blocked.length + blockedMinor.length,
      na: na.length,
      advisory: advisory.length,
    },
  }
}

/** Grades one case against one run view. */
export function gradeCase(caseObject, view) {
  const itemResults = caseObject.items.map((item) => gradeItem(item, view))
  const verdict = verdictOf(itemResults, caseObject)
  const pairs = caseObject.items
    .filter((item) => (item.maps_to ?? []).length)
    .map((item) => ({ item: item.id, maps_to: item.maps_to, mine: itemResults.find((r) => r.id === item.id).state }))
  return {
    case: caseObject.id,
    plugin: caseObject.plugin,
    expect: caseObject.expect ?? "pass",
    verdict: verdict.verdict,
    control_met: caseObject.expect === "fail" ? verdict.verdict !== "PASS" : verdict.verdict === "PASS",
    items: itemResults,
    ...verdict,
    pairs,
    provenance: {
      trace_sha256: sha256(JSON.stringify(view.head)),
      trace_run_id: view.head?.run_id ?? null,
      text_available: view.answer.available,
      failure_class: view.failure_class,
    },
    budget: view.budget,
  }
}

export const billedTools = (view) => selectCalls(view.calls, "x.*").map((c) => c.tool)
