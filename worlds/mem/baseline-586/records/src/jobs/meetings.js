/**
 * Meeting pages → proposals (0.11, opencode-mem#58 item 2; DESIGN-MEMORY-JOBS
 * §6.1, §6.2).
 *
 * **The owner's decision (2026-11-14):** a memory drawn from a meeting may be
 * **proposed** at the measured extraction precision (80–87%), because every
 * proposal is reviewed by the person before anything is stored. Extraction that
 * **saves** a memory directly keeps the 0.90 bar, so nothing here ever writes a
 * memory: `extract`'s direct-save default stays off, and this path has no such
 * mode at all.
 *
 * **What is read.** Jelly writes one page of type `meeting` per meeting, with
 * its notes and links to its recording and transcript. This engine reads:
 * - the page's **notes** (its body): the page's own record, so its lines are the
 *   person's unless they quote somebody (`splitPasted`);
 * - the page's **transcript**, when the page carries its text (`fields.transcript`
 *   or `fields.transcript_text`). A transcript the page only links is **not**
 *   fetched: its link is cited, and nothing is read from it. A named speaker on
 *   a transcript line is that speaker, never the person, unless the page's own
 *   attendees name that speaker as the person.
 *
 * **What is cited.** Every candidate names the page (`source.record`, the
 * proposal's body `[meeting <path> at <at>]`) and the **moment** it came from:
 * `at` is the transcript's timestamp (`00:12:34`) when the line carries one, and
 * otherwise the line offset in the text it was read from (`#L12`), with `file`
 * naming the transcript file when the candidate came from one.
 *
 * **What it proposes.** Only the two outputs the brief asks for: a `decision`
 * and a `commitment_open`, each through Memory's own frame, validator,
 * attribution and `decide()` — the same chain a job's `extract` stage runs, so
 * nothing here can be more permissive than it.
 */
import { createHash } from "node:crypto"
import { SCHEMA, SYSTEM, batchUnits } from "../routines/extract.js"
import { createTraitGate } from "../routines/traits.js"
import { PASTED, splitPasted } from "../routines/passes.js"
import { cleanLine, clip, fold, redactExternal } from "../routines/guards.js"
import { acceptedItems } from "./extract.js"
import { visibleText } from "./render.js"
import { jobDecisionKind, jobIsPromise } from "./decisions.js"

/** The page type this engine reads. */
export const MEETING_TYPE = "meeting"

/**
 * The two outputs a meeting page may propose. A fact, a preference or a
 * `commitment_close` is not asked for, so it is refused by the engine's own
 * output gate instead of being proposed and then dropped by review.
 */
export const MEETING_OUTPUTS = Object.freeze(["proposal:decision", "proposal:commitment_open"])

/**
 * The characters one part may carry, and the characters one batch may merge up
 * to: small enough that a part always fits a run's model budget, and fixed (not
 * derived from the budget) so the same page always has the same parts and a
 * resumed run continues from the same place.
 */
export const MAX_PART_CHARS = 6000

const sha = (value) => createHash("sha256").update(String(value)).digest("hex")

/**
 * The transcript a page carries, when it carries one as text. A link alone is
 * not readable here, and is never fetched: the link is cited instead.
 *
 * @returns {{text: string, file: string} | null}
 */
export function transcriptOf(page) {
  const fields = page?.fields && typeof page.fields === "object" ? page.fields : {}
  const text = [fields.transcript, fields.transcript_text, fields.transcriptText].find((value) => typeof value === "string" && value.trim())
  if (!text) return null
  const named = [fields.transcript_file, fields.transcript_url, fields.transcript_label, fields.file].find((value) => typeof value === "string" && value.trim())
  return { text, file: clip(named, 200) || "transcript" }
}

/**
 * The day a meeting page names, when it names one: its `fields.date`, or the
 * date its `fields.started`/`occurred_at` carries. A page that names none has
 * no day of its own, and the run's day is used.
 */
export function meetingDayOf(page) {
  const fields = page?.fields && typeof page.fields === "object" ? page.fields : {}
  for (const value of [fields.date, fields.day, fields.started, fields.occurred_at, fields.at]) {
    if (typeof value !== "string") continue
    const day = value.slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return day
  }
  return null
}

/**
 * A **live** meeting: the page names a start and no end, so the meeting is still
 * running and jelly may re-save it every few seconds. Memory proposes nothing
 * from it — no call, no spend — and reads it once a later save or tick finds it
 * ended. A page with no meeting fields is the person's own notes and is read as
 * it always was.
 */
export function isLiveMeeting(page) {
  const meeting = page?.fields && typeof page.fields === "object" ? page.fields.meeting : null
  if (!meeting || typeof meeting !== "object" || Array.isArray(meeting)) return false
  const started = typeof meeting.startedAt === "string" && meeting.startedAt.trim()
  const ended = typeof meeting.endedAt === "string" && meeting.endedAt.trim()
  return Boolean(started) && !ended
}

/** The whole text a page carries: its notes and the transcript it holds. */
export function meetingText(page) {
  return [String(page?.body ?? ""), transcriptOf(page)?.text ?? ""].join("\n")
}

/** Every link the page names, as the citation a proposal keeps for it (never read). */
export function meetingLinks(page) {
  const fields = page?.fields && typeof page.fields === "object" ? page.fields : {}
  return ["recording", "recording_url", "recording_file", "transcript_file", "transcript_url"]
    .map((name) => (typeof fields[name] === "string" ? clip(fields[name], 200) : null))
    .filter(Boolean)
}

/**
 * The notes as lines: numbered so a line is citable (`#L12`), with Markdown
 * structure (headings, fences, list markers) removed before the model sees it.
 * The quote a model returns is checked against exactly this text.
 */
export function notesLines(body) {
  const out = []
  let fence = false
  const lines = String(body ?? "").split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    if (/^\s*```/.test(line)) {
      fence = !fence
      continue
    }
    if (fence) continue
    if (!line.trim()) continue
    if (/^\s*#{1,6}\s/.test(line)) continue
    const text = line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s+)/, "").trim()
    if (!text) continue
    out.push({ text: clip(text, 1500), at: `#L${index + 1}` })
  }
  return out
}

/**
 * A transcript line's timestamp and speaker. `[00:12:34] Sam: text`,
 * `00:12:34 Sam: text` and `Sam: text` are all read; a line with neither keeps
 * its offset instead of inventing a moment.
 */
const TRANSCRIPT_LINE = /^\s*(?:\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?[\s-]*)?(?:([\p{L}][\p{L}0-9 .'’-]{0,60}):\s*)?(.*\S)\s*$/u

const roleOf = (author) => (author.self ? "self" : author.agent ? "agent" : author.path ? "colleague" : "external")

const selfAuthor = (label) => ({ id: null, name: label, self: true, external: false, path: null })

/** A writer the runner or the routines wrote: what a job brings in is context, not a person's words. */
export const SYSTEM_WRITERS = Object.freeze(["jobs", "routines"])

/**
 * The unnamed writer of a line that is not the person's: a grant editor, another
 * member of a team space, or a page whose owner this service cannot name. A
 * promise on such a line is the person waiting on "someone else"; a decision on
 * one is not the person's memory, and `acceptedItems` refuses it as such.
 */
const SOMEONE = Object.freeze({ id: null, name: "someone else", self: false, external: true, path: null })

/**
 * **Who wrote the notes** (0.11 review, the blocker). A line in the notes is the
 * person's **only when the person wrote every version of the page**: the page is
 * theirs (`author`), it lives in their own personal space, and **no other person
 * and no job ever saved it** — a guest who appended a line and an owner who then
 * changed the title still means the guest wrote part of it. `writers` is that
 * whole history (`rows.meetingAuthors`: the author, every version's saving user,
 * and the live row's last save); a caller with one record may pass only its
 * author and last save, and is then answered conservatively.
 *
 * Otherwise:
 *
 * - a page the **runner or the routines** ever wrote (a calendar job's agenda, a
 *   template's page) is **context**: it proposes nothing, because text a machine
 *   brought in from an external agenda is not anyone's decision or promise;
 * - a page **another person** wrote or saved (a guest with a grant on
 *   `meetings/`, a teammate) is `someone`: its decisions are dropped and its
 *   promises are attributed to "someone else", never to the person. A team space
 *   is always `someone`: there is no single person there to attribute to.
 *
 * @returns {{kind: "person"|"someone"|"context", user: string|null}}
 */
export function notesWriter(page, { personUser = null, spaceKind = "personal", writers = null, agents = null, complete = true, systemUsers = SYSTEM_WRITERS } = {}) {
  const author = page?.author?.user ?? null
  const last = page?.change?.by?.user ?? null
  const history = writers === null ? [author, last] : [...writers]
  const throughAgents = agents === null ? [] : [...agents].filter(Boolean)
  if (history.some((user) => user && systemUsers.includes(user))) return { kind: "context", user: history.find((user) => user && systemUsers.includes(user)) }
  // A history the store no longer holds names nobody, so it names nobody's: the
  // rule fails closed rather than guessing (0.11 review, blocker 3).
  if (complete === false) return { kind: "someone", user: last ?? author }
  // An agent does not speak for the person in 0.11: a page any agent saved is
  // not the person's notes, and its lines are `agent`-role text.
  if (throughAgents.length > 0) return { kind: "someone", user: last ?? author, agent: throughAgents[0] }
  if (spaceKind === "personal" && personUser && author === personUser && history.every((user) => !user || user === personUser)) return { kind: "person", user: personUser }
  return { kind: "someone", user: last ?? author }
}

/**
 * The speaker of a transcript line. A name the page's own attendees mark as the
 * person is the person; every other named speaker is external. An unnamed line
 * is unknown, and an unknown promise is not proposed (`acceptedItems`).
 */
function speakerOf(name, selfNames) {
  const clean = cleanLine(name, 80)
  if (!clean) return { id: null, name: "unknown", self: false, external: true, path: null }
  const self = selfNames.has(fold(clean))
  // `speaker` marks a transcript line: its named speaker is that person, and a
  // first person on it is theirs (a notes line someone else wrote is not).
  return { id: null, name: clean, self, external: !self, speaker: true, path: null }
}

/**
 * A page's segments in parts one model call can carry: at most `perPart` lines
 * and about `maxChars` characters, so a part always fits one run's budget and a
 * page larger than that is read part by part (0.11 review, blocker 2).
 */
function chunkSegments(segments, perPart, maxChars = 6000) {
  const size = Math.max(1, Number(perPart) || 60)
  const limit = Math.max(500, Number(maxChars) || 6000)
  const parts = []
  let current = []
  let chars = 0
  for (const segment of segments) {
    const n = String(segment.text ?? "").length + 120
    if (current.length > 0 && (current.length >= size || chars + n > limit)) {
      parts.push(current)
      current = []
      chars = 0
    }
    current.push(segment)
    chars += n
  }
  if (current.length > 0) parts.push(current)
  return parts
}

/** The names the page itself says are the person: the owner label, and any attendee marked `self`. */
export function selfNamesOf(page, personLabel) {
  const names = new Set()
  if (personLabel) names.add(fold(personLabel))
  const fields = page?.fields && typeof page.fields === "object" ? page.fields : {}
  for (const list of [fields.attendees, fields.participants]) {
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue
      const name = typeof entry.name === "string" ? entry.name : typeof entry.label === "string" ? entry.label : null
      if (entry.self === true && name) names.add(fold(name))
    }
  }
  return names
}

/**
 * The page as the extraction frame's units and refs: one unit for the notes and
 * one for the transcript, each item one citable line. Nothing is read that the
 * page does not carry, and no line is the person's unless the person wrote it
 * (`notesWriter`).
 *
 * @returns {{units: object[], refs: Map<string, object>, transcript: object|null, writer: {kind: string, user: string|null}, truncated: string[]}}
 */
export function meetingUnits(page, { personLabel = "the person", personUser = null, spaceKind = "personal", writer = null, limits = {} } = {}) {
  const units = []
  const refs = new Map()
  const truncated = []
  let count = 0
  const add = (uid, title, kind, segments) => {
    if (segments.length === 0) return
    const items = []
    for (const segment of segments) {
      const ref = `mt${(count += 1)}`
      items.push({ ref, kind, at: segment.at, segments: [{ author: segment.author, text: segment.text }] })
      refs.set(ref, { ref, unit: uid, at: segment.at, segments: [{ author: segment.author, text: segment.text }] })
    }
    units.push({ uid, title, items })
  }
  const notesPerson = writer ?? notesWriter(page, { personUser, spaceKind })
  const maxNotes = Number(limits.maxNotes) || 400
  const allNotes = notesLines(page?.body)
  const notes = allNotes.slice(0, maxNotes)
  if (allNotes.length > notes.length) truncated.push(`${allNotes.length - notes.length} note line(s) past the first ${maxNotes} were not read`)
  if (notesPerson.kind !== "context") {
    // The person's own lines are theirs; a line someone else wrote is theirs, or
    // "someone else" when this service cannot name them; what a job brought in
    // (an external agenda) is context and proposes nothing.
    const notesAuthor = notesPerson.kind === "person" ? selfAuthor(personLabel) : SOMEONE
    const segments = notes.flatMap((line) =>
      // The person's own notes are theirs; what they pasted or quoted is not.
      (notesPerson.kind === "person" ? splitPasted(line.text) : [{ text: line.text, pasted: false }]).map((part) => ({
        author: part.pasted ? PASTED : notesAuthor,
        text: part.text,
        at: line.at,
      })),
    )
    // A long page is several parts, each one a batch a single run can finish:
    // a page that needs more than one run's budget is resumed where it stopped
    // (0.11 review, blocker 2), never sent from its first line again.
    for (const [index, chunk] of chunkSegments(segments, limits.linesPerPart).entries()) add(index === 0 ? "notes" : `notes-${index + 1}`, `${clip(page?.title ?? page?.path ?? "Meeting", 80)} notes`, "meeting", chunk)
  }
  const transcript = transcriptOf(page)
  if (transcript) {
    const selfNames = selfNamesOf(page, personLabel)
    const maxLines = Number(limits.maxTranscriptLines) || 600
    const lines = []
    let past = 0
    for (const [index, raw] of transcript.text.split(/\r?\n/).entries()) {
      if (!raw.trim()) continue
      if (lines.length >= maxLines) {
        past += 1
        continue
      }
      const match = TRANSCRIPT_LINE.exec(raw)
      const text = clip(String(match?.[3] ?? "").trim(), 1500)
      if (!text) continue
      const at = match?.[1] ?? `#L${index + 1}`
      lines.push({ author: speakerOf(match?.[2], selfNames), text, at })
    }
    if (past > 0) truncated.push(`${past} transcript line(s) past the first ${maxLines} were not read`)
    for (const [index, chunk] of chunkSegments(lines, limits.linesPerPart).entries()) add(index === 0 ? "transcript" : `transcript-${index + 1}`, `${clip(page?.title ?? "Meeting", 80)} transcript`, "meeting", chunk)
  }
  return { units, refs, transcript: transcript ? { file: transcript.file, readable: true } : null, writer: notesPerson, truncated }
}

/**
 * The digest a page's proposals are keyed by: its notes, its transcript text, who
 * wrote the notes, and the schema in which they were read. It is content, not a
 * version, so a re-save that changed nothing proposes nothing again — and a
 * save by someone else is a new reading, because the attribution changed.
 */
export function meetingDigest(page, writer = null) {
  return `sha256:${sha(JSON.stringify([MEETING_TYPE, String(page?.body ?? ""), transcriptOf(page)?.text ?? null, writer?.kind ?? null, [...MEETING_OUTPUTS]]))}`
}

/** One proposal's idempotency key: its kind, its text and the quote it rests on, on this page. */
export function meetingProposalKey(page, item) {
  return `meeting:${page?.id ?? page?.path}:${sha([item.type, fold(item.text), fold(item.quote)].join("\u0000")).slice(0, 32)}`
}

/** The citation of one item: the page, and the moment it came from. */
export function meetingCitation(page, item) {
  const at = typeof item.at === "string" && item.at ? String(item.at).slice(0, 20) : null
  return `[meeting ${page?.path ?? page?.id}${at ? ` at ${at}` : ""}]`
}

/**
 * The prompt for one batch: Memory's frame, the page's lines as DATA, and the
 * one thing a meeting adds — every line carries the moment it was said.
 */
export function buildMeetingPrompt({ page, day, person, index, units, openCommitments = [], batchRefs = null, transcript = null, links = [] }) {
  const context = {
    today: day,
    people: index.people.map((entry) => ({ path: entry.path, name: clip(entry.title, 80) })),
    projects: index.projects.map((entry) => ({ path: entry.path, name: clip(entry.title, 80) })),
    open_commitments: openCommitments.map((record) => ({ id: record.id, what: clip(record.fields?.what ?? record.title, 160), owner: record.fields?.owner ?? "user", due: record.fields?.due ?? null })),
    current_memories: [],
    meeting: { title: clip(page?.title ?? page?.path ?? "Meeting", 120), path: page?.path ?? null, transcript: transcript?.file ?? null, links },
  }
  const lines = []
  for (const unit of units) {
    for (const item of unit.items) {
      if (batchRefs && !batchRefs.has(item.ref)) continue
      for (const segment of item.segments) {
        lines.push(JSON.stringify({ ref: item.ref, unit: unit.uid, kind: item.kind, title: unit.title, author: clip(segment.author.name ?? "unknown", 60), role: roleOf(segment.author), at: item.at, text: segment.text }))
      }
    }
  }
  const user = [
    `Today is ${day}. The person is ${clip(person?.label ?? "the person", 60)}.`,
    "These units are one meeting: the notes the person keeps on the meeting's page, and its transcript when the page carries one. Each line's `at` is the moment it was said, or the line it is on. Propose only what the person's own text records, and a promise whoever made it.",
    "CONTEXT",
    JSON.stringify(context),
    "SCHEMA",
    JSON.stringify(SCHEMA),
    "DATA (one JSON object per line; role is self, agent, colleague or external; at is the citation)",
    "<<<DATA",
    ...lines,
    "DATA>>>",
    'Answer with {"items": [...]} only.',
  ].join("\n")
  return { system: SYSTEM, user }
}

/**
 * The validated, decided items one answer yields. It is the jobs engine's own
 * `acceptedItems` — the frame's validator, the declared outputs, `quoteAuthor`,
 * `decide()` in propose mode and the text guards — so this path cannot accept
 * anything the job path would refuse.
 */
const FIRST_PERSON = /\b(?:i(?:'ll| will| shall)|i(?:'m| am) going to|let me)\b/i

/**
 * A promise's owner on a line the person did **not** write (0.11 review, round
 * 7). The principle: such a line can never make the person the owner.
 *
 * - an owner the **line names** ("Ama will …") stays that named person;
 * - a first person ("I'll own the test") is the **speaker's**, and a transcript
 *   speaker stays themselves;
 * - anything unnamed is "someone else".
 */
export function ownerOnAnothersLine({ quote, author, people = [], personLabel = null }) {
  const text = String(quote ?? "")
  // A name the line itself states wins, when it is one of the page's people.
  // A name matches as a **whole name**, on word boundaries: an attendee "Ana"
  // is not the "analysis" (round 10, item 3).
  const named = people
    .filter((name) => typeof name === "string" && name.trim())
    .filter((name) => new RegExp(`(^|[^\\p{L}\\p{N}])${fold(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "u").test(fold(text)))
    .sort((a, b) => b.length - a.length)[0]
  if (named && (!personLabel || fold(named) !== fold(personLabel))) return cleanLine(named, 80) || "someone else"
  // A first person on someone else's line names nobody the page can vouch for;
  // only a transcript speaker stays themselves.
  if (FIRST_PERSON.test(text)) return author?.speaker && author.name && author.name !== "unknown" ? cleanLine(author.name, 80) : "someone else"
  return "someone else"
}

/**
 * The items one answer yields, with the meeting's owner rule applied: a
 * commitment on someone else's line keeps the name the line states, keeps a
 * transcript speaker, and is never the person's.
 */
export function acceptedMeetingItems({ answer, day, refs, batchRefs, index, commitments = new Map(), people = [], personLabel = null }) {
  const result = acceptedItems({
    answer,
    day,
    refs,
    batchRefs,
    index,
    outputs: new Set(MEETING_OUTPUTS),
    commitments,
    // The Jobs rules: the sentence's form decides a promise and a choice, so a
    // meeting's honest phrases are not dropped for a missing verb.
    kindOf: jobDecisionKind,
    isPromise: jobIsPromise,
  })
  for (const item of result.accepted) {
    if (!item.type.startsWith("commitment")) continue
    const author = refs.get(item.ref)?.segments?.[0]?.author ?? null
    if (author?.self) continue
    item.owner = ownerOnAnothersLine({ quote: item.quote, author, people, personLabel })
    item.attributed_to = "external"
  }
  return result
}

/** The citation a proposal keeps: the page, the moment, and the transcript's file when it has one. */
export function evidenceOfMeeting(page, item, { file = null } = {}) {
  return [
    {
      record: page?.id ?? null,
      path: page?.path ?? null,
      quote: cleanLine(redactExternal(visibleText(clip(item.quote, 200))).text, 200),
      ...(typeof item.at === "string" && item.at ? { at: clip(item.at, 20) } : {}),
      ...(file ? { file: clip(file, 200) } : {}),
    },
  ]
}

/**
 * One validated item as the proposal a person reviews. Nothing collected is
 * copied into a field the model did not produce, and the proposal names the page
 * it came from (`source.record`), the moment (`fields.evidence[].at`) and **whose
 * line it is**: a line someone other than the person wrote says so in the title
 * and the body, so the person reading it sees whose words they are.
 */
export function proposalOfMeeting(item, { page, transcriptFile = null, author = null }) {
  const cite = meetingCitation(page, item)
  const key = meetingProposalKey(page, item)
  // Whose words the quote holds: the person's own line, a line someone else
  // wrote (a guest's or a teammate's note), or a named speaker in a transcript.
  const writtenBy = author?.self ? "person" : author?.name === "someone else" ? "someone" : "speaker"
  const someone = writtenBy === "someone"
  const from = someone ? " (someone else's line)" : ""
  const disclosure = someone ? " This line was not written by you: it is someone else's." : ""
  const common = {
    stated_by: "external",
    source: { record: page?.id ?? null },
    fields: {
      meeting: page?.path ?? null,
      meeting_id: page?.id ?? null,
      version: page?.version ?? null,
      // Whose line it is, as the review shows it: `person`, `someone` for a
      // guest's or a teammate's line (0.11 review, the blocker), or `speaker`.
      written_by: writtenBy,
      job_key: key,
      events: [],
      evidence: evidenceOfMeeting(page, item, { file: item.unit === "transcript" ? transcriptFile : null }),
      reason: someone ? "a meeting line someone else wrote, proposed for review" : "meeting notes, proposed for review",
      policy_reason: clip(item.policy_reason ?? "proposed for review", 200),
    },
  }
  if (item.type === "decision") {
    return {
      ...common,
      kind: "proposal",
      type: "create",
      title: clip(`proposed decision${from}: ${item.text}`, 200),
      body: `${item.text} ${cite}${disclosure}`,
      fields: {
        ...common.fields,
        action: "create",
        payload: { kind: "memory", type: "decision", title: clip(item.text, 200), body: item.text, stated_by: "external" },
      },
    }
  }
  const entities = Array.isArray(item.entities) ? item.entities.map((path) => `[[${path}]]`).join(" ") : ""
  return {
    ...common,
    kind: "proposal",
    type: "open_commitment",
    title: clip(`proposed commitment${from}: ${item.text}`, 200),
    body: `${item.text} ${cite}${entities ? ` ${entities}` : ""}${disclosure}`,
    fields: {
      ...common.fields,
      action: "open_commitment",
      attributed_to: item.attributed_to ?? (item.owner === "user" ? "person" : "external"),
      payload: {
        kind: "commitment",
        type: "commitment",
        title: clip(item.text, 300),
        fields: {
          what: item.text,
          owner: item.owner ?? "user",
          state: "open",
          ...(item.due ? { due: item.due } : {}),
          ...(item.trigger ? { trigger: item.trigger } : {}),
          ...(item.entities.length ? { links: item.entities } : {}),
        },
      },
    },
  }
}

/**
 * Every proposal one page yields, batch by batch, through `llm.complete`. It
 * returns proposals only; writing them (and their idempotency and forgotten
 * checks) is `proposals.js`'s job.
 *
 * A call that fails is **counted and its estimate recorded** before the failure
 * leaves: a failed call still spent a request (0.11 review, should-fix 4), so the
 * caller's day is charged for it.
 *
 * @returns {Promise<{proposals: object[], calls: number, tokens: number, sent: string[], rejected: object, stopped: string|null, error?: Error, truncated: string[], writer: object}>}
 */
export async function proposeFromMeeting({
  page,
  day,
  person,
  index,
  commitments = new Map(),
  openCommitments = [],
  llm,
  budget = Infinity,
  limits = {},
  maxChars = 24_000,
  personUser = null,
  spaceKind = "personal",
  writers = null,
  agents = null,
  complete = true,
  parts = 0,
  gate = null,
  gateFactory = null,
}) {
  const writer = notesWriter(page, { personUser, spaceKind, writers, agents, complete })
  const plan = meetingUnits(page, { personLabel: person?.label ?? "the person", personUser, spaceKind, writer, limits })
  const proposals = []
  const rejected = {}
  const sent = []
  const truncated = plan.truncated.length > 0 ? [...plan.truncated] : []
  // Batches are cut by characters, not by the budget, so the same page always
  // has the same parts: a run that stops keeps its cursor and the next one
  // continues from the same place. A batch stays small enough for one call.
  const batches = batchUnits(plan.units, Math.min(maxChars, MAX_PART_CHARS))
  const partsTotal = batches.length
  // Resume where the last run stopped: a page is read part by part, and each
  // part is sent once (0.11 review, blocker 2).
  let done = Math.min(Math.max(0, Number(parts) || 0), partsTotal)
  let tokens = 0
  let calls = 0
  let stopped = null
  let held = 0
  let retry = false
  if (!llm?.available) return { proposals, calls, tokens, sent, rejected, held, stopped: "no_model", truncated, writer, parts: done, partsTotal }
  for (let at = done; at < partsTotal; at += 1) {
    const units = batches[at]
    const batchRefs = new Set(units.flatMap((unit) => unit.items.map((item) => item.ref)))
    const prompt = buildMeetingPrompt({ page, day, person, index, units, openCommitments, batchRefs, transcript: plan.transcript, links: meetingLinks(page) })
    const estimate = 1500 + Math.ceil((prompt.system.length + prompt.user.length) / 4)
    if (tokens + estimate > budget) {
      stopped = "budget"
      truncated.push("the rest of this page was not read: the run's token budget ran out")
      break
    }
    let answer
    try {
      answer = await llm.complete({ system: prompt.system, user: prompt.user })
    } catch (error) {
      // The request was made and failed: its estimate is spent, and the caller
      // charges the day for it before the breaker counts the failure.
      tokens += estimate
      calls += 1
      return { proposals, calls, tokens, sent, rejected, held, stopped: "model", error, truncated, writer, parts: done, partsTotal }
    }
    calls += 1
    tokens += Number(answer?.usage?.total) || estimate
    for (const unit of units) for (const item of unit.items) sent.push(item.ref)
    const accepted = acceptedMeetingItems({
    answer: answer?.json,
    day,
    refs: plan.refs,
    batchRefs,
    index,
    commitments,
    people: [person?.label, ...((page?.fields?.attendees ?? []).map((entry) => (typeof entry === "string" ? entry : entry?.name)))].filter(Boolean),
    personLabel: person?.label ?? null,
  })
    for (const entry of accepted.dropped) rejected[entry.reason] = (rejected[entry.reason] ?? 0) + 1
    // The trait gate before filing (design §5.4): a meeting's claims take the
    // same check, because a page is written by whoever shared the meeting.
    // The gate is the caller's when it has one, so its tokens are this run's
    // and the cell's breaker and guard are the ones the daily uses.
    const meetingGate =
      gate ??
      (gateFactory
        ? gateFactory({ spent: () => tokens, budgetAt: budget, onCall: (used) => { tokens += used } })
        : createTraitGate({ llm }))
    const verdict = accepted.accepted.length
      ? await meetingGate.gate({
          claims: accepted.accepted.map((item, at) => {
            const author = plan.refs.get(item.ref)?.segments?.[0]?.author ?? null
            const mine = Boolean(author?.self)
            return { index: at, text: item.text, quote: item.quote, author: mine ? "person" : "other", about: item.owner && item.owner !== "user" ? "other" : mine ? "person" : "other" }
          }),
        })
      : { kept: [], dropped: [], held: [] }
    const keptMeeting = new Set(verdict.kept)
    // A dropped claim is a judgement the run made; a held one is not a
    // rejection at all: it is retried (design §5.4), so the part is left undone
    // and the next run reads it again, up to the runner's attempt cap.
    if (verdict.dropped.length) rejected.trait = (rejected.trait ?? 0) + verdict.dropped.length
    if (verdict.held.length) {
      held += verdict.held.length
      retry = true
    }
    for (const [at, item] of accepted.accepted.entries()) {
      if (!keptMeeting.has(at)) continue
      const ref = plan.refs.get(item.ref)
      const author = ref?.segments?.[0]?.author ?? null
      proposals.push(proposalOfMeeting({ ...item, unit: ref?.unit ?? null, at: ref?.at ?? null }, { page, transcriptFile: plan.transcript?.file ?? null, author }))
    }
    // A part whose claim waits is not done: the next run reads it again.
    if (!retry) done = at + 1
  }
  return { proposals, calls, tokens, sent, rejected, held, stopped: retry ? "held" : stopped, truncated, writer, parts: done, partsTotal }
}
