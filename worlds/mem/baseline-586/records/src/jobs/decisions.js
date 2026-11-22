/**
 * The Jobs-only decision and promise rules (J4 integration review, item 2).
 *
 * **Routines keep `main`'s behaviour.** This module is used by the job
 * runner's `extract` engine only, through the hooks `validateItems` and
 * `decide` now take; nothing here reaches a routine.
 *
 * What it adds to `main`'s `decisionKind`:
 * - **line labels** ("Outcome:", "Resolution:", "Decided:", "Conclusion:") and
 *   "agreed with <someone>:" record a choice;
 * - **the present tense with a date** — "we freeze hiring until March" — but
 *   only with a curated decision verb, never a negation or an uncertainty
 *   ("we don't know until Friday", "we might"), and never past-tense narrative
 *   ("we went to lunch"). Speech about someone else's decision is the
 *   attribution's job, not this rule's.
 *
 * The hedges, questions and recommendations of `main`'s rule are kept.
 */
import { DECISION_WORDING, fold } from "../routines/guards.js"
import { decisionKind, isWorkPromise } from "../routines/extract.js"

const HEDGE = /\b(?:maybe|perhaps|someday|not sure|unsure|don'?t know|do not know|doesn'?t know|no idea|might|could|would|should|until we know|if we|unless|haven'?t|hasn'?t|didn'?t|not decided|next year|not now|not yet|think about|consider(?:ing)?|brainstorm(?:ing)?|tbd|undecided)\b/i
const PAST = /\b(?:went|had|were|was|did|said|told|asked|met|ate|visited|shipped|launched|froze|moved|cut|adopted|used|switched|dropped|cancelled|canceled|postponed|hired|paused|kept|stopped|renewed|signed)\b/i
const LABEL = /\b(?:decision|decided|outcome|resolution|conclusion|final answer)\s*:/i
const AGREED_WITH = /\bagreed with [^:\n]{1,60}:/i
const DECISION_VERB = "ship|launch|freeze|move|cut|adopt|use|switch|drop|cancel|postpone|hire|pause|keep|stop|renew|sign|close|open|start|delay|reject|approve|replace|retire|migrate|deploy"
const PRESENT = new RegExp(`\\bwe\\s+(?:${DECISION_VERB})\\b[^.!?\\n]{0,90}\\b(?:on|until|by|from|in|to)\\s+\\S`, "i")

/**
 * `main`'s decision kind, with the two additions above and the refusals the
 * review asks for: no negation, no uncertainty, no past-tense narrative.
 */
export function jobDecisionKind(quote) {
  const value = fold(quote)
  // `main`'s hedges and its own verdict come first, so nothing here widens it.
  const base = decisionKind(quote)
  if (base === "made") return base
  if (HEDGE.test(value)) return base === "proposal" ? "proposal" : "none"
  // "We'll go with X", "agreed: X" and "we're going with X" are choices: the
  // meeting settled on one option (0.11 review, round 10).
  const goingWith = /\b(?:we(?:'ll| will| are| 're)?\s+go(?:ing)? with|let'?s go with|agreed(?: on)?\s*[:,-]|we(?:'ve| have)? (?:settled|landed) on)\s+\S/i
  const labelled = LABEL.test(value) || AGREED_WITH.test(value) || goingWith.test(value)
  if (labelled && !value.includes("?")) return "made"
  if (PRESENT.test(value) && !PAST.test(value) && !HEDGE.test(value) && !value.includes("?")) {
    // "we ship … on 9 December" is a choice; a bare recommendation is not.
    if (!/\b(?:should|propose|recommend|suggest|let'?s)\b/i.test(value)) return "made"
  }
  if (DECISION_WORDING.test(value)) return "made"
  return base
}

/** `main`'s promise verbs, plus the ones a job's collected text uses. */
const PROMISE_EXTRA = /\b(?:i(?:'ll| will| shall)|i can|let me)\s+(?:book|take|prepare|schedule|arrange|file|submit|chase|confirm)\b/i

/**
 * A promise, as the eval measured it: the person's own words with one of the
 * work verbs. A wider form rule ("will" + doer + action) was tried in round 10
 * and lowered precision, so it waits for its own fixtures.
 */
export function jobIsPromise(quote) {
  // Kept as it was: the verb list is what the eval was measured on, and a
  // wider form rule needs its own fixtures before it ships.
  return isWorkPromise(quote) || PROMISE_EXTRA.test(String(quote ?? ""))
}
