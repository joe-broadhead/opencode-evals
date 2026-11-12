// Case sets, from each case's own metadata, so "the tune set" means one thing in the runner and in a report:
//
//   holdout   `Holdout: true` in the case header: written before tuning, never tuned against
//   tools     an id starting `tools-`: one request per tool or parameter family, to make every tool necessary once
//   tune      every other case
//   all       the three together
//   <name>    every case whose `Set:` header names it (`- Set: core, smoke`): sets a plugin defines for itself
//
// A case with `Status: retired` or `Status: deferred` is in no set: it stays in the repository, and no run selects it.
// A selection is a set (or a comma list of sets) and, optionally, a comma list of ids and `prefix*` globs.

export const SETS = ["tune", "holdout", "tools"]

export const familyOf = (caseObject) => (caseObject.holdout ? "holdout" : /^tools-/.test(caseObject.id) ? "tools" : "tune")

const active = (caseObject) => (caseObject.status ?? "active") === "active"

/** Is the case in any of these sets? */
export const inSets = (caseObject, sets) => active(caseObject) && (sets.includes(familyOf(caseObject)) || (caseObject.sets ?? []).some((name) => sets.includes(name)))

/** The sets a selection names. A name no case declares, and that is not a family, is an error. */
export function parseSets(text = "tune", cases = null) {
  const names = String(text).split(",").map((name) => name.trim()).filter(Boolean)
  if (names.includes("all")) return [...SETS]
  const declared = new Set((cases ?? []).flatMap((c) => c.sets ?? []))
  const unknown = names.filter((name) => !SETS.includes(name) && !declared.has(name))
  if (unknown.length || !names.length) throw new Error(`unknown case set ${unknown.join(",") || "(empty)"}: use ${[...SETS, ...declared, "all"].join(", ")}`)
  return names
}

const globToRegExp = (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)

/**
 * The cases a run or a report covers, in id order. Throws when nothing matches, and says when a named case was left out
 * by the set, so `--cases ho-x` without `--set holdout` is an error rather than an empty run.
 */
export function selectCases(cases, { patterns = "*", set = "tune" } = {}) {
  const sets = parseSets(set, cases)
  const wanted = String(patterns || "*").split(",").map((part) => part.trim()).filter(Boolean)
  const matchers = wanted.map(globToRegExp)
  const named = cases.filter((c) => matchers.some((re) => re.test(c.id)))
  const selected = named.filter((c) => inSets(c, sets)).sort((a, b) => a.id.localeCompare(b.id))
  const excluded = named.filter((c) => !inSets(c, sets))
  if (!selected.length) {
    const where = (c) => (active(c) ? familyOf(c) : `status ${c.status}`)
    const why = excluded.length ? `; ${excluded.length} matching case(s) are in ${[...new Set(excluded.map(where))].join(", ")}, not in --set ${sets.join(",")}` : ""
    throw new Error(`no case matches ${wanted.join(",")}${why}`)
  }
  return { selected, excluded, sets }
}

export function setCounts(cases) {
  const counts = Object.fromEntries(SETS.map((name) => [name, 0]))
  for (const c of cases.filter(active)) {
    counts[familyOf(c)]++
    for (const name of c.sets ?? []) counts[name] = (counts[name] ?? 0) + 1
  }
  return counts
}
