// Case sets, from each case's own metadata, so "the tune set" means one thing in the runner and in a report:
//
//   holdout   `Holdout: true` in the case header: written before tuning, never tuned against
//   tools     an id starting `tools-`: one request per tool or parameter family, to make every tool necessary once
//   tune      every other case
//   all       the three together
//
// A selection is a set (or a comma list of sets) and, optionally, a comma list of ids and `prefix*` globs.

export const SETS = ["tune", "holdout", "tools"]

export const familyOf = (caseObject) => (caseObject.holdout ? "holdout" : /^tools-/.test(caseObject.id) ? "tools" : "tune")

export function parseSets(text = "tune") {
  const names = String(text).split(",").map((name) => name.trim()).filter(Boolean)
  if (names.includes("all")) return [...SETS]
  const unknown = names.filter((name) => !SETS.includes(name))
  if (unknown.length || !names.length) throw new Error(`unknown case set ${unknown.join(",") || "(empty)"}: use ${[...SETS, "all"].join(", ")}`)
  return names
}

const globToRegExp = (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)

/**
 * The cases a run or a report covers, in id order. Throws when nothing matches, and says when a named case was left out
 * by the set, so `--cases ho-x` without `--set holdout` is an error rather than an empty run.
 */
export function selectCases(cases, { patterns = "*", set = "tune" } = {}) {
  const sets = parseSets(set)
  const wanted = String(patterns || "*").split(",").map((part) => part.trim()).filter(Boolean)
  const matchers = wanted.map(globToRegExp)
  const named = cases.filter((c) => matchers.some((re) => re.test(c.id)))
  const selected = named.filter((c) => sets.includes(familyOf(c))).sort((a, b) => a.id.localeCompare(b.id))
  const excluded = named.filter((c) => !sets.includes(familyOf(c)))
  if (!selected.length) {
    const why = excluded.length ? `; ${excluded.length} matching case(s) are in ${[...new Set(excluded.map(familyOf))].join(", ")}, not in --set ${sets.join(",")}` : ""
    throw new Error(`no case matches ${wanted.join(",")}${why}`)
  }
  return { selected, excluded, sets }
}

export function setCounts(cases) {
  const counts = Object.fromEntries(SETS.map((name) => [name, 0]))
  for (const c of cases) counts[familyOf(c)]++
  return counts
}
