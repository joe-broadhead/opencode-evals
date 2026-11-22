/**
 * The engine's own failures (S3a). They are `RecordsError`s, so a caller that
 * reaches them through the service answers with the same `{error: {code,
 * message, next}}` shape as every other refusal, and `message`/`next` say what
 * happened and what to do about it.
 */
import { RecordsError } from "../errors.js"

export class EngineError extends RecordsError {
  /**
   * @param {string} code
   * @param {string} message
   * @param {string} next
   * @param {{status?: number, extra?: Record<string, unknown>}} [options]
   */
  constructor(code, message, next, { status = 409, extra } = {}) {
    super(status, code, message, next, extra)
    this.name = "EngineError"
  }
}

/** §8.4: a lane is opened in a personal space only. */
export function personalSpaceOnly(spaceId) {
  return new EngineError(
    "personal_space_only",
    `The engine opens no lane in the shared space ${spaceId}.`,
    "Nothing to do: v1 reads only personal spaces. Leave the space's events numbered, or use a personal space.",
    { status: 403 },
  )
}

/** The cursor was moved by another writer between the read and the commit. */
export function cursorRace(lane, source, account) {
  return new EngineError(
    "cursor_race",
    `The ${lane} lane's cursor for ${source} (${account}) moved while this batch was being read, so nothing was written.`,
    "Read the lane again from its current cursor; a second commit is never replayed on top of the first.",
  )
}

/** §10.1: at 2,000 rows the retry set stops its lane advancing. */
export function retryCap(lane, total, cap) {
  return new EngineError(
    "retry_cap",
    `The ${lane} lane stops advancing: its space's retry set holds ${total} rows, at the cap of ${cap}.`,
    "Finish or expire rows in the retry set (a failed row is retried, a held one waits for the classifier); the lane advances again below the cap.",
  )
}
