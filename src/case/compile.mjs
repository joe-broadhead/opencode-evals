// Draft -> `oc-case/1`, with every evidence clause parsed at compile time. A case whose evidence cannot
// be parsed never reaches a runner: it is a compile error, not a BLOCKED item.

import { parseCase, parseControls, parseBudget, ParseError } from "./parse.mjs"
import { parseClause } from "../grade/evidence.mjs"
import { validateCase, CaseError, isLegacyCase } from "./schema.mjs"
import { sha256 } from "../util/canonical.mjs"
import { parseTruth } from "./truth.mjs"
import { toolNameProblems } from "./toolnames.mjs"

export { ParseError, CaseError }

const list = (text) => String(text).split(/[\s,]+/).map((part) => part.trim()).filter(Boolean)

const truthOf = (file, text) => {
  try {
    return parseTruth(text)
  } catch (error) {
    throw new CaseError(file, error.message)
  }
}

/** `Holdout:` is `true` or `false`, and nothing else: `True`, `yes` or `1` used to compile to `false`, and the case was then an ordinary case a tuner could be given. */
function holdoutFlag(file, value) {
  if (value === undefined) return false
  if (value === "true") return true
  if (value === "false") return false
  throw new CaseError(file, `Holdout: is \`true\` or \`false\`, not ${JSON.stringify(value)}: any other spelling used to compile to false, and a holdout was then one \`--set tune\` away from a tuner`)
}

/** The `<...>` tokens of a prompt: a `<` that does not open with a space or another `<`, up to the next `>` on the same line (so `a < b and c > d` is not one). */
export const angleTokens = (prompt) => [...String(prompt).matchAll(/(?<!<)<(?![<\s=])[^<>\n]{1,79}>(?!>)/g)].map((m) => m[0])

/**
 * Compiles one markdown case. Throws CaseError or ParseError with the file and line. With `packs` (parsed pack.json objects), a
 * case in one of this round's sets is also checked against its plugin's pack: a clause that names a tool the plugin does not have
 * can never fire, and is a compile error (src/case/toolnames.mjs).
 */
export function compileCase(file, text, { packs = null } = {}) {
  const draft = parseCase(file, text)
  if (!draft.id) throw new ParseError(file, "missing # case id")
  // A wide skeleton (scripts/wide-skeletons.mjs) carries `<<TODO ...>>` where the writer's words go: it cannot be compiled, run or committed.
  if (/<<TODO/.test(draft.prompt)) throw new CaseError(file, "the prompt is still a skeleton's <<TODO>>: write the task a user would have, without the tool's description")
  // A literal `<placeholder>` in a prompt is a gap nobody filled (`<github sandbox repo>`, `<your channel>`): the model is asked about something that is not there, or
  // answers with the placeholder echoed back. `{{target:...}}` and `{{canary:...}}` are the way to name a value the store fills. A prompt that really quotes angle
  // brackets (HTML, a generic type, a shell redirect) lists each quoted token in `- Angle brackets: <div>, </div>`; anything else between < and > is refused.
  const allowed = new Set(String(draft.fields.angleBrackets ?? "").split(",").map((t) => t.trim()).filter(Boolean))
  // The History, X and Charts corpora written before this round fill their `<X test topic: ...>` gaps from their own worlds and are left as they are (isLegacyCase).
  const legacy = isLegacyCase({ id: draft.id, plugin: draft.fields.plugin ?? "", sets: list(draft.fields.set ?? "") })
  const placeholders = legacy ? [] : angleTokens(draft.prompt).filter((token) => !allowed.has(token))
  if (placeholders.length) throw new CaseError(file, `the prompt has a literal placeholder: ${[...new Set(placeholders)].slice(0, 4).join(" ")}. Write the value, or use {{target:<plugin>.<name>}} / {{canary:<name>}} for one the store fills. A prompt that really quotes angle brackets lists them: \`- Angle brackets: ${placeholders[0]}\`. Only angle brackets are checked here: [channel], YOUR_REPO, \${TARGET}, TODO and XXX are not placeholders to this check, and they are still gaps a reviewer rejects`)
  for (const token of legacy ? [] : allowed) if (!draft.prompt.includes(token)) throw new CaseError(file, `\`Angle brackets:\` lists ${token}, which the prompt does not contain`)
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
    holdout: holdoutFlag(file, draft.fields.holdout),
    // Present only when declared, so a case that declares none compiles to the JSON it always did.
    ...(draft.fields.checkable ? { checkable: list(draft.fields.checkable) } : {}),
    ...(draft.fields.set ? { sets: list(draft.fields.set) } : {}),
    ...(draft.fields.status ? { status: draft.fields.status } : {}),
    ...(draft.fields.truth ? { truth: truthOf(file, draft.fields.truth) } : {}),
    // What kind of data the case reads (EVALS-232 §2.7): decides which providers may run it.
    ...(draft.fields.data ? { data: draft.fields.data.trim().toLowerCase() } : {}),
    // Places under the trial's HOME whose files the record keeps (`plaud_export` writes to ~/Plaud): only these, never the rest.
    ...(draft.fields.homeFiles ? { home_files: list(draft.fields.homeFiles) } : {}),
    items,
    oracle: draft.oracle.map((o) => ({ path: o.path, op: o.op, value: o.value })),
    notes: draft.notes,
    hashes: { source_sha256: sha256(text) },
  }
  validateCase(compiled, file)
  if (packs) {
    const named = toolNameProblems(compiled, packs)
    if (named.length) throw new CaseError(file, `a clause names a tool its plugin's pack does not have, so it could never fire:\n  ${named.join("\n  ")}`)
  }
  return compiled
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
