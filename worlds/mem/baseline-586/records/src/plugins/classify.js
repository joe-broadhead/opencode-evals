/**
 * The consent snapshot, its limits and the delta classifier
 * (DESIGN-PLUGIN-MEMORY §3.3). Server-side only: the records service judges
 * every later declaration of a consented plugin against what the person
 * confirmed.
 *
 * - **Snapshot** (`snapshotOf`): one source's declaration and every routine
 *   that selects it, each `enabled` or not as the person chose at confirm.
 * - **Limits** (`limitsOf`): recorded at confirm from the enabled routines, and
 *   kept: a later routine is on without a click only within them.
 * - **Classifier** (`classify`): item by item. Narrowing is a closed list and
 *   applies at once; display text applies at once; hints and render text, and
 *   a routine within the limits, apply at once for a `package` plugin and
 *   wait for a click for a `local` one; everything else is widening and waits.
 *   An edited install (rule 6) waits for every change that is not narrowing.
 *   A routine is judged by its content, never by its id.
 *
 * The result's `next` is the snapshot to keep running: the confirmed one with
 * the applied items, never wider. `pending` is what waits for the person.
 */
import { canonicalJSON } from "./manifest.js"

const RANK = Object.freeze({ "1d": 1, "7d": 7, "31d": 31 })
const ENGINE = Object.freeze({ render: 0, extract: 1 })
const DEFAULT_CADENCE = 30
const DEFAULT_BUDGET = 15_000

const clone = (value) => (value === undefined ? undefined : structuredClone(value))
const same = (a, b) => canonicalJSON(a ?? null) === canonicalJSON(b ?? null)
const grantKey = (grant) => `${grant.action}\u0000${grant.resource}`

/** A routine's content: everything but its id, display text, hints, render text and whether it is enabled. */
function contentKey(routine) {
  const { id: _id, title: _title, summary: _summary, hints: _hints, enabled: _enabled, ...rest } = routine
  if (rest.render) {
    const { heading: _heading, line: _line, ...render } = rest.render
    rest.render = render
  }
  return canonicalJSON(rest)
}
const displayKey = (routine) => canonicalJSON({ title: routine.title, summary: routine.summary })
const textKey = (routine) => canonicalJSON({ hints: routine.hints ?? null, heading: routine.render?.heading ?? null, line: routine.render?.line ?? null })

/**
 * One source's consent snapshot: its declaration, and the routines that
 * select it with `enabled` as the person chose.
 *
 * @param {any} manifest a declaration that passed validateManifest
 * @param {string} sourceId
 * @param {{ enabled?: string[] }} [options] the ids of the routines turned on
 */
export function snapshotOf(manifest, sourceId, { enabled = [] } = {}) {
  const source = manifest.sources.find((entry) => entry.id === sourceId)
  if (!source) return null
  const routines = (manifest.routines ?? []).filter((routine) => routine.select.sources.includes(sourceId)).map((routine) => ({ ...clone(routine), enabled: enabled.includes(routine.id) }))
  return { source: clone(source), routines }
}

/**
 * The limits a confirmation records (§3.3), from the routines turned on;
 * null when none is, and then no later routine is within them.
 */
export function limitsOf(snapshot) {
  const approved = (snapshot?.routines ?? []).filter((routine) => routine.enabled)
  if (approved.length === 0) return null
  const all = (pick) => approved.every((routine) => pick(routine) !== undefined)
  const extract = approved.filter((routine) => routine.engine === "extract")
  return {
    engine: approved.some((routine) => routine.engine === "extract") ? "extract" : "render",
    window: approved.map((routine) => routine.select.window).reduce((a, b) => (RANK[b] > RANK[a] ? b : a)),
    participant: approved.every((routine) => routine.select.participant === "owner"),
    kinds: all((routine) => routine.select.kinds) ? [...new Set(approved.flatMap((routine) => routine.select.kinds))].sort() : null,
    units: [...new Set(approved.map((routine) => routine.select.unit))].sort(),
    maxUnits: all((routine) => routine.select.maxUnits) ? Math.max(...approved.map((routine) => routine.select.maxUnits)) : null,
    minEvents: all((routine) => routine.select.minEvents) ? Math.min(...approved.map((routine) => routine.select.minEvents)) : null,
    outputs: [...new Set(approved.flatMap((routine) => routine.outputs))].sort(),
    tokensPerRun: extract.length ? Math.max(...extract.map((routine) => routine.budget?.tokensPerRun ?? DEFAULT_BUDGET)) : 0,
  }
}

/** Whether a routine is within the recorded limits of a source whose consented kinds are `kinds` (§3.3). */
export function withinLimits(routine, limits, { sourceId, kinds }) {
  if (!limits) return false
  const select = routine.select
  if (!select.sources.every((id) => id === sourceId)) return false
  const wanted = select.kinds ?? kinds
  if (!wanted.every((kind) => kinds.includes(kind))) return false
  if (ENGINE[routine.engine] > ENGINE[limits.engine]) return false
  if (RANK[select.window] > RANK[limits.window]) return false
  if (limits.participant && select.participant !== "owner") return false
  if (limits.kinds && !wanted.every((kind) => limits.kinds.includes(kind))) return false
  if (!limits.units.includes(select.unit)) return false
  if (limits.maxUnits !== null && !(select.maxUnits <= limits.maxUnits)) return false
  if (limits.minEvents !== null && !(select.minEvents >= limits.minEvents)) return false
  if (!routine.outputs.every((output) => limits.outputs.includes(output))) return false
  if (routine.engine === "extract" && (routine.budget?.tokensPerRun ?? DEFAULT_BUDGET) > limits.tokensPerRun) return false
  return true
}

/** Whether `next` only narrows `was` (the same routine, by id): the closed list of §3.3. */
function narrows(was, next, kinds) {
  if (next.on !== was.on || next.select.unit !== was.select.unit) return false
  if (!next.select.sources.every((id) => was.select.sources.includes(id))) return false
  if (!(next.select.kinds ?? kinds).every((kind) => (was.select.kinds ?? kinds).includes(kind))) return false
  if (!(was.select.labels ?? []).every((label) => (next.select.labels ?? []).includes(label))) return false
  if (was.select.participant === "owner" && next.select.participant !== "owner") return false
  if (!same(was.select.latest, next.select.latest)) return false
  if (RANK[next.select.window] > RANK[was.select.window]) return false
  if (was.select.maxUnits !== undefined && !(next.select.maxUnits <= was.select.maxUnits)) return false
  if ((next.select.minEvents ?? 0) < (was.select.minEvents ?? 0)) return false
  if (ENGINE[next.engine] > ENGINE[was.engine]) return false
  if (next.engine === was.engine) {
    if (next.engine === "extract" && (next.budget?.tokensPerRun ?? DEFAULT_BUDGET) > (was.budget?.tokensPerRun ?? DEFAULT_BUDGET)) return false
    if (next.engine === "render" && (next.render.into !== was.render.into || next.render.max > was.render.max)) return false
    if (!next.outputs.every((output) => was.outputs.includes(output))) return false
  } else if (!next.outputs.every((output) => output === "journal")) {
    // extract → render: a render routine writes journal lines only.
    return false
  }
  return true
}

/**
 * Classify a later declaration against a consent.
 *
 * @param {{ snapshot: ReturnType<typeof snapshotOf>, limits: ReturnType<typeof limitsOf> }} consented
 * @param {any} live a declaration that passed validateManifest
 * @param {{ sourceId: string, kind: "package" | "local", edited?: boolean }} options
 * @returns {{ removed: boolean, items: { class: "narrowing" | "display" | "text" | "within" | "widening", what: string, applied: boolean }[], pending: object[], next: ReturnType<typeof snapshotOf> }}
 */
export function classify(consented, live, { sourceId, kind, edited = false }) {
  const items = []
  const applies = (cls) => cls === "narrowing" || (cls === "display" && !edited) || ((cls === "text" || cls === "within") && !edited && kind === "package")
  const note = (cls, what) => {
    const applied = applies(cls)
    items.push({ class: cls, what, applied })
    return applied
  }
  const was = consented.snapshot
  const liveSource = live.sources.find((entry) => entry.id === sourceId)
  if (!liveSource) {
    note("narrowing", `the plugin no longer declares the source ${sourceId}`)
    return { removed: true, items, pending: [], next: clone(was) }
  }
  const old = was.source
  const source = clone(old)

  for (const field of ["title", "summary", "setup"]) {
    if (old[field] !== liveSource[field] && note("display", `source ${field}`)) {
      if (liveSource[field] === undefined) delete source[field]
      else source[field] = liveSource[field]
    }
  }
  if (!same(old.input ?? {}, liveSource.input ?? {})) note("widening", "the input sent to events_list changed")

  // Kinds, grants and probe grants: a removal narrows, an addition waits.
  const kinds = old.kinds.filter((kind) => liveSource.kinds.includes(kind))
  if (kinds.length < old.kinds.length) note("narrowing", `kinds removed: ${old.kinds.filter((kind) => !kinds.includes(kind)).join(", ")}`)
  if (liveSource.kinds.some((kind) => !old.kinds.includes(kind))) note("widening", `kinds added: ${liveSource.kinds.filter((kind) => !old.kinds.includes(kind)).join(", ")}`)
  source.kinds = kinds
  const intersect = (oldList = [], liveList = [], label) => {
    const liveKeys = new Set(liveList.map(grantKey))
    const oldKeys = new Set(oldList.map(grantKey))
    const kept = oldList.filter((grant) => liveKeys.has(grantKey(grant)))
    if (kept.length < oldList.length) note("narrowing", `${label} removed: ${oldList.filter((grant) => !liveKeys.has(grantKey(grant))).map((grant) => grant.action).join(", ")}`)
    const added = liveList.filter((grant) => !oldKeys.has(grantKey(grant)))
    if (added.length) note("widening", `${label} added: ${added.map((grant) => `${grant.action} on ${grant.resource}`).join(", ")}`)
    return clone(kept)
  }
  source.grants = intersect(old.grants, liveSource.grants, "grants")
  const probe = intersect(old.probe?.grants, liveSource.probe?.grants, "probe grants")
  if (old.probe !== undefined || probe.length) source.probe = { grants: probe }

  // Scope keys.
  const liveScope = new Map((liveSource.scope ?? []).map((entry) => [entry.key, entry]))
  const oldScope = new Map((old.scope ?? []).map((entry) => [entry.key, entry]))
  const scope = []
  for (const entry of old.scope ?? []) {
    const now = liveScope.get(entry.key)
    if (!now) {
      note("narrowing", `scope key ${entry.key} removed`)
      continue
    }
    const kept = clone(entry)
    if (now.title !== entry.title && note("display", `scope key ${entry.key} title`)) kept.title = now.title
    if (now.max < entry.max) {
      note("narrowing", `scope key ${entry.key} max lower`)
      kept.max = now.max
    } else if (now.max > entry.max) note("widening", `scope key ${entry.key} max higher`)
    if (now.pattern !== entry.pattern || now.kind !== entry.kind || now.required !== entry.required || now.suggest !== entry.suggest) note("widening", `scope key ${entry.key} changed`)
    scope.push(kept)
  }
  for (const key of liveScope.keys()) if (!oldScope.has(key)) note("widening", `scope key ${key} added`)
  if (old.scope !== undefined) source.scope = scope

  const was30 = old.cadence?.everyMinutes ?? DEFAULT_CADENCE
  const now30 = liveSource.cadence?.everyMinutes ?? DEFAULT_CADENCE
  if (now30 > was30) {
    note("narrowing", "collected less often")
    source.cadence = { everyMinutes: now30 }
  } else if (now30 < was30) note("widening", "collected more often")
  if (!same(old.billing, liveSource.billing)) note("widening", "billing changed")

  // Routines, by content.
  const sourceKinds = old.kinds
  const unmatched = new Set(was.routines)
  const routines = []
  const textOf = (from, into) => {
    const out = clone(into)
    if (from.hints === undefined) delete out.hints
    else out.hints = from.hints
    if (out.render && from.render) {
      out.render.heading = from.render.heading
      out.render.line = from.render.line
    }
    return out
  }
  const displayOf = (from, into) => ({ ...into, title: from.title, summary: from.summary })
  for (const liveRoutine of (live.routines ?? []).filter((routine) => routine.select.sources.includes(sourceId))) {
    const byContent = [...unmatched].find((routine) => contentKey(routine) === contentKey(liveRoutine))
    if (byContent) {
      unmatched.delete(byContent)
      let entry = clone(byContent)
      if (displayKey(byContent) !== displayKey(liveRoutine) && note("display", `routine ${liveRoutine.id} title or summary`)) entry = displayOf(liveRoutine, entry)
      if (textKey(byContent) !== textKey(liveRoutine) && note("text", `routine ${liveRoutine.id} hints or render text`)) entry = textOf(liveRoutine, entry)
      // The id is a label only.
      if (byContent.id !== liveRoutine.id && note("display", `routine ${byContent.id} renamed ${liveRoutine.id}`)) entry.id = liveRoutine.id
      routines.push(entry)
      continue
    }
    const byId = [...unmatched].find((routine) => routine.id === liveRoutine.id)
    if (byId) {
      unmatched.delete(byId)
      let entry
      if (narrows(byId, liveRoutine, sourceKinds)) {
        note("narrowing", `routine ${liveRoutine.id} narrowed`)
        entry = { ...clone(liveRoutine), enabled: byId.enabled }
        // Its display and text are judged on their own, against what was confirmed.
        if (displayKey(byId) !== displayKey(liveRoutine) && !note("display", `routine ${liveRoutine.id} title or summary`)) entry = displayOf(byId, entry)
        if (liveRoutine.engine === byId.engine && textKey(byId) !== textKey(liveRoutine) && !note("text", `routine ${liveRoutine.id} hints or render text`)) entry = textOf(byId, entry)
      } else if (withinLimits(liveRoutine, consented.limits, { sourceId, kinds: sourceKinds })) {
        entry = note("within", `routine ${liveRoutine.id} changed within the limits`) ? { ...clone(liveRoutine), enabled: byId.enabled } : clone(byId)
      } else {
        note("widening", `routine ${liveRoutine.id} changed beyond the limits`)
        entry = clone(byId)
      }
      routines.push(entry)
      continue
    }
    if (withinLimits(liveRoutine, consented.limits, { sourceId, kinds: sourceKinds })) {
      if (note("within", `new routine ${liveRoutine.id} within the limits`)) routines.push({ ...clone(liveRoutine), enabled: true })
    } else note("widening", `new routine ${liveRoutine.id} beyond the limits`)
  }
  for (const routine of unmatched) note("narrowing", `routine ${routine.id} removed`)

  return { removed: false, items, pending: items.filter((item) => !item.applied), next: { source, routines } }
}
