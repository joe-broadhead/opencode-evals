/**
 * The policy pass, exactly as memory-funnel-v1.md §7. Pure and deterministic:
 * it reads the verbatim quote, who wrote it (the segment of the cited ref that
 * holds the quote), and the space's own index. It never trusts the model's
 * judgement about who said what or how explicit it was.
 *
 * | Proposal | Applied when | Otherwise |
 * |---|---|---|
 * | Journal page | always (a record, cited) | — |
 * | Timeline line on a person or project page | always (append-only, cited) | — |
 * | Commitment, owner = the person | explicit wording and a due date or trigger | review |
 * | Commitment, owner = someone else | they wrote it | review |
 * | Commitment closed | an explicit completion event | review |
 * | Decision or fact the person stated | the person is the author and the wording is explicit | review |
 * | Decision or fact stated by someone else | never | review (`stated_by: external`) |
 * | Preference or constraint | the person stated it about themselves | review |
 * | Supersession or contradiction | never | review (`contested`) |
 * | New person page | an actor seen in 2 or more units with a stable id | review |
 * | Merging two people | never | review |
 * | Instruction-, permission- or share-shaped from external text | never | dropped and logged |
 *
 * Two rows are tightened (FABLE records #4, owner decision D2):
 *
 * - Instruction-, permission- or share-shaped content the person wrote waits
 *   for review; it is never applied. From anyone else it is still dropped.
 * - The apply mode (`RECORDS_ROUTINE_APPLY`): `propose` (the default) sends
 *   every decision, fact, preference, constraint and commitment, opened or
 *   closed, to review; `auto` applies them by the table above. Journal and
 *   timeline lines apply in both.
 *
 * Interpretations (reported to the contract owner): "they wrote it" means the
 * quote's author is the named owner *and* a person the space already knows
 * (an identity-linked page), so a stranger's "I'll send it" waits in review;
 * procedures are not in the table and always wait; agent turns are never "the
 * person"; a closing event counts when the closer is the person or the owner.
 */
import {
  agentActor,
  COMPLETION_WORDING,
  FIRST_PERSON_COMMIT,
  HEDGED,
  SELF_PREFERENCE,
  candidateJudgement,
  fold,
  shapeNames,
  shapes,
} from "./guards.js"
import { quoteAuthor } from "./passes.js"
import { decisionEvidence } from "./extract.js"

export const MAX_PERSON_PROPOSALS = 10

/** The apply modes: `propose` (default) or `auto`. */
export const APPLY_MODES = Object.freeze(["propose", "auto"])

/** The apply mode from a setting; anything but "auto" is propose-only. */
export function applyMode(value) {
  return String(value ?? "").trim().toLowerCase() === "auto" ? "auto" : "propose"
}

const REVIEWED_IN_PROPOSE_MODE = new Set(["decision", "fact", "preference", "constraint", "commitment_open", "commitment_close"])

function statedBy(author) {
  if (author?.self) return "person"
  if (author?.agent) return "agent"
  return "external"
}

function sameName(a, b) {
  return Boolean(a && b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

/** True when a commitment's owner names this author (by path or by name). */
function ownerIs(owner, author, index, commitment) {
  if (!author || author.self || author.agent || !author.path) return false
  if (owner === author.path) return true
  const title = index.people.find((p) => p.path === author.path)?.title
  if (sameName(owner, title) || sameName(owner, author.name)) return true
  if (commitment) return (commitment.links ?? []).includes(author.path) && sameName(commitment.fields?.owner, title ?? author.name)
  return false
}

/**
 * Decide one validated item.
 * @returns {{outcome: "apply"|"propose"|"drop"|"journal", reason: string, stated_by: string, author: any}}
 */
export function decide(item, { refs, index, openCommitments, guards = { shapes }, mode = "propose", kindOf }) {
  const outcome = decideAuto(item, { refs, index, openCommitments, guards, kindOf })
  // The person's own meeting speech waits for review, whatever it says: the
  // notes are written by whoever shares the meeting, so Memory proposes and a
  // person decides (design §6).
  if (outcome.outcome === "apply" && outcome.author?.meeting) {
    return { ...outcome, outcome: "propose", reason: `the person's meeting speech waits for review (${outcome.reason})` }
  }
  if (outcome.outcome === "apply" && applyMode(mode) === "propose" && REVIEWED_IN_PROPOSE_MODE.has(item.type)) {
    return { ...outcome, outcome: "propose", reason: `routines propose only (${outcome.reason})` }
  }
  return outcome
}

function decideAuto(item, { refs, index, openCommitments, guards, kindOf }) {
  const info = refs.get(item.ref)
  const author = quoteAuthor(info, item.quote, fold) ?? { self: false, external: true }
  const by = statedBy(author)
  const out = (outcome, reason) => ({ outcome, reason, stated_by: by, author })

  // A hiring judgement is never knowledge (design v3.1): a ranking or a hire or
  // no-hire verdict about a candidate belongs to the people deciding, never to
  // a memory an agent reads back. No item type is exempt.
  if (candidateJudgement(`${item.text}\n${item.quote}`)) return out("drop", "a ranking or a hire judgement about a candidate is never knowledge")

  // Last row first: instruction-, permission- or share-shaped content. From
  // anyone else it is dropped; from the person it waits for review, never
  // applied (a pasted instruction can sit in the person's own turn).
  const found = guards.shapes(`${item.text}\n${item.quote}`)
  if (found.any) {
    const shaped = shapeNames(found).join("/")
    if (!author.self) return out("drop", `${shaped}-shaped content from ${author.agent ? "the agent" : "an external author"}`)
    if (["highlight", "timeline"].includes(item.type)) return out("drop", `${shaped}-shaped content is never journalled`)
    const typed = byType(item, { info, author, index, openCommitments, out, kindOf })
    return typed.outcome === "apply" ? out("propose", `${shaped}-shaped content waits for review`) : typed
  }
  return byType(item, { info, author, index, openCommitments, out, kindOf })
}

function byType(item, { info, author, index, openCommitments, out, kindOf }) {
  switch (item.type) {
    case "highlight":
      return out("journal", "journal line")
    case "timeline":
      return out("apply", "timeline lines are append-only and cited")
    case "decision":
      if (decisionEvidence(info, item.quote, kindOf) === "none") return out("drop", "not a choice or concrete recommendation")
      if (decisionEvidence(info, item.quote, kindOf) === "proposal") return out("propose", "a recommendation on an open choice")
      if (author.self) return out("apply", "the person stated it explicitly")
      return out("propose", author.self ? "the wording is not explicit" : "stated by someone else")
    case "fact":
      if (author.self && !HEDGED.test(item.quote) && item.quote.length >= 12) return out("apply", "the person stated it explicitly")
      return out("propose", author.self ? "the wording is not explicit" : "stated by someone else")
    case "preference":
    case "constraint":
      if (author.self && SELF_PREFERENCE.test(item.quote)) return out("apply", "the person stated it about themselves")
      return out("propose", "not stated by the person about themselves")
    case "procedure":
      return out("propose", "procedures wait for review")
    case "supersede":
      return out("propose", "supersessions and contradictions always wait")
    case "commitment_open": {
      const owner = item.owner ?? "user"
      if (owner === "user") {
        if (author.self && FIRST_PERSON_COMMIT.test(item.quote) && (item.due || item.trigger)) return out("apply", "the person committed explicitly, with a due date or trigger")
        return out("propose", author.self ? "no explicit wording or no due date or trigger" : "attributed to the person by someone else")
      }
      if (owner === "agent") return out("propose", "agent commitments wait")
      if (ownerIs(owner, author, index, null) && FIRST_PERSON_COMMIT.test(item.quote)) return out("apply", "the owner wrote it")
      return out("propose", "the owner did not write it")
    }
    case "commitment_close": {
      const c = openCommitments.get(item.commitment_id)
      if (!c) return out("drop", "unknown commitment")
      const closerOk = author.self || ownerIs(c.fields?.owner ?? "user", author, index, c)
      if (closerOk && COMPLETION_WORDING.test(item.quote)) return out("apply", "an explicit completion event")
      return out("propose", closerOk ? "the completion is not explicit" : "closed by someone other than the owner")
    }
    default:
      return out("drop", "unknown type")
  }
}

/**
 * New person pages and name-only links.
 * @returns {{create: any[], propose: any[], merge: any[]}}
 */
export function decidePeople({ newPeople, nameMatches }, { taken = new Set() } = {}) {
  const create = []
  const propose = []
  for (const actor of newPeople) {
    if (taken.has(actor.id)) continue
    // A bot, an agent or a service is never a person page (FINDINGS R3).
    if (agentActor(actor)) continue
    if (actor.units >= 2) create.push(actor)
    else if (actor.authored && propose.length < MAX_PERSON_PROPOSALS) propose.push(actor)
  }
  return { create, propose, merge: nameMatches }
}
