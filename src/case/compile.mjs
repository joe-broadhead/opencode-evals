// Draft -> `oc-case/1`, with every evidence clause parsed at compile time. A case whose evidence cannot
// be parsed never reaches a runner: it is a compile error, not a BLOCKED item.

import { parseCase, parseControls, parseBudget, ParseError } from "./parse.mjs"
import { parseClause } from "../grade/evidence.mjs"
import { validateCase, CaseError } from "./schema.mjs"
import { sha256 } from "../util/canonical.mjs"
import { parseTruth } from "./truth.mjs"

export { ParseError, CaseError }

const list = (text) => String(text).split(/[\s,]+/).map((part) => part.trim()).filter(Boolean)

const truthOf = (file, text) => {
  try {
    return parseTruth(text)
  } catch (error) {
    throw new CaseError(file, error.message)
  }
}

/** Compiles one markdown case. Throws CaseError or ParseError with the file and line. */
export function compileCase(file, text) {
  const draft = parseCase(file, text)
  if (!draft.id) throw new ParseError(file, "missing # case id")
  const problems = []
  const items = draft.items.map((item) => {
    const isJudge = (item.grader ?? "code") === "judge"
    const evidence = []
    for (const clause of isJudge ? [] : item.evidence) {
      const parsed = parseClause(clause.text)
      if (!parsed.ok) problems.push(`${file}:${clause.line}: ${item.id}: ${parsed.why}`)
      else evidence.push(parsed.clause)
    }
    const evidence_any = []
    for (const group of isJudge ? [] : item.evidence_any) {
      const alternatives = group.text.split(";;").map((part) => part.trim()).filter(Boolean)
      const clauses = []
      for (const alternative of alternatives) {
        const parsed = parseClause(alternative)
        if (!parsed.ok) problems.push(`${file}:${group.line}: ${item.id} (any): ${parsed.why}`)
        else clauses.push(parsed.clause)
      }
      if (clauses.length) evidence_any.push(clauses)
    }
    const na_when = []
    for (const clause of item.na_when) {
      const parsed = parseClause(clause.text)
      if (!parsed.ok) problems.push(`${file}:${clause.line}: ${item.id} (n/a_when): ${parsed.why}`)
      else na_when.push(parsed.clause)
    }
    return {
      id: item.id,
      severity: item.severity,
      ask: item.ask,
      forbidden: item.forbidden,
      grader: item.grader ?? "code",
      evidence,
      evidence_any,
      na_when,
      maps_to: item.maps_to,
      ...(item.where ? { where: item.where } : {}),
      ...(item.note ? { note: item.note } : {}),
      line: item.line,
    }
  })
  if (problems.length) throw new CaseError(file, `invalid evidence:\n  ${problems.join("\n  ")}`)

  const compiled = {
    schema: "oc-case/1",
    id: draft.id,
    plugin: draft.fields.plugin ?? "",
    skill: draft.fields.skill ?? "",
    tier: draft.fields.tier ?? "T3",
    source: draft.fields.source ?? null,
    decision: draft.fields.decision ?? null,
    data_check: draft.fields.dataCheck ?? null,
    prompt: draft.prompt.trim(),
    controls: parseControls(draft.fields.controls),
    budgets: parseBudget(draft.fields.budget),
    seed: draft.fields.seed ?? null,
    expect: draft.fields.expect ?? "pass",
    holdout: draft.fields.holdout === "true",
    // Present only when declared, so a case that declares none compiles to the JSON it always did.
    ...(draft.fields.checkable ? { checkable: list(draft.fields.checkable) } : {}),
    ...(draft.fields.set ? { sets: list(draft.fields.set) } : {}),
    ...(draft.fields.status ? { status: draft.fields.status } : {}),
    ...(draft.fields.truth ? { truth: truthOf(file, draft.fields.truth) } : {}),
    items,
    oracle: draft.oracle.map((o) => ({ path: o.path, op: o.op, value: o.value })),
    notes: draft.notes,
    hashes: { source_sha256: sha256(text) },
  }
  return validateCase(compiled, file)
}

/** The digest of a set of compiled cases: what a comparison is frozen to. */
export const casesDigest = (cases) =>
  sha256(
    JSON.stringify(
      [...cases]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((c) => ({ id: c.id, plugin: c.plugin, items: c.items.length, sha: c.hashes.source_sha256, budgets: c.budgets, prompt: sha256(c.prompt) })),
    ),
  )

/** Items whose evidence is code-decided: the coded share the design promises (~85%). */
export function codedShare(cases) {
  const all = cases.flatMap((c) => c.items)
  const coded = all.filter((i) => i.grader === "code").length
  return { coded, total: all.length, share: all.length ? coded / all.length : 0 }
}
