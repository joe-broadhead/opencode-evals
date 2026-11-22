/**
 * The extractor port (the plan's §3): `extract({batch, context, summaries}) →
 * {claims, usage, stop}`.
 *
 * S3 ships a **stand-in** that wraps the routines' own `buildPrompt` and
 * `validateItems`, so its token profile is real, and maps the items the model
 * returns to S2's claim inputs. Its keys are not S5's: S5 plugs the core
 * extractor in, and S4 adds `hints`. Nothing here writes anything.
 */
import { claimKey } from "../claims/keys.js"
import { buildPrompt, validateItems } from "../routines/extract.js"
import { words } from "../routines/extract.js"
import { sha256 } from "../ids.js"

/** S0's item types, as S2's claim types and values. */
const CLAIM_OF = Object.freeze({
  commitment_open: { type: "commitment", value: "open" },
  commitment_done: { type: "commitment", value: "done" },
  commitment_cancelled: { type: "commitment", value: "cancelled" },
  fact: { type: "fact" },
  decision: { type: "decision" },
  preference: { type: "preference" },
  constraint: { type: "constraint" },
  timeline: { type: "timeline" },
})

/** A stable knowledge key for a stand-in claim: its type and its statement. */
export function standInKey(type, text) {
  return `engine:${type}:${sha256(words(text).slice(0, 8).join(" ")).slice(0, 16)}`
}

/**
 * One validated item, as S2 files it.
 *
 * @param {{type: string, ref: string, text: string, quote: string, subject?: string, attribute?: string, kind?: string}} item
 */
export function claimOf(item, { source = "", version = "" } = {}) {
  const mapped = CLAIM_OF[item.type] ?? { type: "fact" }
  const statement = String(item.text ?? item.quote ?? "").trim()
  // S0's items carry the entities they speak about and no subject field: a
  // claim is about a person when one of them is a person page, which is what
  // the trait tier reads.
  const about = (Array.isArray(item.entities) ? item.entities.find((entity) => String(entity).startsWith("people/")) : null) ?? null
  const claim = {
    type: mapped.type,
    subject: String(item.subject ?? about ?? "me"),
    attribute: String(item.attribute ?? (words(statement).slice(0, 4).join("-") || "statement")),
    value: String(item.value ?? mapped.value ?? ""),
    statement,
    stated_by: "person",
    quote: String(item.quote ?? ""),
    refs: [String(item.ref)],
    source,
    version,
    state: "proposed",
    knowledge_key: standInKey(mapped.type, statement),
  }
  claim.claim_key = claimKey(claim.type, claim.knowledge_key, claim.value, claim.attribute)
  return claim
}

/**
 * The stand-in: one call per batch, the routines' prompt, S2's claim inputs.
 *
 * @param {{llm: any, day?: string, person?: {label?: string}, maxTokens?: number}} input
 */
export function createStandInExtractor({ llm, day = new Date().toISOString().slice(0, 10), person = { label: "the person" }, maxTokens = 4_000, version = "engine-standin@v1" } = {}) {
  return {
    version,
    /**
     * @param {{batch: any, context: any, summaries: any[]}} input
     * @returns {Promise<{claims: any[], usage: {total: number}, stop: string|null, rejected: any[], kept: any[], calls: number, content: string}>}
     */
    async extract({ batch, context = { entities: [], summaries: [] }, summaries = [] }) {
      const units = batch.units ?? []
      const index = {
        people: context.entities.filter((entity) => String(entity.path).startsWith("people/")).map((entity) => ({ path: entity.path, title: entity.title })),
        projects: context.entities.filter((entity) => String(entity.path).startsWith("projects/")).map((entity) => ({ path: entity.path, title: entity.title })),
        peopleIn: () => [],
        projectsIn: () => [],
      }
      const lines = summaries.map((summary) => summary.text)
      const prompt = buildPrompt({ day, person, index, units })
      const user = lines.length ? `${prompt.user}\nSUMMARIES\n${lines.join("\n")}` : prompt.user
      // The engine carries a 429 in its tier's `not_before` instead of sleeping
      // inside the call (plan §4).
      const answer = await llm.complete({ system: prompt.system, user, maxTokens, rateLimitRetry: false })
      const json = answer?.json
      const refs = new Map()
      for (const unit of units) for (const item of unit.items ?? []) refs.set(item.ref, item)
      // `validateItems` returns S0's own item shape and drops fields it does not
      // know, so the attribute the model named (a trait's category, say) is read
      // back from the raw answer and carried beside it.
      const rawItems = json && Array.isArray(json.items) ? json.items : []
      const rawOf = (item) => rawItems.find((candidate) => candidate?.ref === item.ref && String(candidate?.text ?? "") === String(item.text ?? ""))
      const attributeOf = (item) => {
        const raw = rawOf(item)
        return typeof raw?.attribute === "string" ? raw.attribute : undefined
      }
      const valueOf = (item) => {
        const raw = rawOf(item)
        return typeof raw?.value === "string" ? raw.value : undefined
      }
      const validated = validateItems(json && Array.isArray(json.items) ? json : { items: [] }, {
        day,
        refs,
        batchRefs: new Set(refs.keys()),
        // The paths the batch actually carries: a claim that cites an entity the
        // call did not show is dropped, as any other unknown id is (§8.4).
        paths: context.paths ?? new Set((context.entities ?? []).map((entity) => entity.path)),
        commitmentIds: new Set(),
        memoryIds: new Set(),
      })
      // A cut answer: what the model completed is kept, and the caller splits
      // the rest of the batch in half (`answer.js`).
      // A cut answer says so: the routines' client sets `truncated` when it keeps
      // the complete items of a length stop, and a provider may name the stop.
      const cut = json?.truncated === true || json?.stop === "length" || answer?.stop === "length"
      return {
        claims: validated.items.map((item) => claimOf({ ...item, attribute: attributeOf(item), value: valueOf(item) }, { source: batch.source, version })),
        items: validated.items,
        kept: validated.items,
        rejected: validated.rejected,
        usage: { total: Number(answer?.usage?.total) || 0 },
        calls: Number(answer?.calls) || 1,
        stop: cut ? "length" : null,
        content: String(answer?.content ?? ""),
      }
    },
  }
}
