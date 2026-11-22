/**
 * The pools (design §10.2; the plan's §3): one per tier (`extract`,
 * `classify`), resizable, with one call per lease and a hard timeout below
 * `llm.js`'s 150 s so a worker is never held past the provider's own limit.
 *
 * A pool is a count, not a scheduler: it runs at most `size` tasks at once and
 * queues the rest in order. Its size and timeout are the only bound on how many
 * connections the cell opens, because nothing in `llm.js` limits them.
 */
export const DEFAULT_TIMEOUT_MS = 120_000

export function createPool({ size = 2, timeoutMs = DEFAULT_TIMEOUT_MS, now = () => Date.now() } = {}) {
  let limit = Math.max(1, Number(size) || 1)
  let active = 0
  const waiting = []
  const runOne = async (task) => {
    active += 1
    const started = now()
    let timer = null
    try {
      const budget = Math.max(1, Number(task.timeoutMs) || timeoutMs)
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`the model did not answer within ${Math.round(budget / 1000)} s`), { code: "llm_timeout" })), budget)
        timer.unref?.()
      })
      return await Promise.race([Promise.resolve().then(task.run), timeout])
    } finally {
      if (timer) clearTimeout(timer)
      active -= 1
      const next = waiting.shift()
      if (next) next()
    }
  }
  const pool = {
    get size() {
      return limit
    },
    get active() {
      return active
    },
    get queued() {
      return waiting.length
    },
    resize(n) {
      limit = Math.max(1, Number(n) || 1)
      return limit
    },
    /** Run one task inside the pool; queued until a slot frees. */
    async exec(task) {
      while (active >= limit) await new Promise((resolve) => waiting.push(resolve))
      return runOne(task)
    },
  }
  return pool
}
