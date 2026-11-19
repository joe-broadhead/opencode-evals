// Case sets, from each case's own metadata, so "the tune set" means one thing in the runner and in a report:
//
//   holdout   `Holdout: true` in the case header: written before tuning, never tuned against
//   tools     an id starting `tools-`: one request per tool or parameter family, to make every tool necessary once
//   tune      every other case, a case in one of this round's own sets (wide, route, deep, commit, hooks, local) excepted:
//             those run only when named
//   all       tune and tools together. NOT holdout: a holdout is selected only by naming `holdout` (the plan's flag for h0 and h1)
//   <name>    every case whose `Set:` header names it (`- Set: core, smoke`): sets a plugin defines for itself
//
// A case with `Status: retired` or `Status: deferred` is in no set: it stays in the repository, and no run selects it.
// A selection is a set (or a comma list of sets) and, optionally, a comma list of ids and `prefix*` globs.
//
// HOLDOUTS are in no selection but their own. A holdout (`Holdout: true`, or an id that starts `hold-`) is never returned for `tune`, `tools`,
// `all`, a round set (`local`, `wide`, ...) or a plugin's own set, whatever its `Set:` header says, and a `--cases` glob cannot reach it: only a
// selection that names `holdout` (`--set holdout`, or `--set tune,holdout`) returns it. A holdout that was given `Set: local` to get past the id rule
// would otherwise be one `--set local` away from a tuner.

export const SETS = ["tune", "holdout", "tools"]

/**
 * The sets this round reserves (schema.mjs ROUND_SETS). A case that declares one is in no family: it runs only when its
 * set is named (`--set deep`, `--set commit`), so a default `--set tune` run never picks up a commit case, which really
 * writes, or a local one, which needs the credential-free arm. `wide` cases are `tools-` cases and are also `--set tools`.
 */
export const ROUND = ["wide", "route", "deep", "commit", "hooks", "local"]

/** A holdout: declared one, or named like one. The id alone is enough, so a case that forgot its header is still kept out of every other selection. */
export const isHoldout = (caseObject) => caseObject.holdout === true || /^hold-/.test(String(caseObject.id ?? ""))

export const familyOf = (caseObject) =>
  isHoldout(caseObject) ? "holdout" : /^tools-/.test(caseObject.id) ? "tools" : (caseObject.sets ?? []).some((name) => ROUND.includes(name)) ? "round" : "tune"

const active = (caseObject) => (caseObject.status ?? "active") === "active"

/** Is the case in any of these sets? */
export const inSets = (caseObject, sets) => {
  if (!active(caseObject)) return false
  // A holdout is in the selection that names `holdout` and in no other, whatever sets its header lists.
  if (isHoldout(caseObject)) return sets.includes("holdout")
  return sets.includes(familyOf(caseObject)) || (caseObject.sets ?? []).some((name) => sets.includes(name))
}

/** The sets a selection names. A name no case declares, and that is not a family, is an error. */
export function parseSets(text = "tune", cases = null) {
  const names = String(text).split(",").map((name) => name.trim()).filter(Boolean)
  // `all` is the two families a tuner may see; `holdout` is named on its own (`all,holdout` is both).
  const expanded = names.flatMap((name) => (name === "all" ? ["tune", "tools"] : [name]))
  if (names.includes("all")) return [...new Set(expanded)]
  const declared = new Set((cases ?? []).flatMap((c) => c.sets ?? []))
  const unknown = names.filter((name) => !SETS.includes(name) && !declared.has(name))
  if (unknown.length || !names.length) throw new Error(`unknown case set ${unknown.join(",") || "(empty)"}: use ${[...SETS, ...declared, "all"].join(", ")}`)
  return names
}

const globToRegExp = (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)

/**
 * The cases a run or a report covers, in id order. Throws when nothing matches, and says when a named case was left out
 * by the set, so `--cases hold-x` without `--set holdout` is an error rather than an empty run.
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

/**
 * How many active cases each selection holds: the families (`tune`, `holdout`, `tools`) and every `Set:` name. A case in one of this round's sets is in no family
 * (`familyOf` calls it `round`, which is not a selection: it is counted under its own set names), and a holdout is counted as a holdout and under no other
 * name, as `selectCases` returns it for no other. Every value is a number.
 */
export function setCounts(cases) {
  const counts = Object.fromEntries(SETS.map((name) => [name, 0]))
  for (const c of cases.filter(active)) {
    const family = familyOf(c)
    if (family !== "round") counts[family]++
    if (isHoldout(c)) continue
    for (const name of c.sets ?? []) counts[name] = (counts[name] ?? 0) + 1
  }
  return counts
}
