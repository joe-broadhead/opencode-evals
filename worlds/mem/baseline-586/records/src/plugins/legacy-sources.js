/**
 * The one rule for a legacy source alias (audit 1.3; review F1, F2): which
 * aliases a declared package retires, and which bindings are the same account
 * under another name.
 *
 * Records is where every console and plugin path converges, so the rule lives
 * here and nowhere else: `sources.request`, `sources.bind`, `plugins.request`
 * and `plugins.consent` all call `bindingProblem`, and `plugins.list` hands the
 * console the retired names to filter its list (`retiredSources`). The plugin's
 * `mem_spaces` only offers the catalogue and shows the server's refusal.
 *
 * The alias table names the package and the declared source or sources it
 * stands for. X's legacy `x` read mentions, bookmarks and the timeline, so all
 * three declared sources are one account under `x` (review F2).
 */

/** A legacy alias, its released package, and the declared source(s) it stands for. */
export const LEGACY_SOURCES = Object.freeze({
  history: { package: "@joe-broadhead/opencode-history", declared: ["history.sessions"], named: false },
  // gws reads account aliases: its previous-contract entry names the account (`namesAccount` in src/sources.js)
  // and the released declaration marks every item `accounts.named: true`. Two aliases are two mailboxes.
  gmail: { package: "@joe-broadhead/opencode-gws", declared: ["gws.gmail"], named: true },
  // `slack` maps to its channels read (v0.0.3 `slack.workspace`: tool `events_list`, input `source: "slack"`)
  // alone. `slack.mentions` is another tool and API (`mentions_list`, `assistant.search.context`) that the legacy
  // `slack` never called, so the legacy alias does not stand for it: their only overlap is a message that both sits
  // in a configured channel and mentions the person, which is inherent to Slack's two declared sources, not to this
  // alias. If that overlap matters it is Slack's design or curation's de-duplication, not an entry here (round 2, §3).
  slack: { package: "@joe-broadhead/opencode-slack", declared: ["slack.workspace"], named: false },
  // X's legacy `x` read mentions, bookmarks and the timeline (its `permission.actions`), so all three declared
  // sources are one account under `x` (review F2: X reads are billed).
  x: { package: "@joe-broadhead/opencode-x", declared: ["x.mentions", "x.bookmarks", "x.timeline"], named: false },
  // One signed-in account: the previous-contract entry sends no account (`namesAccount` is unset) and the
  // legacy `events_list` takes none; the declared surface reads named accounts, which is not this path.
  granola: { package: "@joe-broadhead/opencode-granola", declared: ["granola.meetings"], named: false },
  // Named accounts: the previous-contract entry carries `accountServer: "plaud-{account}"` (src/sources.js), and
  // its legacy `events_list` takes an account alias, defaulting to the first.
  plaud: { package: "@joe-broadhead/opencode-plaud", declared: ["plaud.recordings"], named: true },
  wisprflow: { package: "@joe-broadhead/opencode-wisprflow", declared: ["wisprflow.meetings"], named: false },
  github: { package: "@joe-broadhead/opencode-github", declared: ["github.activity"], named: false },
  linear: { package: "@joe-broadhead/opencode-linear", declared: ["linear.activity"], named: false },
})

/**
 * True when a legacy source reads **named accounts** (plaud and gws, above): a
 * binding whose ask is unknown may be another alias's, so it is never superseded
 * and is marked on its row instead. A source that reads one account has only one
 * account to switch from, so an unknown ask is superseded like its own.
 */
export function legacyNamed(source) {
  return LEGACY_SOURCES[String(source ?? "")]?.named === true
}

/** The packages that declare a source under the contract, from the space's own plugin rows. */
function declaredPackages(handle) {
  const packages = new Set()
  for (const row of handle.all("select package_name, manifest_json from plugins where state in ('available', 'conflict') and manifest_json is not null")) {
    let manifest = null
    try {
      manifest = JSON.parse(row.manifest_json)
    } catch {
      continue
    }
    if (manifest?.contract === "sources" && typeof row.package_name === "string" && row.package_name !== "") packages.add(row.package_name)
  }
  return packages
}

/**
 * The legacy aliases whose package declares under the contract: the name, and
 * the declared sources it stands for. Records answers this to the console
 * (`plugins.list`) so the console offers neither the alias nor a refusal about
 * it that does not name the way forward.
 */
export function retiredSources(handle) {
  const declared = declaredPackages(handle)
  return Object.keys(LEGACY_SOURCES)
    .filter((alias) => declared.has(LEGACY_SOURCES[alias].package))
    .map((alias) => ({ source: alias, declared: [...LEGACY_SOURCES[alias].declared] }))
}

/**
 * Every name that is the same account as `source`: the name, and the names it
 * cannot share an account with.
 *
 * A legacy alias stands for the declared sources it was mapped to, so the alias
 * and each of them are one account. A declared source stands for its alias
 * alone: two declared sources of one package are different feeds (X's
 * `x.mentions` and `x.bookmarks` read `get_users_mentions` and
 * `get_users_bookmarks`), so they bind beside each other and are never each
 * other's duplicate (round 2, R2-1).
 */
export function aliasGroup(source) {
  const name = String(source ?? "")
  if (LEGACY_SOURCES[name]) return [name, ...LEGACY_SOURCES[name].declared]
  for (const [alias, entry] of Object.entries(LEGACY_SOURCES)) if (entry.declared.includes(name)) return [alias]
  return [name]
}

/**
 * The binding problem `source` has for `account`, or null.
 *
 * - `source_retired`: a legacy alias whose package has declared (a new bind is
 *   refused; an existing binding is untouched, because it is already in `sources`).
 * - `duplicate_binding`: another name for the same account is already bound, or
 *   already requested, so a second one would collect it twice. A legacy alias
 *   and each declared source it stands for are the same account, in either
 *   order; two declared siblings are different feeds and are not.
 *
 * A re-confirm of the same `(source, account)` is not a duplicate.
 */
export function bindingProblem(handle, { source, account }) {
  const name = String(source ?? "")
  const wanted = account || "default"
  const retired = retiredSources(handle).find((entry) => entry.source === name) ?? null
  const exists = handle.get("select 1 from sources where source = ? and account = ?", name, wanted)
  if (retired && !exists) {
    return {
      code: "source_retired",
      message: `${name} is the previous contract's name for ${retired.declared.join(", ")}: its package now declares the source, so it is no longer offered.`,
      next: `Bind ${retired.declared[0]} instead; a binding already made through ${name}, if any, keeps collecting.`,
    }
  }
  const group = aliasGroup(name)
  const others = group.filter((alias) => alias !== name)
  if (others.length === 0) return null
  const row = handle.get(
    `select source, account from sources where account = ? and source in (${others.map(() => "?").join(", ")}) limit 1`,
    wanted,
    ...others,
  )
  const request = row
    ? null
    : handle.get(
        `select source, account from source_requests where account = ? and source in (${others.map(() => "?").join(", ")}) limit 1`,
        wanted,
        ...others,
      ) ?? handle.get(
        `select source, account from plugin_requests where account = ? and source in (${others.map(() => "?").join(", ")}) limit 1`,
        wanted,
        ...others,
      )
  const held = row ?? request
  if (!held) return null
  const what = row ? "binding" : "bind request"
  return {
    code: "duplicate_binding",
    message: `${name}:${wanted} is the same account as the existing ${held.source}:${wanted} ${what}, so binding it again would collect it twice.`,
    next: `Keep the existing ${held.source} ${what}, or unbind ${held.source} (which deletes its events) and then bind ${name}.`,
  }
}
