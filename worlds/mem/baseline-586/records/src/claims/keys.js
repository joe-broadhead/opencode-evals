/**
 * Keys and canonical values (docs/design/memory-routines-v1.md §4.2, §5.2).
 * Two keys exist and never mix: the **knowledge key** identifies what is filed,
 * and the **claim key** identifies one cited statement of it. Neither contains
 * the extractor, its version, or a position in an answer.
 */
import { createHash } from "node:crypto"
import { ClaimsError } from "./errors.js"
import { valueInKey } from "./registry.js"
import { canonicalValue, normaliseTask } from "./values.js"

export { canonicalValue, normaliseTask }

const ATTRIBUTE = /^[a-z0-9][a-z0-9-]{0,63}$/
const PAGE_PATH = /^[a-z0-9][a-z0-9-]{0,63}(?:\/[a-z0-9][a-z0-9-]{0,63}){0,3}$/

function digest(text) {
  return createHash("sha256").update(text).digest("hex")
}


/** A subject is `me`, or a page path such as `people/ama` or `projects/harbour`. */
export function checkSubject(subject) {
  if (subject === "me") return subject
  if (typeof subject !== "string" || !PAGE_PATH.test(subject)) {
    throw new ClaimsError(
      "invalid_subject",
      `${JSON.stringify(subject ?? null)} is not a subject.`,
      'Send "me", or a page path such as "projects/harbour".',
    )
  }
  return subject
}

/** An attribute is one lowercase slot such as `database` or `meeting-length`. */
export function checkAttribute(attribute) {
  if (typeof attribute !== "string" || !ATTRIBUTE.test(attribute)) {
    throw new ClaimsError(
      "invalid_attribute",
      `${JSON.stringify(attribute ?? null)} is not an attribute.`,
      'Send one lowercase slot such as "database" or "meeting-length".',
    )
  }
  return attribute
}

/**
 * The knowledge key of a claim (docs/design/memory-routines-v1.md §5.1, §5.2).
 *
 * @param {string} type
 * @param {{subject?: string, attribute?: string, sourceKey?: string, externalId?: string,
 *   sameAs?: string, owner?: string, counterparty?: string, task?: string,
 *   ref?: string, line?: string}} target
 */
export function knowledgeKey(type, target = {}) {
  if (type === "commitment") {
    if (target.sourceKey && target.externalId) return `ext:${target.sourceKey}:${target.externalId}`
    if (target.sameAs) return String(target.sameAs)
    if (!target.task) {
      throw new ClaimsError("missing_knowledge", "A commitment needs an external id, a same_as id, or a task.", "Send one of the three.")
    }
    const hash = digest([target.owner ?? "", target.counterparty ?? "", normaliseTask(target.task)].join("\u0000")).slice(0, 24)
    return `cmt:${hash}`
  }
  if (type === "timeline") {
    const subject = checkSubject(target.subject)
    if (!target.ref || !target.line) {
      throw new ClaimsError("missing_knowledge", "A timeline line needs its ref and its line.", "Send ref and line.")
    }
    return `tl:${digest([subject, target.ref, normaliseTask(target.line)].join("\u0000")).slice(0, 24)}`
  }
  const subject = checkSubject(target.subject)
  const attribute = checkAttribute(target.attribute)
  if ((type === "preference" || type === "constraint") && subject !== "me") {
    throw new ClaimsError("invalid_subject", `A ${type} is about the person, so its subject is "me".`, 'Send subject "me".')
  }
  return `${type}:${subject}#${attribute}`
}

/**
 * The claim key: the knowledge key plus the canonical value (design §4.2).
 * Two sightings of one statement are one claim; "done" and "open" for one
 * commitment are two claims.
 */
export function claimKey(type, knowledge, value, attribute = "") {
  return digest([type, String(knowledge ?? ""), String(attribute ?? ""), canonicalValue(value)].join("\u0000")).slice(0, 32)
}

/**
 * What a forgotten claim's tombstone names: its knowledge key, its value for an
 * upsert type, and the author whose words they were. Forgetting one decision
 * value does not block another value for the slot, and forgetting one author
 * does not block the same words from someone else (S2 third review).
 */
export function forgottenClaimKey(type, knowledge, value, author = "") {
  return [String(knowledge ?? ""), valueInKey(type) ? canonicalValue(value) : "", String(author ?? "")].join("\u0000")
}

/**
 * The key a rejection is remembered against (design §4.3): the claim key for
 * an upsert type, and the knowledge key alone for an append type, so rejecting
 * a promise stops the promise rather than one of its states.
 */
export function rejectionKey(type, knowledge, value) {
  return digest([type, String(knowledge ?? ""), valueInKey(type) ? canonicalValue(value) : ""].join("\u0000")).slice(0, 32)
}
