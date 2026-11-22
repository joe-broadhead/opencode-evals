/**
 * The action key file (§4.3 of docs/design/adr-verified-caller-grants.md): the
 * hosts' public action keys, read from a file, with no network fetch.
 *
 * The private key never leaves the host. Each entry is the host's public JWK
 * plus the members that bind it: `iss` (the host id a grant must name) and
 * `mbr_iss` (the identity issuer whose subjects the host's `mbr` names).
 *
 * The file is checked at start, on `reload()` (records does that on `SIGHUP`),
 * and on the act path at most once every 10 s, by modification time, size,
 * mode, inode and change time: a file swapped in by `cp -p` keeps the first
 * three, and a revocation must never hide behind that.
 * A file that fails validation is refused whole: the last good set stays in
 * use, the failure is logged, and `problem()` reports it to `space.stats`. A
 * missing file means no grant verifies, which is the documented rollback.
 *
 * An age limit (`maxAgeMs`, off at 0) makes a stale file fail closed: the
 * puller stamps `pulled_at` when it writes, and a verifier that reads an older
 * file refuses every grant (`grant_keys_stale`), so a puller that stopped
 * cannot keep a revoked host's grants alive. A file with no stamp ages from
 * its own modification time.
 *
 * One library, several callers: this file and `action-grant.js` are copied
 * byte-identically where each caller needs them (`npm run check:copies`).
 */
import fs from "node:fs"
import { GRANT_AUDIENCE, parseActionKeys } from "./action-grant.js"

/** How often the file is checked on the act path (§4.3). */
export const CHECK_EVERY_MS = 10_000
/** A stamp further ahead than this is a wrong clock or a forged file, never fresh. */
export const FUTURE_SKEW_MS = 5 * 60 * 1000

/**
 * @param {object} options
 * @param {string | null} [options.file] the key file's path; none means no grant verifies
 * @param {string} [options.audience] this service's audience, for entries without `aud`
 * @param {(line: object) => void} [options.log] one JSON line per change or failure
 * @param {() => number} [options.now] the clock, in milliseconds
 * @param {number} [options.checkEveryMs] how often the file is checked on the act path
 * @param {number} [options.maxAgeMs] the oldest a file may be and still verify; 0 is no limit
 * @param {typeof fs} [options.fileSystem] injection for tests, never a real cache
 */
export function createActionKeys({ file = null, audience = GRANT_AUDIENCE, log = () => {}, now = () => Date.now(), checkEveryMs = CHECK_EVERY_MS, maxAgeMs = 0, fileSystem = fs } = {}) {
  let entries = []
  let problem = file ? "not loaded yet" : "no key file is configured"
  let loadedAt = null
  let checkedAt = 0
  let signature = null
  let pulledAt = null
  let pulledAtIsStamp = false
  let lastReported = null

  /**
   * True when the loaded file is older than `maxAgeMs`, or its `pulled_at`
   * stamp is more than five minutes in the future. A stamp ahead of the clock
   * could otherwise outlive any age limit (a 2099 stamp beats a 30-day mtime),
   * so the future rule holds even with the limit off. It applies to the stamp
   * only: a file with no stamp ages from its mtime, which is whatever the file
   * system says.
   */
  function stale() {
    if (pulledAt === null) return false
    const at = now()
    if (pulledAtIsStamp && pulledAt - at > FUTURE_SKEW_MS) return true
    if (!(maxAgeMs > 0)) return false
    return at - pulledAt > maxAgeMs
  }

  /** The keys loaded now, for a verifier. `stale` fails closed. */
  function current() {
    return { entries, stale: stale() }
  }

  /** True when at least one key is loaded: `space.stats.act_grants`. */
  function available() {
    return entries.length > 0
  }

  /** Why the file was last refused, or null when it was not. */
  function problemNow() {
    return problem
  }

  function report(line) {
    const text = `${line.level}:${line.state}:${line.error ?? ""}`
    if (text === lastReported) return
    lastReported = text
    log({ msg: "action_keys", ...line })
  }

  /**
   * Re-read the file when it changed, or when `force` (a `SIGHUP`). Throttled
   * on the act path: at most one stat every `checkEveryMs`. Never throws.
   */
  function check(force = false) {
    if (!file) return current()
    const at = now()
    if (!force && at - checkedAt < checkEveryMs) return current()
    checkedAt = at
    let stat
    try {
      stat = fileSystem.statSync(file)
    } catch {
      // A missing file is the rollback: no grant verifies.
      if (entries.length > 0) report({ level: "warn", state: "missing", error: "the key file is gone; no grant verifies" })
      entries = []
      signature = null
      pulledAt = null
      pulledAtIsStamp = false
      problem = "the key file is missing"
      return current()
    }
    // The inode and the change time as well as the modification time, the size
    // and the mode: a file replaced by `cp -p` or a restore keeps the mtime and
    // the size, and a revocation must never be hidden that way.
    const stamp = `${stat.mtimeMs}:${stat.size}:${stat.mode}:${stat.ino}:${stat.ctimeMs}`
    if (!force && stamp === signature) return current()
    if ((stat.mode & 0o002) !== 0) {
      // T11: a world-writable key file would let anyone add a host's key.
      problem = "the key file is world-writable"
      report({ level: "error", state: "refused", error: problem })
      return current()
    }
    let text
    try {
      text = fileSystem.readFileSync(file, "utf8")
    } catch (error) {
      problem = `the key file could not be read: ${String(error?.message ?? error).slice(0, 120)}`
      report({ level: "error", state: "refused", error: problem })
      return current()
    }
    const parsed = parseActionKeys(text, { audience })
    if (!parsed.ok) {
      // The whole file is refused: the last good set stays in use.
      problem = parsed.error
      report({ level: "error", state: "refused", error: parsed.error })
      return current()
    }
    entries = parsed.entries
    // The puller's stamp, else the file's own age: a hand-written file ages
    // from when it was last written, never from now.
    pulledAtIsStamp = parsed.pulledAt !== null
    pulledAt = parsed.pulledAt ?? stat.mtimeMs
    signature = stamp
    problem = null
    loadedAt = new Date(at).toISOString()
    report({ level: "info", state: "loaded", keys: entries.length, at: loadedAt })
    return current()
  }

  /** Reload now, whatever the clock says (`SIGHUP`, or an operator's check). */
  function reload() {
    return check(true)
  }

  check(true)
  return { current, available, stale, problem: problemNow, check, reload, file, loadedAt: () => loadedAt }
}
