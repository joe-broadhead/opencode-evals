/**
 * The canary (design §10.5; plan §4): one fixture event every fifteen minutes
 * into `RECORDS_ENGINE_CANARY_SPACE`, through the same ingest and the same
 * lanes as a person's mail. If a fixture is not committed within the `own`
 * target, the cell pages: a quiet cell is a broken one, not a healthy one.
 *
 * The fixture carries no person's words: a fixed id, a fixed kind, and one line
 * that says what it is.
 */
import { eventId } from "../ids.js"

export const CANARY_EVERY_MS = 15 * 60_000
export const CANARY_SOURCE = "engine.canary"
export const CANARY_ACCOUNT = "canary"
export const CANARY_OWNER = Object.freeze({ id: "mailto:canary@engine.invalid", label: "engine canary" })
export const CANARY_TEXT = "Engine canary."
/** How many fixtures the canary remembers: a day and a half of them. */
export const CANARY_TRACKED = 96

/**
 * @param {{store: any, space: string, now?: () => Date, everyMs?: number, targetMs?: number, actor?: object}} input
 */
export function createCanary({ store, space, now = () => new Date(), everyMs = CANARY_EVERY_MS, targetMs = 15 * 60_000, actor = null } = {}) {
  const state = { last: 0, sent: 0, pages: 0, lastPage: null }
  const events = []
  /** The fixture's own binding, once: a canary space is the operator's, not a person's. */
  async function bind(handle) {
    const row = handle.get("select status from sources where source = ? and account = ?", CANARY_SOURCE, CANARY_ACCOUNT)
    if (row?.status === "confirmed") return
    const at = now().toISOString()
    handle.run(
      `insert into sources (source, account, owner_id, owner_label, status, confirmed_at, enabled, created, updated)
       values (?, ?, ?, ?, 'confirmed', ?, 1, ?, ?)
       on conflict(source, account) do update set status = 'confirmed', enabled = 1, confirmed_at = excluded.confirmed_at, updated = excluded.updated`,
      CANARY_SOURCE,
      CANARY_ACCOUNT,
      CANARY_OWNER.id,
      CANARY_OWNER.label,
      at,
      at,
      at,
    )
  }
  return {
    state,
    /**
     * One tick: send a fixture when the interval has passed, and answer a page
     * when an earlier fixture is still uncommitted past the target.
     */
    async tick() {
      const spaceStore = store.forSpace(space)
      const handle = store.spaceHandle(space, { create: true })
      await bind(handle)
      store.releaseSpace(space)
      const at = now().getTime()
      const due = at - (state.last || 0) >= everyMs
      if (due) {
        const external = `canary-${new Date(at).toISOString()}`
        const answer = await spaceStore.ingestEvents(
          {
            source: CANARY_SOURCE,
            account: CANARY_ACCOUNT,
            owner: CANARY_OWNER,
            cursor: external,
            // The fixture is the canary's own author, so it lands on `own` and is
            // held to the `own` target it is paged against (review M5).
            events: [{ external_id: external, kind: "message", occurred_at: new Date(at).toISOString(), thread: `canary:${external}`, actors: [{ role: "from", id: CANARY_OWNER.id, name: CANARY_OWNER.label }], title: "Engine canary", text: CANARY_TEXT, labels: ["canary"] }],
          },
          actor ?? { user: CANARY_OWNER.id, agent: "canary", session: null, role: "owner", grants: [], space, spaceKind: "personal", team: "canary" },
        )
        state.last = at
        state.sent += Number(answer?.accepted) || 0
        events.push({ external, at })
        // Only a day and a half of fixtures are watched.
        while (events.length > CANARY_TRACKED) events.shift()
      }
      // A fixture older than the target that no lane has passed is a page: its
      // lane's cursor is the record that the engine read it. One handle answers
      // for every fixture of the tick (review M5), and a fixture retention has
      // deleted is forgotten rather than paging for ever.
      const watching = events.filter((event) => at - event.at > targetMs)
      let late = null
      if (watching.length > 0) {
        const handle = store.spaceHandle(space)
        for (const event of watching) {
          const id = eventId(CANARY_SOURCE, CANARY_ACCOUNT, event.external)
          const row = handle?.get(
            "select e.id, e.seq, e.lane, coalesce((select c.cursor from lane_cursors c where c.lane = e.lane and c.source = e.source and c.account = e.account), 0) as cursor from events e where e.id = ?",
            id,
          )
          if (!row) {
            // Retention took it: nothing is owed, so nothing pages.
            events.splice(events.indexOf(event), 1)
            continue
          }
          if (row.lane && Number(row.seq) > Number(row.cursor)) late = event
          if (late) break
        }
        store.releaseSpace(space)
      }
      if (late) {
        state.pages += 1
        state.lastPage = { space, external_id: late.external, at: new Date(at).toISOString(), reason: "canary_missed", target_ms: targetMs }
        return { sent: due, page: state.lastPage }
      }
      return { sent: due, page: null }
    },
    sent: () => state.sent,
  }
}
