/**
 * The leases (design §10.3; the plan's §3): one in flight per
 * `space|lane|source|account`, so a batch and the halves of a split batch finish
 * in order.
 *
 * The map is the process's own, and the rule is one records process per cell
 * (`routines/index.js`). A second process is kept honest by `commitBatch`'s
 * compare-and-set, which refuses a cursor that moved under it.
 */
export function createLeases() {
  const held = new Set()
  const keyOf = ({ space, lane, source, account }) => [space, lane, source, account].join("|")
  return {
    keyOf,
    /** True when this caller took the lease; false when another holds it. */
    acquire(input) {
      const key = keyOf(input)
      if (held.has(key)) return false
      held.add(key)
      return true
    },
    release(input) {
      held.delete(keyOf(input))
    },
    busy(input) {
      return held.has(keyOf(input))
    },
    get size() {
      return held.size
    },
    /** Let every lease go: a tick abandoned at its deadline held them (review M2). */
    reset() {
      held.clear()
    },
  }
}
