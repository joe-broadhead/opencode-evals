/**
 * The context a call carries (design §10.2; the plan's §3): deterministic thread
 * summaries, and at most forty linked entities ranked by how many of the batch's
 * items cite them.
 *
 * Nothing here calls a model: a summary is the thread's title, its participants
 * and the claims already filed about it, written by code, so the same batch
 * always produces the same call. The caps are the design's: 1,500 characters a
 * thread, 2,000 tokens of summaries a call, forty entities. What does not fit is
 * cut rather than sent, and the answer says it was cut.
 */
import { estimateTokens } from "../routines/llm.js"

export const SUMMARY_CHARS = 1_500
export const CONTEXT_TOKENS = 2_000
export const MAX_ENTITIES = 40

const clip = (value, max) => {
  const text = String(value ?? "")
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/**
 * One summary per thread: its title, who took part, and the claims already
 * filed, at most 1,500 characters.
 *
 * @param {Array<{key: string, title?: string, participants?: string[], claims?: Array<{statement?: string}>}>} threads
 */
export function summariesOf(threads) {
  const out = []
  for (const thread of threads) {
    const lines = [`${clip(thread.title ?? thread.key ?? "thread", 160)}`]
    const people = (thread.participants ?? []).filter(Boolean)
    if (people.length > 0) lines.push(`with ${clip([...new Set(people)].slice(0, 8).join(", "), 240)}`)
    const claims = (thread.claims ?? []).map((claim) => String(claim.statement ?? claim.text ?? "")).filter(Boolean)
    let text = lines.join("\n")
    let truncated = false
    for (const claim of claims) {
      const line = `- ${claim}`
      if (text.length + line.length + 1 > SUMMARY_CHARS) {
        truncated = true
        break
      }
      text += `\n${line}`
    }
    if (text.length > SUMMARY_CHARS) {
      text = clip(text, SUMMARY_CHARS)
      truncated = true
    }
    out.push({ key: thread.key ?? thread.title ?? "", text, truncated })
  }
  return out
}

/**
 * The batch's linked entities, ranked by how many of its items cite them: the
 * most cited first, then the path, so the order is the same for the same batch.
 */
export function rankEntities({ items = [], entities = [], limit = MAX_ENTITIES } = {}) {
  const counts = new Map()
  const known = new Map(entities.map((entity) => [entity.path, entity]))
  for (const item of items) {
    for (const path of [...(item.people ?? []), ...(item.projects ?? [])]) {
      if (!known.has(path)) continue
      counts.set(path, (counts.get(path) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([path, citations]) => ({ path, title: known.get(path)?.title ?? path, citations }))
}

/**
 * The whole context of one call: the entities and the summaries, cut to 2,000
 * tokens. Summaries are taken in the batch's own order until the budget is
 * spent, so a batch with many threads carries the first ones whole rather than
 * all of them in half.
 */
export function contextOf({ threads = [], items = [], entities = [], tokens = CONTEXT_TOKENS } = {}) {
  const ranked = rankEntities({ items, entities })
  const summaries = []
  let spent = estimateTokens(JSON.stringify(ranked))
  let cut = false
  for (const summary of summariesOf(threads)) {
    const cost = estimateTokens(summary.text)
    if (spent + cost > tokens) {
      cut = true
      break
    }
    summaries.push(summary)
    spent += cost
  }
  return { entities: ranked, summaries, tokens: spent, truncated: cut }
}
