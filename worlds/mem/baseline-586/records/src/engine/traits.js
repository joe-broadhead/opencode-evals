/**
 * The trait tier (design §5.4; the plan's §3): a claim about a person with a
 * free-text value is never filed on the extractor's word.
 *
 * The commit writes such a claim as **held** — a row in the retry set, kind
 * `held`, carrying the claim's subject and attribute — and a `classify` lease
 * takes up to S1's `maxPerCall` of them in **one** call to S1's own gate
 * (`createTraitGate`). A claim the gate flags is dropped: it is not filed, not
 * proposed and not written to the shadow log. A hold is retried until the
 * classifier answers, and is never set aside (decision 2).
 */
import { MAX_PER_CALL } from "../routines/traits.js"

import { TRAIT_CATEGORIES } from "../routines/traits.js"

export { MAX_PER_CALL }

const FREETEXT = /\s/

/**
 * True when a claim is about a person in free text: its subject is a person
 * page, or its attribute is one of the traits S1 knows and its value is a
 * phrase rather than a closed value. A structure like `subject: "me",
 * attribute: "send-deck", value: "open"` is not one, and neither is a plain fact.
 *
 * @param {{subject?: string, type?: string, value?: string, statement?: string, attribute?: string}} claim
 */
export function needsTraitGate(claim) {
  const subject = String(claim?.subject ?? "")
  if (subject.startsWith("people/")) return true
  const attribute = String(claim?.attribute ?? "")
  // A trait is a category S1 knows, whether the claim names a linked person, the
  // person themselves or nobody the batch linked: the gate reads every claim
  // about a person with a free-text value, the person included (design §5.4,
  // review M6). A trait's attribute is the category itself, so the value need not
  // repeat it.
  return TRAIT_CATEGORIES.includes(attribute)
}

/** The reason a held row carries, so a person can see what waits and why. */
export function holdReason(claim) {
  return `${claim.subject ?? "a person"} ${claim.attribute ?? "claim"}`.slice(0, 200)
}

/** One numbered entry per hold, as S1's gate asks. */
export function gateEntries(holds) {
  return holds.map((hold, index) => ({ n: index + 1, text: String(hold.reason ?? ""), quote: String(hold.item ?? ""), key: hold.event_id }))
}
