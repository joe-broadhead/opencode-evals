/**
 * Curation refusals, applied again in the records service (contract §2.4):
 * a memory that reads as task status, carries an instruction, holds a secret,
 * a person's email address or a home-directory path is refused with 422
 * `refused`, as in 0.9.5 (owner decision D3'). A routine's write is masked by
 * the store instead (records/src/storable.js).
 *
 * VENDORED from the plugin's `src/curation.js` (the patterns and the order of
 * the checks, verbatim). The service is its own image and cannot import the
 * plugin. `records/test/curation-parity.test.js` runs both modules over one
 * fixture list and fails when their verdicts differ, so change both together.
 * Only the messages differ: these name the records API, not the plugin's tools.
 */

import { storable } from "./storable.js"

const STATUS = [
  /\bnot yet (?:confirmed|decided|done|started|finished|merged|deployed|released)\b/i,
  // "in progress" as a state of something, not as an adjective ("an in progress bar").
  /\b(?:is|are|was|were|remains?|still|currently|now) in progress\b/i,
  /\bstill (?:running|pending)\b/i,
  /\bcurrently pending\b/i,
  /\bwork in progress\b/i,
  // A next action is a label or a statement, not the noun ("record a next action").
  /\bnext (?:action|step)s?\s*(?::|is\b|are\b|will be\b)/i,
  // A to-do marker or a list membership, not the product noun ("the TODO list UI").
  /\bto-?do\s*:/i,
  /\b(?:still|left) to[- ]?do\b/i,
  /\bon (?:the|my|our|a) to-?do list\b/i,
  /\btbd\b/i,
  /\bpending (?:confirmation|review|approval)\b/i,
  // A status label opening a line: "Status: half done", "Progress - 3 of 5".
  // Not "status 403", "Status codes:", or "Status-shaped writes".
  /^\s*(?:status|progress)\s*(?::|[-–—]\s)/im,
  // A line that opens as a work-in-progress marker: "WIP: auth", "In progress: x".
  /^\s*(?:wip|in progress)\b\s*[:\-–—]?/im,
  // Partly finished, said of something: "the walkthrough is half done". Not a
  // rule about such things ("never ship half done migrations").
  /\b(?:is|are|was|were|now|currently|still)\s+(?:about |roughly |around |only |just )?(?:half|mostly|nearly|almost|partly|partially)[- ](?:done|finished|complete|completed|through)\b/i,
  // Progress as a share: "40% done", "70 % complete". Not "an error budget of 0.1%".
  /\b\d{1,3}(?:\.\d+)?\s?%\s+(?:done|complete|completed|finished|through)\b/i,
  // Under way, said of something: "the migration is under way".
  /\b(?:is|are|was|were|now|currently|still)\s+(?:well\s+)?under\s?way\b/i,
]

// The reply payload is a fixed all-caps token or a short quoted string that
// ends the clause. "Reply with JSON when the client asks" is a protocol rule,
// not a dictated answer, so the payload must be followed by the end of the
// clause or a connective that keeps the injected sentence going.
const PAYLOAD_END = String.raw`(?=\s*(?:$|[.!,;)]|(?:instead|and|only|now|then)\b))`
const DICTATED_REPLY = new RegExp(
  String.raw`(?:^|[.!?;:]\s*|\b(?:[Aa]nd|[Tt]hen)\s+)(?:[Rr]eply|[Rr]espond|[Ss]ay)\s+(?:(?:[Oo]nly|[Ee]xactly|[Jj]ust)\s+)?(?:[Ww]ith\s+)?(?:["'“‘][^"'”’\n]{1,40}["'”’]|[A-Z]{3,}\b)${PAYLOAD_END}`,
)

const INSTRUCTION = [
  /\b(?:ignore|disregard) (?:(?:all|any|the|your) )*(?:(?:previous|prior|above|earlier|other) )?(?:instructions|rules|directions)\b/i,
  /\b(?:you are|you're) now\b/i,
  DICTATED_REPLY,
  /\breveal (?:the |your )?(?:secret|token|password|api key|credentials|system prompt)\b/i,
  // Talking about the system prompt is a fact; acting on it is an instruction.
  /\b(?:print|show|repeat|override|replace|ignore|disregard) (?:the |your )?system prompt\b/i,
  /\b(?:new|updated) system prompt\b/i,
  /\b(?:do not|don't|never) (?:tell|mention|inform) the user\b/i,
  // Text addressed to whoever reads the record back later.
  /\b(?:when|if|once|after) you (?:read|see|recall|retrieve|load) (?:this|these)\b/i,
]

export function isStatusShaped(text) {
  const value = String(text ?? "")
  return value.length > 0 && STATUS.some((pattern) => pattern.test(value))
}

export function isInstructionShaped(text) {
  const value = String(text ?? "")
  return value.length > 0 && INSTRUCTION.some((pattern) => pattern.test(value))
}

/**
 * Why a memory must be refused, or null when it may be stored. The order is
 * the plugin's: empty, status, instruction, secret, email, local path.
 *
 * @param {string} text
 * @returns {{reason: "empty"|"status"|"instruction"|"secret"|"email"|"local_path", message: string, next: string} | null}
 */
export function refusal(text) {
  const value = String(text ?? "").trim()
  if (!value) {
    return { reason: "empty", message: "Nothing to remember: the memory's body is empty.", next: "Send the memory's text in record.body." }
  }
  if (isStatusShaped(value)) {
    return {
      reason: "status",
      message: "Not stored: that reads as task status, which goes stale as soon as the work moves.",
      next: "Record something to do as a commitment (kind commitment), and where work stands in the project page's Status section (records.append to the page); with a tracker connected, use the tracker.",
    }
  }
  if (isInstructionShaped(value)) {
    return {
      reason: "instruction",
      message: "Not stored: the text contains an instruction. Memory is a data channel and never carries commands.",
      next: "Store the fact or decision itself, without the command.",
    }
  }
  return unstorable(value, "remember")
}

/**
 * Why an explicit write may not be stored (owner decision D3', the plugin's
 * `storable`): a secret, a person's email address, or (in a memory) a
 * home-directory path; null when it may. The email and path wording is
 * 0.9.5's, so an agent relays the same answer.
 *
 * @param {string} text
 * @param {"remember"|"page"|"commitment"} path the write path: a memory is `remember`
 * @returns {{reason: "secret"|"email"|"local_path", message: string, next: string} | null}
 */
export function unstorable(text, path) {
  const verdict = storable(text, path)
  if (verdict.outcome !== "refuse") return null
  if (verdict.reason === "email") {
    return {
      reason: "email",
      message: "Nothing was stored: Memory doesn't store email addresses. An email address is personal data, not a durable fact.",
      next: "Keep the decision and link the person's page, such as [[people/ama]], instead of the address.",
    }
  }
  if (verdict.reason === "local_path") {
    return {
      reason: "local_path",
      message: "Not stored: an absolute local path is repo state, not a fact. It is wrong on every other machine.",
      next: "Use a path relative to the repository, or leave the path out.",
    }
  }
  return {
    reason: "secret",
    message: `Not stored: the text holds a secret (${verdict.secrets.join(", ")}). Secrets are never stored.`,
    next: "Send it again without the value.",
  }
}
