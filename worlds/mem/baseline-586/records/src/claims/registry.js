/**
 * The core knowledge types and their projection rule (docs/design/
 * memory-routines-v1.md §5.1). Nothing here knows a source: a plugin's claim
 * arrives as one of these types, and the registry decides how it is filed.
 */
import { ClaimsError } from "./errors.js"
import { canonicalValue } from "./values.js"

/**
 * `append` makes a record for a new knowledge key and only adds citations to an
 * existing one. `transition` reads a state claim. `upsert` keeps one current
 * value per (subject, attribute). `reduce` is an interface only in v1.
 */
export const CORE_TYPES = Object.freeze({
  commitment: Object.freeze({ rule: "append", transitions: Object.freeze(["open", "done", "cancelled", "reopened", "snoozed"]) }),
  decision: Object.freeze({ rule: "upsert" }),
  fact: Object.freeze({ rule: "upsert" }),
  preference: Object.freeze({ rule: "upsert" }),
  constraint: Object.freeze({ rule: "upsert" }),
  timeline: Object.freeze({ rule: "append" }),
  voice: Object.freeze({ rule: "reduce" }),
})

/** The types a claim may name, as a list, for a refusal's next step. */
export const CLAIM_TYPES = Object.freeze(Object.keys(CORE_TYPES))

export function typeOf(type) {
  const entry = CORE_TYPES[type]
  if (!entry) {
    throw new ClaimsError("invalid_type", `"${String(type)}" is not a core knowledge type.`, `Send type as one of ${CLAIM_TYPES.join(", ")}.`)
  }
  return entry
}

export function ruleOf(type) {
  return typeOf(type).rule
}

/** True when the type's identity includes its canonical value. */
export function valueInKey(type) {
  return ruleOf(type) === "upsert"
}

/**
 * Precedence (docs/design/memory-routines-v1.md §5.3), lowest number first:
 * 1 the system of record, 2 the person's own statement, edit or accepted claim,
 * 3 another person's statement, 4 a model inference.
 */
export function precedenceOf(claim) {
  if (claim?.system === true) return 1
  const statedBy = String(claim?.stated_by ?? "")
  if (statedBy === "person") return 2
  if (statedBy.startsWith("other:") || statedBy.startsWith("source:")) return 3
  return 4
}

/**
 * What to do with a newer value for one (subject, attribute). A same value is a
 * citation only. A different value always waits for review in v1, in every
 * apply mode, and a person's pin says so with its own reason.
 */
export function supersessionVerdict({ current, incoming, pin } = {}) {
  const now = canonicalValue(current?.value ?? pin?.value)
  const next = canonicalValue(incoming?.value)
  if (now === next) return { verdict: "none", reason: "the same value" }
  if (pin && canonicalValue(pin.value) !== next) {
    return { verdict: "review", reason: "the person pinned this attribute, so a change waits for review" }
  }
  return { verdict: "review", reason: "a supersession waits for review in v1, in every apply mode" }
}

/**
 * The reduce interface (v1 has voice only, and it comes later). It exists so the
 * projection table is complete and a later slice has one seam, and it refuses
 * rather than pretending.
 */
export function reduceLines() {
  throw new ClaimsError(
    "reduce_not_implemented",
    "A reduced page line needs a model call, and v1 does not run one.",
    "File claims and project them; voice arrives in a later slice.",
  )
}
