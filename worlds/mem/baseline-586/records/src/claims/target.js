/**
 * The known-or-new rule (docs/design/memory-routines-v1.md §5.1, quality H-A):
 * a decision's or fact's subject and attribute are chosen from those already
 * known for the subject, or marked new. A new attribute makes a new record and
 * never replaces an existing one, so "use Redis for the cache" cannot replace
 * "use Postgres".
 */
import { ClaimsError } from "./errors.js"
import { checkAttribute, checkSubject } from "./keys.js"

/**
 * @param {{knownSubjects: () => string[], knownAttributes: (subject: string) => string[]}} store
 * @param {{type: string, subject: string, attribute: string, new?: boolean,
 *   new_subject?: boolean, knownSubjects?: string[]}} input
 */
export function validateTarget(store, input) {
  const type = String(input?.type ?? "")
  if (!["decision", "fact", "preference", "constraint"].includes(type)) {
    throw new ClaimsError("invalid_type", `A subject and attribute belong to a decision, fact, preference or constraint, not "${type}".`, "Send one of those types.")
  }
  const subject = checkSubject(input.subject)
  const attribute = checkAttribute(input.attribute)
  if ((type === "preference" || type === "constraint") && subject !== "me") {
    throw new ClaimsError("invalid_subject", `A ${type} is about the person, so its subject is "me".`, 'Send subject "me".')
  }
  const batch = Array.isArray(input.knownSubjects) ? input.knownSubjects : []
  const subjectKnown = subject === "me" || batch.includes(subject) || store.knownSubjects().includes(subject)
  const newSubject = !subjectKnown && input.new_subject === true
  if (!subjectKnown && !newSubject) {
    throw new ClaimsError(
      "unknown_subject",
      `"${subject}" is not a subject this space knows.`,
      'Choose a page or an entity of the batch, or mark the subject new as a proposal.',
    )
  }
  const attributeKnown = store.knownAttributes(subject).includes(attribute)
  if (!attributeKnown && input.new !== true && !newSubject) {
    throw new ClaimsError(
      "unknown_attribute",
      `"${attribute}" is not an attribute of ${subject}.`,
      'Choose an attribute shown for the subject, or mark it new so it makes a new record.',
    )
  }
  return { subject, attribute, is_new: !attributeKnown, is_new_subject: newSubject }
}
