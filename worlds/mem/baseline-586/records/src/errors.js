/**
 * Errors the records service answers with: `{error: {code, message, next}}`.
 *
 * `message` says what went wrong and `next` says what to do about it, both in
 * plain English for an agent to act on (contract §2.2). Extra keys (`current`
 * for a version conflict, `binding` for an unbound source) ride along in the
 * same object.
 */
export class RecordsError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {string} next
   * @param {Record<string, unknown>} [extra]
   */
  constructor(status, code, message, next, extra = {}) {
    super(message)
    this.name = "RecordsError"
    this.status = status
    this.code = code
    this.next = next
    this.extra = extra
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, next: this.next, ...this.extra } }
  }
}

/** 400 with an `invalid_*` code. */
export function invalid(code, message, next, extra) {
  return new RecordsError(400, code.startsWith("invalid_") ? code : `invalid_${code}`, message, next, extra)
}

export function forbidden(message, next = "Ask a space admin for access, or work in a space where you have the role this needs.") {
  return new RecordsError(403, "forbidden", message, next)
}

export function notFound(message, next) {
  return new RecordsError(404, "not_found", message, next)
}

export function conflict(code, message, next, extra) {
  return new RecordsError(409, code, message, next, extra)
}

export function tooLarge(message, next) {
  return new RecordsError(413, "too_large", message, next)
}

export function refused(message, next, extra) {
  return new RecordsError(422, "refused", message, next, extra)
}

/**
 * 403 `page_lines_kept` (FIX-0911): a bearer changing a team-visible page
 * other than by adding lines, revising a page record there, or writing a
 * journal page there. Only the person, in a browser session of Memory's
 * console, edits or removes such lines.
 */
export function pageLinesKept(message, next = "Add lines instead (records.append, or a body that keeps every line in order). The person edits or removes lines in Memory's console.") {
  return new RecordsError(403, "page_lines_kept", message, next)
}

/**
 * SEC-0912: a bearer credential (an API key, a connect token, an agent) in a
 * shared space does not hard-delete a team page or another person's record.
 * The person does it in a browser session of Memory's console.
 */
export function teamDeleteConsoleOnly(message, next = "Retire it with records.revise, or the person deletes it in Memory's console, signed in in a browser.") {
  return new RecordsError(403, "team_delete_console_only", message, next)
}

/**
 * SEC-0912 (F9): a bearer in a shared space does not change who owns a
 * record. Owning a record is what lets its owner's key delete it, so taking
 * one would bypass teamDeleteConsoleOnly.
 */
export function ownerChangeConsoleOnly(message, next = "Leave owner out. The person changes a record's owner in Memory's console, signed in in a browser.") {
  return new RecordsError(403, "owner_change_console_only", message, next)
}

export function unavailable(code, message, next) {
  return new RecordsError(503, code, message, next)
}

// ---------------------------------------------------------------------------
// What an act answers when its grant verified but the change cannot be made
// (#58 section A, and docs/design/adr-verified-caller-grants.md §4.7)

const ACT_REFUSALS = Object.freeze({
  not_pending: [409, "This is not waiting for that decision any more: it was already done, cancelled or closed.", "Read it again and choose the control its current state offers."],
  revision_conflict: [409, "It changed since you saw it, so this decision is about words that are no longer there.", "Read it again, then press again: a new press signs a new grant."],
  needs_approval: [403, "This change reaches a shared space, and a person approves it in Memory's own page, not through this action.", "Open the page in Memory and make the change there, or send it to the agent, which asks you first."],
  not_owner: [403, "This is not yours to change: only its author decides it.", "Ask its author, or make the change where you have the role it needs."],
  space_read_only: [403, "This space is read-only for you.", "Ask a space admin for the editor role, or work in a space where you have it."],
})

/**
 * A coded refusal from an act whose grant verified: the act cannot be applied as
 * the record now stands. Extra keys ride along in the body, as for any error.
 */
export function actRefused(code, extra) {
  const known = ACT_REFUSALS[code]
  if (!known) throw new Error(`actRefused: ${code} is not an act code`)
  const [status, message, next] = known
  return new RecordsError(status, code, message, next, extra)
}

// ---------------------------------------------------------------------------
// Verified-caller grants (docs/design/adr-verified-caller-grants.md §4.9)

/**
 * Every coded answer the grant door gives, in the words §4.9 asks for: what it
 * means, and what the person or the host does about it. The verifier's own
 * `detail` is never sent: a refusal that explains which byte failed tells an
 * attacker which byte to change.
 */
const GRANT_REFUSALS = Object.freeze({
  grant_unavailable: [503, "This space's records service has no action key loaded, so it cannot verify a person's act.", "Ask the operator to install the action key file (RECORDS_ACTION_KEYS_FILE), then act again."],
  grant_keys_stale: [503, "This space's action key file is older than the age its operator allows, so it cannot be trusted to list the hosts in force.", "Ask the operator to check the gateway's action-key puller and RECORDS_ACTION_KEYS_MAX_AGE_HOURS; until the file is fresh, nothing is applied."],
  grant_required: [403, "This act is recorded as the person's only with a grant from their host; this call carried none.", "Decide it in the host's Inbox, where the person's own click is signed. An agent cannot do it."],
  grant_malformed: [400, "The grant is not a well-formed jelly-act+jwt: its size, encoding, header or claim types are wrong.", "Report it to the host's maintainer: a host bug writes the grant, not this call."],
  grant_alg: [403, "The grant's header is not EdDSA with the three members a host writes, or its typ is not the key entry's.", "Report it to the host's maintainer. Only EdDSA over the file's keys is accepted."],
  grant_unknown_key: [403, "The key that signed this grant is not in this space's key file.", "Add the host's new key to the key file. A restored host signs with a new key."],
  grant_signature: [403, "The grant's signature does not verify against the key it names.", "Report it to the host's maintainer; nothing was applied."],
  grant_issuer: [403, "The grant names a host other than the one its key belongs to.", "Report it to the host's maintainer."],
  grant_audience: [403, "The grant's audience is not this package's engine.", "Report it to the host's maintainer: the act was addressed to another service."],
  grant_time: [403, "The grant's lifetime is over 60 seconds, or it was issued in the future.", "Check the host's clock, then act again."],
  grant_expired: [403, "The grant has expired.", "Press again in the host: each press signs a new grant, valid for a minute."],
  grant_action: [403, "The grant is for another act, or that act is not enabled on this service.", "Report it to the host's maintainer; nothing was applied."],
  grant_class: [403, "The grant's route class is weaker than this act needs: an act that cannot be taken back needs an owner device.", "Do it from the owner's device in the host. `view` never authorises an act."],
  grant_input: [403, "The input this call applies is not the input the person's grant covers.", "Press again in the host, and change nothing between the preview and the press."],
  grant_member: [403, "The grant names another member, or it arrived with a credential that is not that member's own.", "Act as the person the grant names, with their own sign-in. An agent credential cannot carry a grant."],
  grant_host: [403, "The grant is another host's, or this call did not come through the host it names.", "Press again in the host this call is made through: a grant is signed by a host's press and spent only through that host, so a call that names no host cannot spend one."],
  grant_scope: [403, "The grant was signed for another space.", "Act in the space the person chose."],
  grant_confirm: [403, "The grant does not carry the confirmation this act needs: the person must have seen what it changes first.", "Press again in the host, which draws the confirmation before it signs."],
  grant_preview: [403, "This act changes only what its preview showed, and this press has no live preview for this person, this input and this host.", "Read the act's preview again in the host, then press the same input within ten minutes."],
  grant_replayed: [409, "This grant was already used; the first use stands.", "Nothing to do. A new press in the host signs a new grant."],
})

/**
 * A coded refusal from the grant door (§4.9). `extra` rides along in the body:
 * a replay carries the first use's receipt when it is the same person's.
 */
export function grantRefused(code, extra) {
  const known = GRANT_REFUSALS[code]
  if (!known) throw new Error(`grantRefused: ${code} is not a grant code`)
  const [status, message, next] = known
  return new RecordsError(status, code, message, next, extra)
}
