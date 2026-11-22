/**
 * The daily routine (memory-v1-contracts.md §5, memory-funnel-v1.md §6):
 * noise filter → thread folding → entity linking → extraction → dedup →
 * policy → writes (memories, commitments, proposals, timelines, new people) →
 * journal page. The dashboard and lint run after it (index.js).
 *
 * The journal is written after the policy's writes so its bullets can link
 * the records they created; a failed write is reported in the journal, never
 * hidden.
 */
import { createHash } from "node:crypto"
import { dayBounds, dueDay } from "./dates.js"
import { batchUnits, buildPrompt, dedupWithinDay, similarity, validateItems, words } from "./extract.js"
import { clip, cleanLine, fold, normaliseTitle, rejectRule, shapes, agentActor } from "./guards.js"
import { citedBullets, mergeJournals, recordsCited, refsCited, renderJournal, survivingLines, cite, withoutCitation } from "./journal.js"
import { estimateTokens, BudgetExhausted } from "./llm.js"
import { buildIndex, capSessions, personFrom, prepareDay, quoteAuthor, slugify } from "./passes.js"
import { applyMode, decide, decidePeople } from "./policy.js"
import { createTraitGate } from "./traits.js"
import { emit } from "./log.js"
import { errorText } from "../text.js"

export const DAILY_VERSION = "daily@v1"
/**
 * The wait between the retries of a held claim, in hours (design §10.1): 1, 2,
 * 4, then 8, 16 and 24, and no more than a day apart however long the
 * classifier stays down. A hold is never set aside: attempts only set the pause.
 */
export const HOLD_BACKOFF_HOURS = Object.freeze([1, 2, 4, 8, 16, 24])

/** True when a hold's pause has passed: a claim tried once waits an hour, twice two, and so on. */
export function holdIsDue(hold, nowMs) {
  const attempts = Number(hold?.attempts) || 0
  if (attempts <= 0) return true
  const wait = HOLD_BACKOFF_HOURS[Math.min(attempts - 1, HOLD_BACKOFF_HOURS.length - 1)] * 3_600_000
  const last = Date.parse(hold?.attempted ?? hold?.created ?? "") || 0
  return nowMs >= last + wait
}

/** The output cap of one call when the deployment sets none (RECORDS_ROUTINE_MAX_OUTPUT_TOKENS). */
const MAX_OUTPUT_TOKENS = 4000
/** What a gate call may answer, as the budget is asked before it: the same allowance an extraction call carries. */
const BUDGET_ALLOWANCE = 4000
/** At most this many ids of each kind are kept in a run's `produced` list. */
const PRODUCED_MAX = 50
/** The store reads at most this many ids in one `get`; the journal merge asks in groups of this size. */
const MERGE_IDS_PER_READ = 50

/**
 * What a daily run records when the provider asked it to wait (a 429, the cell
 * breaker): the next tick retries it instead of debouncing it (lane 0198). It is
 * a code the run carries, never the words of its reason: a reworded sentence
 * must not change the queue.
 */
export const RETRY_NEXT_TICK = "next_tick"

/**
 * The stable key of a held claim: its own words and where they came from, never
 * the day. A hold is retried by later days, so its row must be found again
 * rather than written afresh each time (design §5.4).
 */
export function holdKey(item) {
  return `d1:hold:${createHash("sha256").update([item.type, item.ref, fold(item.quote), item.commitment_id ?? "", item.target_id ?? ""].join("|")).digest("hex").slice(0, 24)}`
}

export function itemKey(day, item) {
  return `d1:${createHash("sha256").update([day, item.type, item.ref, fold(item.quote), item.commitment_id ?? "", item.target_id ?? ""].join("|")).digest("hex").slice(0, 24)}`
}

/**
 * The gate cache's key for one text the classifier judges (lane 0198): what kind
 * of text it is and its folded words, which is exactly what the classifier is
 * shown. It never carries the day (the row does), so a title judged on one run of
 * a day is not asked again on the next, while a changed title is a new key. A
 * changed thread whose title is unchanged costs no classifier work at all.
 */
export function traitVerdictKey(kind, text, quote = "") {
  return `d1:trait:${createHash("sha256").update([kind, fold(text), fold(quote)].join("|")).digest("hex").slice(0, 24)}`
}

/**
 * A proposal's provenance: the routine's attribution of "person" is not the
 * person's word until they approve it in the console (routine-safety review,
 * item 2); it is the agent's meanwhile. External and agent stay as they are.
 */
function proposedBy(statedBy) {
  return statedBy === "person" ? "agent" : statedBy
}

function isConflict(error) {
  return error?.code === "version_conflict" || error?.status === 409
}

async function pageAll(fn, input, key, cap = 2000) {
  const out = []
  let cursor = null
  do {
    const page = await fn({ ...input, cursor, limit: 200 })
    out.push(...(page[key] ?? []))
    cursor = page.cursor
  } while (cursor && out.length < cap)
  return out
}

function identitiesFromId(id) {
  const m = /^([a-z][a-z0-9+.-]*):(.+)$/i.exec(String(id))
  if (!m) return {}
  const scheme = m[1].toLowerCase()
  // An agent, a bot or a service has no human identity to record (FINDINGS R3).
  if (["agent", "bot", "service", "system", "tool"].includes(scheme)) return {}
  const value = m[2].replace(/^@/, "")
  const kind = { mailto: "email", slack: "slack", x: "x", twitter: "x", github: "github", gh: "github" }[scheme] ?? scheme
  return { [kind]: value }
}

function evidenceOf(info, quote) {
  return info?.type === "turn" ? { turn: info.ref, quote } : { event: info?.ref, quote }
}

function sourceOf(info, version) {
  return info?.type === "turn" ? { turn: info.ref, routine: version } : { event: info?.ref, ...(info?.url ? { url: info.url } : {}), routine: version }
}

/**
 * Does the core still hold a held claim's turn? `"gone"` only on a definite
 * answer from a reachable core that the turn is not there — the person forgot it
 * — and `"unknown"` for a fault, a timeout, an unavailable core, or a listing
 * that failed: a fault is not proof, and the claim keeps waiting (design §5.4).
 * An event's ref is not a turn, and the store's own tombstones cover it.
 */
async function turnState({ core, coreScope, ref, refs }) {
  const isTurn = typeof ref === "string" && !/^evt_/.test(ref) && (refs?.type === "turn" || /^msg-/.test(ref))
  if (!isTurn) return "present"
  if (!core?.available || !coreScope) return "unknown"
  const at = typeof refs?.at === "string" && !Number.isNaN(Date.parse(refs.at)) ? refs.at : null
  if (!at) return "unknown"
  const start = new Date(Date.parse(at) - 86_400_000).toISOString()
  const end = new Date(Date.parse(at) + 86_400_000).toISOString()
  const read = async (scope) => {
    const report = typeof core.turnsReport === "function" ? await core.turnsReport(scope) : { ok: true, turns: await core.turns(scope) }
    if (!report?.ok) return "unknown"
    return (report.turns ?? []).some((row) => String(row.id) === ref) ? "present" : "gone"
  }
  try {
    // The turn's own pair, read directly: a listing misses an agent that exists
    // only as an `agent_id` on a turn, so a listing must never decide "gone".
    const userId = typeof refs?.user_id === "string" ? refs.user_id : null
    const agentId = typeof refs?.agent_id === "string" ? refs.agent_id : null
    if (userId && agentId) {
      return await read({ ...coreScope, userId, pairs: [{ userId, agentId }], start, end })
    }
    // A hold from before the pair travelled with it: the listing may answer, and
    // only when it fully succeeded.
    return await read({ ...coreScope, pairs: undefined, agents: undefined, start, end })
  } catch {
    return "unknown"
  }
}

/**
 * Whose claim this is (design §5.4): the person's own, or another person's when
 * it names one or someone else wrote it. An unknown subject counts as another
 * person, so the lexicon's drop is the safe default.
 */
function subjectOf(item, author) {
  const people = (item.entities ?? []).filter((path) => typeof path === "string" && path.startsWith("people/"))
  const otherOwner = item.owner && !["user", "agent"].includes(String(item.owner))
  if (people.length > 0 || otherOwner) return "other"
  return author?.self ? "person" : "other"
}

/**
 * The trait gate before filing (design §5.4, trust H5): a deterministic
 * lexicon over every claim, then a small-tier classifier over what it passed.
 * A claim that infers a sensitive trait is dropped; a claim the classifier
 * cannot answer is held in the space and retried by a later run, never dropped
 * and never applied. Only counts are kept, never the text.
 */
async function gateTraitClaims({ space, actor, day, items, prep, llm, breaker, budget, run, saveRun, log, team, maxTokens, modelDown = false, now = () => new Date(), core = null, coreScope = null }) {
  const held = typeof space.listTraitHolds === "function" ? ((await space.listTraitHolds({ limit: 500 }, actor)).holds ?? []) : []
  // This day's verdicts (lane 0198): a title or claim the classifier already
  // judged is not sent again, so a tick that re-reads the day pays only for what
  // is new or changed. A read that fails costs a re-judge, never the run.
  const judged = typeof space.traitReads === "function" ? await space.traitReads({ day }, actor).catch(() => ({ reads: [] })) : { reads: [] }
  const known = new Map((judged.reads ?? []).map((read) => [read.key, read.verdict]))
  const candidates = []
  const retried = new Map()
  // A hold waits out its pause; it is never set aside, however many times the
  // classifier has failed (design §10.1).
  const nowMs = now().getTime()
  let waiting = 0
  for (const hold of held) {
    let item = null
    let refs = null
    try {
      item = JSON.parse(hold.item)
      refs = hold.refs ? JSON.parse(hold.refs) : null
    } catch {
      item = null
    }
    // A hold whose ref can no longer be read says so and waits for a person.
    if (!item?.ref) continue
    if (!holdIsDue(hold, nowMs)) {
      waiting += 1
      continue
    }
    // A turn the core no longer holds was forgotten there: its claim goes with
    // it, and the hold with the claim (design §8.5). A core that cannot answer
    // says nothing, so the claim waits and spends no attempt.
    const turn = await turnState({ core, coreScope, ref: item.ref, refs })
    if (turn === "gone") {
      if (typeof space.releaseTraits === "function") await space.releaseTraits({ keys: [hold.key] }, actor)
      emit(log, "info", { event: "memory.routine.trait", team, ref: item.ref, category: "forgotten" })
      continue
    }
    if (turn === "unknown") {
      waiting += 1
      continue
    }
    // The day that held it has gone: its own text travels with the claim, so any
    // later run files it exactly as the policy would have (design §5.4).
    if (!prep.refs.has(item.ref) && refs?.ref === item.ref) prep.refs.set(item.ref, refs)
    if (!prep.refs.has(item.ref)) {
      waiting += 1
      continue
    }
    retried.set(itemKey(day, item), hold.key)
    candidates.push(item)
  }
  for (const item of items) if (!retried.has(itemKey(day, item))) candidates.push(item)
  // The journal copies a source's own titles: every thread's title, and every
  // source's title under Sources, so they are gated too (design §5.4). A
  // subject line may carry a trait as surely as a quote does, and a day with no
  // claim, or a cell with no model, must withhold it all the same.
  const seenTitles = new Map()
  const titles = []
  const addTitle = (title, about, refs = []) => {
    const key = normaliseTitle(title)
    if (!key) return
    const seen = seenTitles.get(key)
    if (seen) {
      // The same subject in two places: anyone else's copy makes it another
      // person's title, and the lexicon alone decides it. Every ref the title
      // was printed for is kept, so a withheld title can be found by its ref.
      if (about === "other") seen.about = "other"
      for (const ref of refs) if (ref) seen.refs.add(ref)
      return
    }
    const entry = { index: titles.length, text: String(title), about, refs: new Set(refs.filter(Boolean)), key: traitVerdictKey("title", title) }
    seenTitles.set(key, entry)
    titles.push(entry)
  }
  // Whose title it is: the person's own words about themselves (so the
  // classifier is the judge), or anyone else's, which the lexicon alone decides.
  for (const info of prep.refs.values()) {
    if (!info.title) continue
    const self = info.segments.some((segment) => segment.author.self)
    const another = info.segments.some((segment) => !segment.author.self && segment.author.path)
    addTitle(info.title, self && !another ? "person" : "other", [info.ref])
  }
  for (const unit of prep.units) addTitle(unit.title, "other", unit.refs ?? (unit.items ?? []).map((item) => item.ref))
  if (candidates.length === 0 && titles.length === 0) {
    return {
      items,
      stats: held.length > 0 ? { dropped: 0, held: 0, unresolved: held.length, waiting, titles: 0, withheld_titles: [], categories: {}, cached: 0, classifier: { calls: 0, errors: 0, breaker: "closed" } } : null,
    }
  }
  // Every classifier call is the run's: its tokens are charged to the run and
  // to the day's budget, as an extraction call is (design §5.4, §10.1), and its
  // breaker is the tier's own, never the routines-and-jobs one.
  // A run whose extraction never reached the model is not a run to ask again:
  // the gate holds its claims and lets the lexicon judge the titles.
  const usable = modelDown ? null : llm
  const client = usable
    ? {
        get available() {
          return usable.available !== false
        },
        complete: async (input) => {
          // The day's budget is checked with the same allowance an extraction
          // call uses, so a small classifier call cannot overrun a spent day.
          const estimate = estimateTokens(input.system) + estimateTokens(input.user) + BUDGET_ALLOWANCE
          if (budget && typeof budget.check === "function") budget.check(estimate)
          const answer = await usable.complete(input)
          if (run) {
            // What the provider reported is what is charged, a reported 0
            // included; only an answer with no usage at all falls back to the
            // estimate (S0's billed-only rule).
            // The gate's tokens are the run's, and only what the provider
            // reported (S0's billed-only rule, scale H5): a reported 0 is a
            // report too, so the estimate is the fallback only when the answer
            // carries no usage at all, never a charge of its own.
            const billed = Number(answer?.usage?.total)
            run.tokens += Number.isFinite(billed) ? billed : estimate
            run.calls += Number(answer?.calls) || 1
            run.cost += Number(answer?.cost) || 0
            if (saveRun) await saveRun()
          }
          return answer
        },
      }
    : null
  // The gate's call carries the same output allowance an extraction call does
  // (RECORDS_ROUTINE_MAX_OUTPUT_TOKENS): a ceiling, never a charge.
  const gate = createTraitGate({ llm: client, breaker, maxTokens })
  // Who wrote the claim, and whose it is (design §5.4): a lexicon hit on a claim
  // whose subject is another person drops it whoever wrote it, and the
  // classifier is the judge only for a claim about the person themselves.
  const claim = (item, index) => {
    const author = quoteAuthor(prep.refs.get(item.ref), item.quote, fold)
    return { index, text: item.text, quote: item.quote, author: author?.self ? "person" : "other", about: subjectOf(item, author), ref: item.ref, key: traitVerdictKey("claim", item.text, item.quote) }
  }
  const answer = await gate.gate({ claims: candidates.map(claim), titles, known })
  const released = []
  const kept = []
  answer.kept.forEach((index) => {
    kept.push(candidates[index])
    const key = retried.get(itemKey(day, candidates[index]))
    if (key) released.push(key)
  })
  for (const entry of answer.dropped) {
    emit(log, "info", { event: "memory.routine.trait", team, ref: candidates[entry.index].ref, category: entry.category, by: entry.by })
    const key = retried.get(itemKey(day, candidates[entry.index]))
    if (key) released.push(key)
  }
  // A hold the day's cache answers is settled by an earlier run's verdict: the
  // claim is dropped here too, so its hold is released rather than waiting
  // forever and keeping the day `held` (review M). It is not logged or counted
  // again as a new drop; the run that judged it did both.
  for (const entry of answer.cachedDrops ?? []) {
    const key = retried.get(itemKey(day, candidates[entry.index]))
    if (key) released.push(key)
  }
  const holds = answer.held.map((entry) => {
    const item = candidates[entry.index]
    return { key: holdKey(item), ref: item.ref, item: JSON.stringify(item), refs: JSON.stringify(prep.refs.get(item.ref) ?? null), reason: entry.reason, attempted: entry.attempted === true }
  })
  if (holds.length > 0 && typeof space.holdTraits === "function") await space.holdTraits({ holds }, actor)
  if (released.length > 0 && typeof space.releaseTraits === "function") await space.releaseTraits({ keys: released }, actor)
  // This run's answers join the day's cache (lane 0198): the next tick's gate
  // reads them instead of buying them again. A hold is never among them.
  if (answer.cacheable?.length > 0 && typeof space.markTraitReads === "function") {
    try {
      await space.markTraitReads({ day, reads: answer.cacheable }, actor)
    } catch (error) {
      // A cache that does not land costs a re-judge on the next run, never this one.
      emit(log, "warn", { event: "memory.routine.trait", team, error: errorText(String(error?.message ?? error), 200) })
    }
  }
  // The queue as it stands after this run's filings, drops and releases: a hold
  // whose turn the core has lost has gone, and the run is clear.
  const unresolved = typeof space.listTraitHolds === "function" ? ((await space.listTraitHolds({ limit: 1 }, actor))?.total ?? 0) : answer.held.length + waiting
  const stats = {
    dropped: answer.dropped.length,
    held: answer.held.length,
    unresolved,
    waiting,
    titles: answer.titles.dropped.length + answer.titles.held.length,
    withheld_titles: [...answer.titles.dropped, ...answer.titles.held].map((entry) => normaliseTitle(titles[entry.index].text)),
    // The refs those titles were printed for: a merge withholds a line by its
    // ref when the text is no longer the title's own (review M1).
    withheld_refs: [...new Set([...answer.titles.dropped, ...answer.titles.held].flatMap((entry) => [...(titles[entry.index].refs ?? [])]))],
    categories: answer.metrics.drops,
    classifier: { calls: answer.metrics.calls, errors: answer.metrics.errors, breaker: answer.metrics.breaker },
    // Texts this run did not ask the classifier about because the day's gate
    // had already judged them (lane 0198).
    cached: answer.metrics.cached ?? 0,
  }
  return { items: kept, stats }
}

/**
 * Run the daily passes for one space and one local day.
 *
 * @param {object} ctx
 * @param {any} ctx.space SpaceStore
 * @param {object} ctx.actor the routine's actor
 * @param {string} ctx.spaceId the control space id (logs)
 * @param {"personal"|"shared"|null} ctx.spaceKind the kind the space's file recorded, null when no
 *   build recorded one; only `"personal"` reads events (see the inputs below)
 * @param {{teamId: string, userId?: string, serviceId?: string} | null} ctx.coreScope where the
 *   space's turns live in the core: its container, and its owner for a personal space; null reads none
 * @param {string} ctx.day YYYY-MM-DD
 * @param {string} ctx.tz
 * @param {{user: string|null, label: string}} ctx.owner the space's person
 * @param {any} ctx.llm createLlm()
 * @param {any} ctx.core createCoreReader()
 * @param {any} ctx.budget openBudget()
 * @param {any} ctx.run the run record (tokens, calls are updated in place)
 * @param {() => Promise<void>} ctx.saveRun persists the run
 * @param {{proposalTtlDays: number, budgetTokens: number, batchChars?: number}} ctx.config
 * @param {any} ctx.log
 * @param {{shapes?: Function, decide?: Function, validateItems?: Function}} [ctx.deps] overridable for mutation tests
 */
export async function runDaily(ctx) {
  const { space, actor, spaceId, spaceKind, coreScope, day, tz, owner, llm, core, budget, run, saveRun, config, log } = ctx
  const teamId = spaceId
  const deps = { shapes, decide, validateItems, ...(ctx.deps ?? {}) }
  // One call's output cap, and the reserve it takes from the day's budget: a
  // deployment that raises it must raise the extraction shim's time budget too
  // (records/README.md, RECORDS_ROUTINE_MAX_OUTPUT_TOKENS).
  const maxOutputTokens = config.maxOutputTokens ?? MAX_OUTPUT_TOKENS
  const version = DAILY_VERSION
  const journalPath = `journal/${day}`
  const { start, end } = dayBounds(day, tz)
  // What had arrived when this run began: an event ingested after this instant
  // was in no unit this run reads, so the day stays due (review H1). It is taken
  // **before** the day is read and saved by every path, the empty ones
  // included, so nothing that arrived during a run counts as seen.
  const ingestedThrough = typeof ctx.now === "function" ? ctx.now().toISOString() : new Date().toISOString()

  // Journal lock: a journal the person edited (or wrote) is never overwritten.
  const { records: heads } = await space.get({ paths: [journalPath, "index"] }, actor)
  const existingJournal = heads.find((r) => r.path === journalPath) ?? null
  const indexPage = heads.find((r) => r.path === "index") ?? null
  if (existingJournal && (existingJournal.fields?.edited === true || !existingJournal.fields?.routine)) {
    return { status: "skipped", reason: "the journal was edited by a person", journal: journalPath, ingested_through: ingestedThrough }
  }

  // Inputs.
  //
  // A shared space's members' turns and events are never read (0.15.1,
  // docs/design/adr-team-capture-routine.md): the container holds every
  // member's team-captured turns, and a source bound before v0.9.12 could have
  // left one member's mail or chat there. Reading either would quote one
  // member's words into records the others read. Its pages, memories and
  // commitments still feed the journal below.
  const shared = owner?.shared === true
  // Events are read only in a space whose recorded kind is `"personal"`, the
  // same fail-closed rule as the turns above: a space with no recorded kind is
  // not known to be personal, and its event file may be a shared space's
  // (lane 0174).
  const personal = spaceKind === "personal"
  const turns = !shared && core?.available && coreScope ? await core.turns({ ...coreScope, start, end }) : []
  // `include_skipped`: the routine counts the sessions capture owns rather than
  // letting the store's read hide the count from it (B8).
  // The day's events: history an anchor or an import brought is not this day's work (lane 0195b), even when the day itself is queued
  // for the captured turns it holds.
  const events = personal ? (await pageAll((i) => space.listEvents(i, actor), { since: start, until: end, include_skipped: true }, "events", 5000)).filter((event) => event.history !== true) : []
  if (turns.length === 0 && events.length === 0) {
    const reason = shared ? await sharedQuietReason() : "a quiet day: no turns or events"
    return { status: "skipped", reason, ingested_through: ingestedThrough }
  }

  /**
   * Why a shared space's day has nothing to journal, saying exactly what was
   * and was not read: its members' turns and events are not read, and whether
   * any record of any kind changed that day, so the reason never says "nothing
   * else" over a page, memory or commitment someone wrote.
   */
  async function sharedQuietReason() {
    let changed = null
    try {
      const answer = await space.list({ updated_after: start, limit: 1 }, actor)
      changed = (answer?.records ?? []).length > 0
    } catch {
      changed = null
    }
    if (changed === null) return "a shared space's conversation turns and collected events are not read, so there is no day to journal; whether records changed that day is unknown"
    return changed
      ? "a shared space's conversation turns and collected events are not read, so there is no day to journal; a record changed that day and is not summarised here"
      : "a shared space's conversation turns and collected events are not read, and nothing else changed that day"
  }
  // One session, one curator (DESIGN §15.1, B8): the first side to see a session
  // owns its curation. A session History owns is curated from its events, and
  // capture's L0 turns are skipped; a session capture owns is curated from its
  // turns, and History's events are skipped. Skipping is a read-time decision,
  // counted here and never destructive.
  const sessionIds = [...new Set([...turns.map((t) => t.session_id), ...events.map((e) => e.session_id)].filter(Boolean))]
  const owners = sessionIds.length > 0 ? ((await space.sessionsOwner({ session_ids: sessionIds }, actor))?.owners ?? {}) : {}
  const historyOwned = new Set(Object.entries(owners).filter(([, side]) => side === "history").map(([id]) => id))
  const captureOwned = new Set(Object.entries(owners).filter(([, side]) => side === "capture").map(([id]) => id))
  const curatedTurns = turns.filter((t) => !(t.session_id && historyOwned.has(t.session_id)))
  const curatedEvents = events.filter((e) => !(e.session_id && captureOwned.has(e.session_id)))
  const sessionSkipped = turns.length - curatedTurns.length + (events.length - curatedEvents.length)

  const list = (input, cap) => pageAll((i) => space.list({ ...i, full: true }, actor), input, "records", cap)
  const [{ sources = [] } = {}, people, projects, commitmentsAll, memoriesAll, proposalsAll, changedToday] = await Promise.all([
    space.listSources({}, actor),
    list({ kind: "page", type: "person" }, 1000),
    list({ kind: "page", type: "project" }, 500),
    list({ kind: "commitment", status: "all" }, 2000),
    list({ kind: "memory", status: "all" }, 2000),
    list({ kind: "proposal", status: "all" }, 2000),
    list({ kind: "memory", updated_after: start }, 400),
  ])
  const openCommitments = new Map(commitmentsAll.filter((c) => c.status === "current" && c.fields?.state === "open").map((c) => [c.id, c]))
  // Every current memory, not the first 60: `buildPrompt` carries at most
  // MEMORIES_PER_PROMPT of them per call, those about the batch's entities
  // (FINDINGS R2), and `memoryIds` below stays the whole set for validation.
  const currentMemories = memoriesAll.filter((m) => m.status === "current" && ["decision", "fact", "constraint", "preference"].includes(m.type))
  const rules = memoriesAll.filter((m) => m.type === "preference" && m.status === "current").map((m) => rejectRule(m.title) ?? rejectRule(m.body)).filter(Boolean)
  const byKey = new Map()
  for (const r of [...commitmentsAll, ...memoriesAll, ...proposalsAll, ...people]) if (r.fields?.routine_key) byKey.set(r.fields.routine_key, r)

  const person = personFrom({
    user: owner?.user ?? null,
    label: owner?.label ?? indexPage?.fields?.name ?? "you",
    sources,
    identities: indexPage?.fields?.identities ?? {},
    names: indexPage?.fields?.aliases ?? [],
    shared: owner?.shared === true,
  })
  const index = buildIndex({ people, projects })
  const prep = prepareDay({ turns: curatedTurns, events: curatedEvents, person, rules, index })
  for (const w of prep.withheld) emit(log, "info", { event: "memory.routine.withheld", team: teamId, ref: w.ref, shapes: w.shapes })
  for (const d of prep.dropped) emit(log, "debug", { event: "memory.routine.noise", team: teamId, ref: d.ref, reason: d.reason })

  // Read marks (daily-yield FINDINGS R6): a unit the model already read, with
  // the same refs, is not sent again, so a re-run reads only what a late event
  // or a changed thread added. The day's units stay whole for the journal;
  // only what is unread is batched. A build without the store's marks reads
  // the day whole, as it always did.
  const marks = typeof space.unitReads === "function" ? await space.unitReads({ day }, actor).catch(() => ({ reads: [] })) : { reads: [] }
  const alreadyRead = new Map((marks.reads ?? []).map((m) => [m.key, m.fingerprint]))
  const pending = prep.units.filter((u) => alreadyRead.get(u.key) !== u.fingerprint)
  if (prep.units.length > 0 && pending.length === 0) {
    // A claim waiting on the trait classifier is still this day's work (design
    // §5.4): the day is not done while a hold waits, so its retry runs even
    // though every unit is already marked read. With no hold, the day is
    // skipped as it always was.
    const waiting = typeof space.listTraitHolds === "function" ? ((await space.listTraitHolds({ limit: 500 }, actor))?.holds ?? []) : []
    if (waiting.length === 0) {
      return { status: "skipped", reason: "nothing new to read in this day", journal: null, ingested_through: ingestedThrough, counts: { units: prep.units.length, items: prep.refs.size, read: 0, unread: 0 } }
    }
  }
  /** Marks one batch's units read: only after its call succeeded. */
  const markRead = async (units) => {
    if (typeof space.markUnitsRead !== "function" || units.length === 0) return
    try {
      await space.markUnitsRead({ day, units: units.map((u) => ({ key: u.key, fingerprint: u.fingerprint })), run: run.id }, actor)
    } catch (error) {
      // A mark that does not land only costs a re-read later: never the run.
      emit(log, "warn", { event: "memory.routine.mark", team: teamId, error: errorText(String(error?.message ?? error), 200) })
    }
  }

  // Extraction, one call per batch, inside the budget.
  const paths = new Set([...index.people.map((p) => p.path), ...index.projects.map((p) => p.path)])
  const commitmentIds = new Set(openCommitments.keys())
  const memoryIds = new Set(currentMemories.map((m) => m.id))
  const extracted = []
  const rejected = []
  let budgetStopped = false
  /** The cell's breaker refused this run before any call: the day stays queued. */
  let cellHeld = false
  /** The provider asked to wait: this run stops and the day stays queued. */
  let rateLimited = false
  let unreadUnits = 0
  let llmError = null
  let llmOk = 0
  let readUnits = 0
  /** The units this run read: a catch-up run names them as read late. */
  const readList = []
  /** What the provider billed for the calls that failed: the journal says so. */
  let failedTokens = 0
  // Coding sessions take at most their share of this run's data; the rest stay
  // unread for the next run or for catch-up (FINDINGS R1).
  const sending = capSessions(pending, config.batchChars ?? 24_000).units
  const batches = llm?.available ? batchUnits(sending, config.batchChars ?? 24_000) : []
  if (!llm?.available) llmError = "no model is configured"
  const startedAt = Date.now()
  for (let b = 0; b < batches.length; b += 1) {
    const units = batches[b]
    if (Number.isFinite(config.maxRunMs) && Date.now() - startedAt > config.maxRunMs) {
      // The longest run (FABLE records #6): a run past it stops calling the model.
      llmError = "the run reached its time limit"
      unreadUnits = pending.length - readUnits
      break
    }
    const prompt = buildPrompt({ day, person, index, openCommitments: [...openCommitments.values()], currentMemories, units })
    try {
      budget.check(estimateTokens(prompt.system) + estimateTokens(prompt.user) + maxOutputTokens)
    } catch (error) {
      if (!(error instanceof BudgetExhausted)) throw error
      budgetStopped = true
      unreadUnits = pending.length - readUnits
      break
    }
    let answer
    try {
      answer = await llm.complete({ ...prompt, maxTokens: maxOutputTokens })
    } catch (error) {
      // The provider's own words, kept twice more than the run ledger: in the
      // journal page ("The model failed on part of the day (…)") and in this log
      // line. The store's gate withholds a *named* secret but not one in a URL
      // query, so a SAS signature was stored whole in a page that is indexed and
      // shown; `errorText` keeps the host and drops the query (0.11 review,
      // round 3).
      llmError = errorText(String(error?.message ?? error), 300)
      emit(log, "warn", { event: "memory.routine.llm", team: teamId, error: llmError })
      if (error?.code === "llm_rate_limited") {
        // A 429 storm: the provider asked to wait. This run stops its remaining
        // batches rather than waiting again for each, and leaves them unread
        // for the next tick (review M2).
        run.calls += Number(error?.calls) || 1
        await saveRun()
        unreadUnits = pending.length - readUnits
        rateLimited = true
        break
      }
      if (error?.code === "llm_breaker") {
        // The circuit breaker is open: no call was made, and none will be this
        // run. The cell's breaker is the provider's, not this space's: a run it
        // refused is not failed, and the day stays queued (scale H5).
        unreadUnits = pending.length - readUnits
        if (error.cell === true && llmOk === 0) cellHeld = true
        break
      }
      if (error instanceof BudgetExhausted || error?.code === "budget") {
        // The shared per-space budget (routines and jobs together) refused the
        // call: no call was made, and the rest of the day waits for tomorrow.
        budgetStopped = true
        unreadUnits = pending.length - readUnits
        break
      }
      // Only what the provider billed is charged (scale H5): its own usage when
      // it answered with one, the prompt on a timeout after sending, and nothing
      // else — a refused or failed call is not billed and does not spend the cap.
      run.calls += Number(error?.calls) || 1
      const billed = Number.isFinite(error?.tokens) ? error.tokens : 0
      run.tokens += billed
      failedTokens += billed
      await saveRun()
      continue
    }
    llmOk += 1
    run.calls += Number(answer.calls) || 1
    run.tokens += answer.usage.total
    run.cost += answer.cost
    await saveRun()
    const batchRefs = new Set(units.flatMap((u) => u.items.map((i) => i.ref)))
    const valid = deps.validateItems(answer.json, { day, refs: prep.refs, batchRefs, paths, commitmentIds, memoryIds, commitments: openCommitments })
    extracted.push(...valid.items)
    rejected.push(...valid.rejected)
    readUnits += units.length
    readList.push(...units)
  }
  if (unreadUnits === 0) unreadUnits = pending.length - readUnits
  if (rateLimited && llmOk === 0) {
    // Nothing was read and nothing was written: the day is queued again, not failed.
    return { status: "skipped", reason: "the model asked to wait (rate limited): the day is read on the next tick", retry: RETRY_NEXT_TICK, journal: null, ingested_through: ingestedThrough, counts: { units: prep.units.length, items: prep.refs.size, read: 0, unread: unreadUnits } }
  }
  if (cellHeld) {
    // Nothing was read and nothing was written: the day is queued again, not failed.
    return { status: "skipped", reason: "the model is resting: the provider's breaker is open", retry: RETRY_NEXT_TICK, journal: null, ingested_through: ingestedThrough, counts: { units: prep.units.length, items: prep.refs.size, read: 0, unread: unreadUnits } }
  }

  for (const r of rejected) emit(log, "info", { event: "memory.routine.rejected", team: teamId, reason: r.reason, ref: r.item?.ref ?? null })

  // Dedup within the day, then the trait gate (§5.4), then policy, then dedup
  // against the space.
  const gated = await gateTraitClaims({
    space,
    actor,
    day,
    items: dedupWithinDay(extracted),
    prep,
    llm: ctx.traitLlm ?? llm,
    breaker: ctx.traitBreaker,
    budget,
    run,
    saveRun,
    maxTokens: maxOutputTokens,
    modelDown: batches.length > 0 && llmOk === 0,
    now: ctx.now ?? (() => new Date()),
    core,
    coreScope,
    log,
    team: teamId,
  })
  const items = gated.items
  const decided = []
  const seenTexts = []
  for (const item of items) {
    const d = { item, key: itemKey(day, item), ...deps.decide(item, { refs: prep.refs, index, openCommitments, guards: { shapes: deps.shapes }, mode: config.apply }) }
    if (d.outcome === "drop") {
      emit(log, "info", { event: "memory.routine.dropped", team: teamId, ref: item.ref, type: item.type, reason: d.reason })
      decided.push(d)
      continue
    }
    const prior = byKey.get(d.key)
    if (prior) {
      // A re-run: the same item from the same evidence. Never written twice.
      d.record = prior.id
      d.again = true
      if (prior.kind === "proposal" && prior.status === "rejected") {
        d.outcome = "known"
        d.rejectedBefore = true
      }
    } else if (["decision", "fact", "preference", "constraint", "procedure"].includes(item.type)) {
      const query = words(item.text).slice(0, 8).join(" ")
      const { hits = [] } = query ? await space.search({ query, kinds: ["memory"], status: "all", limit: 5 }, actor) : {}
      const same = hits.find((h) => similarity(h.title, item.text) >= 0.7)
      const sameToday = seenTexts.find((t) => t.type === item.type && similarity(t.text, item.text) >= 0.7)
      if (same || sameToday) {
        d.outcome = "known"
        d.record = same?.id ?? sameToday?.record ?? null
      }
    } else if (item.type === "commitment_open") {
      const same = [...openCommitments.values()].find((c) => similarity(c.fields?.what ?? c.title, item.text) >= 0.6)
      if (same) {
        d.outcome = "known"
        d.record = same.id
      }
    }
    seenTexts.push({ type: item.type, text: item.text, record: d.record })
    decided.push(d)
  }

  // Just before the writes (FABLE records #2): the space still exists, and
  // nothing a person forgot or deleted, by routine key, source ref or
  // forgotten text, is written back, even if it was forgotten during the run.
  const writable = decided.filter((d) => ["apply", "propose", "journal", "known"].includes(d.outcome))
  const unitChecks = prep.units.map((u) => ({ refs: u.items.map((i) => i.ref), texts: [u.title, ...u.items.map((i) => prep.refs.get(i.ref)?.title ?? "")] }))
  const check = await space.routineCheck(
    { items: [...writable.map((d) => ({ key: d.key, refs: [d.item.ref], texts: [d.item.text, d.item.quote] })), ...unitChecks] },
    actor,
  )
  if (!check.exists) return { status: "skipped", reason: "the space was purged during the run" }
  let forgotten = 0
  // Keyed hashes of the skipped items' titles (never their text): the console counts them.
  const forgottenTitles = []
  let forgottenLines = 0
  for (const { index: i, why, hash } of check.blocked) {
    if (i < writable.length) {
      const d = writable[i]
      d.outcome = "forgotten"
      d.reason = `a person forgot it (${why})`
      d.again = false
      forgotten += 1
      if (hash && forgottenTitles.length < 200) forgottenTitles.push(hash)
      emit(log, "info", { event: "memory.routine.forgotten", team: teamId, ref: d.item.ref, type: d.item.type, why })
    } else {
      // A thread whose title or source a person forgot keeps no title in the journal.
      const unit = prep.units[i - writable.length]
      forgottenLines += 1
      unit.title = "(a forgotten item)"
      for (const it of unit.items) {
        const info = prep.refs.get(it.ref)
        if (info) info.title = null
      }
    }
  }

  // Writes.
  const expires = new Date(Date.parse(end) + (config.proposalTtlDays ?? 30) * 86_400_000).toISOString()
  const pageBodies = new Map([...people, ...projects].map((p) => [p.path, p.body ?? ""]))
  const titleOf = (path) => index.people.find((p) => p.path === path)?.title ?? index.projects.find((p) => p.path === path)?.title ?? path
  const failures = []
  let lastForgotten = false
  // What this run wrote, by id or path, so the console links a run to its
  // results (0.9.8, FABLE console-ux 4): proposals, memories and commitments,
  // and the pages it added a timeline line to. Ids only, at most 50 of each.
  const produced = { proposals: new Set(), records: new Set(), timelines: new Set() }
  const noteProduced = (what, done) => {
    const record = done?.record ?? done
    if (!record || typeof record !== "object") return
    const add = (set, value) => {
      if (typeof value === "string" && value && set.size < PRODUCED_MAX) set.add(value)
    }
    if (what.startsWith("timeline ")) add(produced.timelines, record.path ?? what.slice("timeline ".length))
    else if (record.kind === "proposal") add(produced.proposals, record.id)
    else if (record.kind === "memory" || record.kind === "commitment") add(produced.records, record.id)
  }
  const tryWrite = async (what, fn) => {
    lastForgotten = false
    try {
      const done = await fn()
      noteProduced(what, done)
      return done
    } catch (error) {
      if (error?.code === "forgotten") {
        // The store's own check: a forget landed after routineCheck.
        forgotten += 1
        lastForgotten = true
        emit(log, "info", { event: "memory.routine.forgotten", team: teamId, what, why: "store" })
        return null
      }
      if (error?.code === "space_gone") throw error
      failures.push(`${what}: ${error?.code ?? ""} ${error?.message ?? error}`.trim())
      emit(log, "warn", { event: "memory.routine.write", team: teamId, what, code: error?.code ?? null, error: errorText(String(error?.message ?? error), 200) })
      return null
    }
  }
  const evidenceBody = (d) => {
    const info = prep.refs.get(d.item.ref)
    const links = d.item.entities.map((p) => `[[${p}]]`).join(" ")
    return `${d.item.text}\n\nEvidence: “${cleanLine(d.item.quote, 300)}” ${cite(info)}${links ? `\n\nAbout: ${links}` : ""}`
  }
  const proposal = async (d, action, extra) => {
    const info = prep.refs.get(d.item.ref)
    const { record } = await space.put(
      {
        record: {
          kind: "proposal",
          type: action,
          title: clip(`${action.replace("_", " ")}: ${d.item.text}`, 200),
          body: `${evidenceBody(d)}\n\nWhy it waits: ${d.reason}.`,
          status: "proposed",
          // Never the person's until they approve it in the console (the browser
          // session stamps person); attributed_to says whose words the routine thinks these are.
          stated_by: proposedBy(d.stated_by),
          source: sourceOf(info, version),
          owner: person.user ?? undefined,
          fields: { action, reason: d.reason, attributed_to: d.stated_by, evidence: [evidenceOf(info, cleanLine(d.item.quote, 300))], expires, routine: version, routine_key: d.key, ...extra },
        },
      },
      actor,
    )
    return record
  }
  const ownerName = (owner) => (owner && owner.startsWith("people/") ? titleOf(owner) : owner)

  for (const d of decided) {
    if (d.again || !["apply", "propose"].includes(d.outcome)) continue
    const { item } = d
    const info = prep.refs.get(item.ref)
    if (item.type === "timeline") {
      for (const path of item.entities) {
        const body = pageBodies.get(path) ?? ""
        const citation = cite(info)
        if (body.split("\n").some((l) => l.includes(citation) && l.includes(day))) continue
        const rec = await tryWrite(`timeline ${path}`, () => space.append({ path, section: "Timeline", text: `- ${day}: ${item.text} ${citation}` }, actor))
        if (rec?.record) pageBodies.set(path, rec.record.body)
      }
      continue
    }
    const memoryType = ["decision", "fact", "preference", "constraint", "procedure"].includes(item.type)
    if (d.outcome === "apply" && memoryType) {
      const rec = await tryWrite(`memory ${item.ref}`, () =>
        space.put(
          {
            record: {
              kind: "memory",
              type: item.type,
              title: item.text,
              body: evidenceBody(d),
              stated_by: d.stated_by,
              source: sourceOf(info, version),
              owner: person.user ?? undefined,
              fields: { valid_from: day, routine_key: d.key, links: item.entities },
            },
          },
          actor,
        ),
      )
      if (rec) d.record = rec.record.id
      else d.outcome = lastForgotten ? "forgotten" : "failed"
    } else if (d.outcome === "apply" && item.type === "commitment_open") {
      const project = item.entities.find((p) => p.startsWith("projects/"))
      const rec = await tryWrite(`commitment ${item.ref}`, () =>
        space.put(
          {
            record: {
              kind: "commitment",
              type: "commitment",
              title: item.text,
              body: evidenceBody(d),
              stated_by: d.stated_by,
              source: sourceOf(info, version),
              owner: person.user ?? undefined,
              fields: {
                what: item.text,
                owner: item.owner === "user" ? "user" : ownerName(item.owner),
                ...(item.due ? { due: item.due } : {}),
                ...(item.trigger ? { trigger: item.trigger } : {}),
                state: "open",
                ...(project ? { project: project.slice("projects/".length) } : {}),
                ...(info?.url ? { link: info.url } : {}),
                routine_key: d.key,
                links: item.owner?.startsWith("people/") ? [item.owner] : [],
              },
            },
          },
          actor,
        ),
      )
      if (rec) d.record = rec.record.id
      else d.outcome = lastForgotten ? "forgotten" : "failed"
    } else if (d.outcome === "apply" && item.type === "commitment_close") {
      const rec = await tryWrite(`close ${item.commitment_id}`, async () => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const { records: [current] = [] } = await space.get({ ids: [item.commitment_id] }, actor)
          if (!current || current.fields?.state !== "open") return { record: current }
          try {
            return await space.put(
              {
                record: {
                  id: current.id,
                  base_version: current.version,
                  fields: { ...current.fields, state: "done", closed_at: info?.at || end, closed_by: evidenceOf(info, cleanLine(item.quote, 300)) },
                },
              },
              actor,
            )
          } catch (error) {
            if (!isConflict(error) || attempt === 1) throw error
          }
        }
        return null
      })
      if (rec) d.record = item.commitment_id
      else d.outcome = lastForgotten ? "forgotten" : "failed"
    } else if (d.outcome === "propose") {
      let rec = null
      if (memoryType) {
        rec = await tryWrite(`proposal ${item.ref}`, () =>
          proposal(d, "create", {
            payload: { kind: "memory", type: item.type, title: item.text, body: evidenceBody(d), stated_by: proposedBy(d.stated_by), source: sourceOf(info, version), fields: { valid_from: day, links: item.entities } },
          }),
        )
      } else if (item.type === "commitment_open") {
        rec = await tryWrite(`proposal ${item.ref}`, () =>
          proposal(d, "open_commitment", {
            payload: {
              kind: "commitment",
              type: "commitment",
              title: item.text,
              body: evidenceBody(d),
              stated_by: proposedBy(d.stated_by),
              source: sourceOf(info, version),
              fields: { what: item.text, owner: item.owner === "user" ? "user" : ownerName(item.owner) ?? "user", ...(item.due ? { due: item.due } : {}), ...(item.trigger ? { trigger: item.trigger } : {}), state: "open" },
            },
          }),
        )
      } else if (item.type === "commitment_close") {
        rec = await tryWrite(`proposal ${item.ref}`, () => proposal(d, "close_commitment", { target_id: item.commitment_id, payload: { state: "done" } }))
      } else if (item.type === "supersede") {
        rec = await tryWrite(`proposal ${item.ref}`, () =>
          proposal(d, "supersede", {
            target_id: item.target_id,
            payload: { mode: item.conflict === "contradiction" ? "contest" : "correct", title: item.text, body: evidenceBody(d) },
          }),
        )
      }
      if (rec) d.record = rec.id
      else d.outcome = lastForgotten ? "forgotten" : "failed"
    }
  }

  // People: pages for actors seen in two or more units; proposals otherwise.
  const peopleDecision = decidePeople(prep, {})
  const newPeople = []
  const usedPaths = new Set(index.people.map((p) => p.path))
  for (const actorInfo of peopleDecision.create) {
    // A belt on the collection: an agent, a bot or a service is never paged.
    if (agentActor(actorInfo)) continue
    const title = cleanLine(actorInfo.name || actorInfo.id.replace(/^[a-z]+:/i, ""), 80)
    if (!title || shapes(title).any) continue
    let path = `people/${slugify(title)}`
    for (let n = 2; usedPaths.has(path); n += 1) path = `people/${slugify(title)}-${n}`
    const info = prep.refs.get(actorInfo.refs[0])
    const key = `d1:person:${createHash("sha256").update(actorInfo.id).digest("hex").slice(0, 20)}`
    const prior = byKey.get(key)
    if (prior) {
      // A re-run of the day that created the page: still this day's new page.
      const src = prior.source?.event ?? prior.source?.turn
      if (prior.kind === "page" && src && prep.refs.has(src)) newPeople.push({ path: prior.path, title: prior.title, ref: src })
      continue
    }
    const rec = await tryWrite(`person ${path}`, () =>
      space.put(
        {
          record: {
            kind: "page",
            type: "person",
            path,
            title,
            body: `# ${title}\n\n## About\n\n## Timeline\n- ${day}: first seen in ${actorInfo.units} threads ${cite(info)}`,
            stated_by: "inferred",
            source: sourceOf(info, version),
            owner: person.user ?? undefined,
            fields: { identities: identitiesFromId(actorInfo.id), aliases: [], routine: version, routine_key: key },
          },
        },
        actor,
      ),
    )
    if (rec) {
      usedPaths.add(path)
      newPeople.push({ path, title, ref: info?.ref, uids: actorInfo.uids })
    }
  }
  for (const actorInfo of peopleDecision.propose) {
    if (agentActor(actorInfo)) continue
    const title = cleanLine(actorInfo.name || actorInfo.id.replace(/^[a-z]+:/i, ""), 80)
    const info = prep.refs.get(actorInfo.refs[0])
    if (!title || shapes(title).any || !info) continue
    const key = `d1:person:${createHash("sha256").update(actorInfo.id).digest("hex").slice(0, 20)}`
    if (byKey.has(key)) continue
    const path = `people/${slugify(title)}`
    await tryWrite(`person proposal ${path}`, () =>
      space.put(
        {
          record: {
            kind: "proposal",
            type: "create",
            title: clip(`create person page: ${title}`, 200),
            body: `A person seen once today: ${title}. ${cite(info)}\n\nWhy it waits: seen in one thread only.`,
            status: "proposed",
            stated_by: "inferred",
            source: sourceOf(info, version),
            owner: person.user ?? undefined,
            fields: {
              action: "create",
              target_path: path,
              reason: "an actor seen in one thread",
              evidence: [evidenceOf(info, "")],
              expires,
              routine: version,
              routine_key: key,
              payload: { kind: "page", type: "person", path, title, body: `# ${title}\n\n## About\n\n## Timeline\n`, fields: { identities: identitiesFromId(actorInfo.id), aliases: [] } },
            },
          },
        },
        actor,
      ),
    )
  }
  for (const m of peopleDecision.merge) {
    const key = `d1:merge:${createHash("sha256").update(`${m.id}|${m.path}`).digest("hex").slice(0, 20)}`
    if (byKey.has(key)) continue
    await tryWrite(`merge proposal ${m.path}`, () =>
      space.put(
        {
          record: {
            kind: "proposal",
            type: "merge",
            title: clip(`link an account to ${titleOf(m.path)}`, 200),
            body: `An account named ${cleanLine(m.name, 60)} matches [[${m.path}]] by name only.\n\nWhy it waits: a name match is not an identity.`,
            status: "proposed",
            stated_by: "inferred",
            source: { routine: version },
            owner: person.user ?? undefined,
            fields: { action: "merge", target_path: m.path, reason: "name match only", evidence: [], expires, routine: version, routine_key: key, payload: { identities: identitiesFromId(m.id) } },
          },
        },
        actor,
      ),
    )
  }

  // Pages created by this day's evidence (now, or by an earlier run of the day).
  for (const p of people) {
    const src = p.source?.event ?? p.source?.turn
    if (String(p.fields?.routine_key ?? "").startsWith("d1:person:") && src && prep.refs.has(src) && !newPeople.some((n) => n.path === p.path)) newPeople.push({ path: p.path, title: p.title, ref: src })
  }

  // The journal.
  const peopleSeen = new Map()
  for (const u of prep.units) {
    const fresh = newPeople.filter((n) => n.uids?.includes(u.uid)).map((n) => n.path)
    for (const p of [...u.people, ...fresh]) {
      const e = peopleSeen.get(p) ?? { path: p, count: 0, ref: u.items[0].ref }
      e.count += 1
      peopleSeen.set(p, e)
    }
  }
  let overdue = [...openCommitments.values()].filter((c) => {
    const due = dueDay(c.fields?.due, tz)
    return due && due < day && !decided.some((d) => d.outcome === "apply" && d.item.commitment_id === c.id)
  })
  let recorded = changedToday.filter((m) => m.updated < end && m.source?.routine == null && m.author?.agent !== actor.agent)
  // Journal lines from records (overdue, recorded today) never copy forgotten text either.
  if (overdue.length + recorded.length > 0) {
    const lines = [...overdue, ...recorded]
    const { blocked = [] } = await space.routineCheck({ items: lines.map((r) => ({ texts: [r.title ?? "", r.fields?.what ?? ""] })) }, actor)
    const out = new Set(blocked.map((b) => lines[b.index]))
    overdue = overdue.filter((r) => !out.has(r))
    recorded = recorded.filter((r) => !out.has(r))
    forgottenLines += out.size
  }
  // A truncated answer's marker is a count of its own, not a rejected item.
  const truncatedBatches = rejected.filter((r) => r.reason === "truncated").length
  const rejectedItems = rejected.filter((r) => r.reason !== "truncated")
  const stats = {
    sessionSkipped,
    items: prep.refs.size,
    noise: prep.dropped.length,
    withheld: prep.withheld.length + decided.filter((d) => d.outcome === "drop").length,
    rejected: rejectedItems.length,
    truncated: truncatedBatches,
    known: decided.filter((d) => d.outcome === "known").length,
    dropped: decided.filter((d) => d.outcome === "drop").length,
    proposeMode: applyMode(config.apply) === "propose",
    calls: run.calls,
    tokens: run.tokens,
    budget: config.budgetTokens,
    budgetStopped,
    unreadUnits,
    readUnits,
    failedTokens,
    // A catch-up run: the journal says which units were read late, and on what day.
    catchUp: ctx.catchUp ? { units: readList.length, on: ctx.ranOn ?? day } : null,
    llmError,
    runId: run.id,
  }
  let body = renderJournal({
    day,
    tz,
    version,
    units: prep.units,
    refs: prep.refs,
    decided: decided
      .filter((d) => ["apply", "propose", "journal", "known"].includes(d.outcome) && !d.rejectedBefore)
      .map((d) => (d.outcome === "known" ? { ...d, outcome: d.item.type === "highlight" ? "journal" : "apply", known: true } : d)),
    people: [...peopleSeen.values()].sort((a, b) => b.count - a.count),
    overdue,
    newPeople,
    late: ctx.catchUp ? readList : [],
    counts: prep.counts,
    stats,
    index,
    withheld: new Set(gated.stats?.withheld_titles ?? []),
  })
  if (recorded.length > 0) {
    body = body.replace("\n## Sources", `\n## Recorded today\n\n${recorded.slice(0, 20).map((m) => `- ${cleanLine(m.title, 160)} [[${m.id}]]`).join("\n")}\n\n## Sources`)
  }
  if (failures.length > 0) {
    body = body.replace("\n---\n", `\n${failures.length} writes failed and were logged; nothing was marked read, so the next run tries again.\n\n---\n`)
  }
  // A re-run, or a catch-up, reads only part of the day: the earlier journal's
  // cited lines go back in, so a highlight an earlier run wrote is never
  // dropped (review finding H2). One a person has since forgotten stays out.
  if (existingJournal?.body && readUnits < prep.units.length) {
    const kept = citedBullets(existingJournal.body)
    if (kept.length > 0) {
      // A line whose cited ref a person forgot, or whose cited record is gone,
      // is not written back: the merge checks the sources, not only the text.
      // The store reads at most fifty ids a call, and a day can cite more (55
      // overdue commitments did), so they are read in groups of fifty.
      const ids = [...new Set(kept.flatMap((k) => recordsCited(k.line)))]
      const alive = ids.length > 0 ? new Set() : null
      for (let i = 0; i < ids.length; i += MERGE_IDS_PER_READ) {
        const { records: held = [] } = await space.get({ ids: ids.slice(i, i + MERGE_IDS_PER_READ) }, actor)
        for (const record of held) alive.add(record.id)
      }
      const { blocked = [] } = await space.routineCheck({ items: kept.map((k) => ({ refs: refsCited(k.line), texts: [withoutCitation(k.line)] })) }, actor)
      // A title the gate withholds is withheld in an earlier line too, not
      // printed back in clear beside the run's own (review M1).
      body = mergeJournals(
        body,
        survivingLines(kept, {
          blocked: blocked.map((b) => b.index),
          alive,
          withheld: gated.stats?.withheld_titles ?? [],
          withheldRefs: gated.stats?.withheld_refs ?? [],
        }),
      )
    }
  }
  const fields = { date: day, tz, sources: prep.counts, routine: version, edited: false, run: run.id }
  const title = `Journal ${day}`
  let journalWritten = false
  for (let attempt = 0; attempt < 2 && !journalWritten; attempt += 1) {
    const { records: [current] = [] } = await space.get({ paths: [journalPath] }, actor)
    if (current && (current.fields?.edited === true || !current.fields?.routine)) return { status: "skipped", reason: "the journal was edited by a person during the run", journal: journalPath }
    try {
      if (current) await space.put({ record: { id: current.id, base_version: current.version, title, body, fields } }, actor)
      else await space.put({ record: { kind: "page", type: "journal", path: journalPath, title, body, stated_by: "agent", source: { routine: version }, owner: person.user ?? undefined, fields } }, actor)
      journalWritten = true
    } catch (error) {
      if (!(isConflict(error) || error?.code === "path_taken") || attempt === 1) throw error
    }
  }

  // Read marks are written only once every item and the journal are saved: a
  // write that failed leaves the day unread, so the next run tries again
  // (review finding H3). A mark that itself fails costs only a re-read.
  const marked = journalWritten && failures.length === 0
  if (marked) await markRead(readList)
  const unreadAfter = marked ? unreadUnits : pending.length

  const count = (type, outcome) => decided.filter((d) => d.item.type === type && d.outcome === outcome && !d.again).length
  // A day whose queue of held claims is not clear is not a plain ok (design
  // §5.4): the run says so, and health shows what still waits.
  const unresolved = Number(gated.stats?.unresolved) || 0
  return {
    status: budgetStopped ? "budget" : llmError && batches.length > 0 && llmOk === 0 ? "failed" : unresolved > 0 ? "held" : "ok",
    error: llmError && batches.length > 0 && llmOk === 0 ? llmError : failures[0] ?? null,
    journal: journalPath,
    counts: {
      units: prep.units.length,
      items: prep.refs.size,
      noise: prep.dropped.length,
      withheld: stats.withheld,
      // What this run read, and what the day still has unread (FINDINGS R6):
      // the scheduler queues a day whose last run left unread units.
      read: readUnits,
      unread: unreadAfter,
      rejected: rejectedItems.length,
      truncated: truncatedBatches,
      known: decided.filter((d) => d.outcome === "known" && !d.again).length,
      applied: decided.filter((d) => d.outcome === "apply" && !d.again).length,
      proposed: decided.filter((d) => d.outcome === "propose" && !d.again).length,
      dropped: decided.filter((d) => d.outcome === "drop").length,
      decisions: count("decision", "apply"),
      opened: count("commitment_open", "apply"),
      closed: count("commitment_close", "apply"),
      people: newPeople.length,
      failures: failures.length,
      sessions_skipped: sessionSkipped,
      forgotten,
      forgotten_lines: forgottenLines,
      judgements_dropped: (gated.stats?.categories?.candidate ?? 0) + decided.filter((d) => d.outcome === "drop" && /hire judgement about a candidate/.test(String(d.reason ?? ""))).length,
      traits_dropped: gated.stats?.dropped ?? 0,
      traits_held: gated.stats?.held ?? 0,
      subjects_withheld: gated.stats?.titles ?? 0,
    },
    ingested_through: ingestedThrough,
    traits: gated.stats,
    unresolved_holds: unresolved,
    forgotten_titles: forgottenTitles,
    produced: { proposals: [...produced.proposals], records: [...produced.records], timelines: [...produced.timelines] },
    decided: decided.map((d) => ({ type: d.item.type, ref: d.item.ref, outcome: d.outcome, reason: d.reason, record: d.record ?? null, stated_by: d.stated_by })),
    dropped: prep.dropped,
    withheld: prep.withheld.map((w) => ({ ref: w.ref, shapes: w.shapes })),
    rejected: rejectedItems.map((r) => ({ reason: r.reason, ref: r.item?.ref ?? null, type: r.item?.type ?? null })),
  }
}
