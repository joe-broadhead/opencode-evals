/**
 * Logging for the routines, through the log the service passes in: an object
 * with `info`/`warn`/`error`/`debug` methods, or a single function taking
 * `(entry)`. Each call is one JSON line in the service's log.
 *
 * `memory.routine` is the alerting event (memory-v1-contracts.md §6): exactly
 * one line per actual run, `{event, outcome: "ok"|"failed"|"budget"|"held",
 * routine, team, tokens, ms}`. `held` is a day whose trait gate could not clear
 * a claim: the claim waits in the space's holds, never dropped and never
 * applied, and the next run retries it (design §5.4). The field is still named `team` because alerts read it,
 * but the value is a hash of the space id (the file's key), not the container
 * id: legacy personal spaces share a container. Anything else uses another
 * event name (`memory.routine.tick`, `.config`, `.llm`, …), because any
 * `memory.routine` outcome other than `ok` pages someone.
 */
import { createHash } from "node:crypto"

export const ALERT_EVENT = "memory.routine"
export const ALERT_OUTCOMES = Object.freeze(["ok", "failed", "budget", "held"])

/** A stable, non-reversible tag for a space id in logs. The argument is the space id; the logged field stays `team`. */
export function teamTag(teamId) {
  return createHash("sha256").update(String(teamId)).digest("hex").slice(0, 16)
}

export function emit(log, level, entry) {
  if (!log) return
  if (entry?.event === ALERT_EVENT && !ALERT_OUTCOMES.includes(entry.outcome)) {
    throw new Error(`${ALERT_EVENT} carries only ${ALERT_OUTCOMES.join(", ")}; got ${entry.outcome}`)
  }
  const line = entry?.team !== undefined && entry.event !== ALERT_EVENT && !/^[0-9a-f]{16}$/.test(String(entry.team)) ? { ...entry, team: teamTag(entry.team) } : entry
  if (typeof log === "function") log(line)
  else if (typeof log[level] === "function") log[level](line)
  else if (typeof log.info === "function") log.info(line)
}

/** The one alert line of a run. */
export function runLine({ status, routine, teamId, tokens, ms }) {
  return { event: ALERT_EVENT, outcome: status, routine, team: teamTag(teamId), tokens: Number(tokens) || 0, ms: Math.max(0, Math.round(ms)) }
}
