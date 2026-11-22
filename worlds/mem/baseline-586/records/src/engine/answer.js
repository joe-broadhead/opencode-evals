/**
 * One answer, and the queue behind it (design §10.3; the plan's §3).
 *
 * The model answers one JSON object. When it is cut off at the output cap, the
 * items it completed are kept (`completeItems`, S0) and the rest of the batch is
 * split in half and put back at the **head** of the same lease key, first half
 * then second. The lease key's queue is what keeps the order: a half is only
 * taken when the half before it has committed, so a second answer that arrives
 * first waits, and a cursor never steps over an item nobody read.
 */
export function createQueue() {
  const queues = new Map()
  return {
    /** Put work at the head of a key, in order. */
    push(key, entries) {
      const list = queues.get(key) ?? []
      queues.set(key, [...entries, ...list])
      return queues.get(key).length
    },
    /** The next batch for a key, or null. */
    take(key) {
      const list = queues.get(key)
      if (!list || list.length === 0) return null
      const next = list.shift()
      if (list.length === 0) queues.delete(key)
      return next
    },
    /** What is waiting on a key. */
    size(key) {
      return (queues.get(key) ?? []).length
    },
    keys() {
      return [...queues.keys()]
    },
  }
}

/**
 * What a cut answer leaves: the complete items are kept, and the rest of the
 * batch becomes two halves with disjoint seq ranges, in order.
 *
 * @param {{answer: {stop?: string, items?: any[], kept?: any[]}, batch: {items: any[], lo?: number, hi?: number}}} input
 */
export function splitOnStop({ answer, batch }) {
  const keptRefs = new Set((answer.kept ?? answer.items ?? []).map((item) => item.ref))
  const keep = batch.items.filter((item) => keptRefs.has(item.ref))
  const rest = batch.items.filter((item) => !keptRefs.has(item.ref))
  const half = Math.ceil(rest.length / 2)
  const halves = []
  if (rest.length === 0) return { keep, halves }
  const cut = rest.slice(0, half)
  const tail = rest.slice(half)
  // The kept items are committed first, so the first half starts where they end
  // and covers only what was cut (review M1): rebuilding the halves from the
  // batch's own start would read the kept items again, and file their claims
  // twice.
  const lo = keep.length > 0 ? Number(keep.at(-1).seq) : (Number.isFinite(batch.lo) ? batch.lo : (batch.items[0]?.seq ?? 0) - 1)
  const mid = cut.at(-1)?.seq ?? lo
  const hi = Number.isFinite(batch.hi) ? batch.hi : (batch.items.at(-1)?.seq ?? mid)
  halves.push({ items: cut, lo, hi: mid })
  if (tail.length > 0) halves.push({ items: tail, lo: mid, hi })
  return { keep, halves }
}
