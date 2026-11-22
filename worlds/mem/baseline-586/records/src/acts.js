/**
 * The acts this records service applies: where a person's click in their host's
 * UI lands (docs/design/adr-verified-caller-grants.md §4.7, `acts.apply`).
 *
 * **This build registers the acts of opencode-mem#58 section A**: the ones
 * records itself applies — a commitment's five controls, a review decision, a
 * page write, a saved line (`memory.saveLine`), a held write's edit or privacy,
 * and the erasure receipt — and the space and sharing acts (A2–A9 and A11) whose change is made through the
 * control plane and the records service, each of which **reserves** the grant
 * here and is settled by the plugin (`settle`, below). It still runs dark: a
 * name applies only when the operator lists it in `RECORDS_ACTIONS_ENABLED`,
 * which is empty by default, so every act answers `grant_action` and changes
 * nothing. The plugin's `actions` declaration is behind its own switch
 * (`actions`), and both are off in 0.10 until Jelly settles the eight
 * confirmations the ADR's §7 lists, so no host draws a control that would
 * change anything.
 *
 * An entry, as `registerAct` takes it:
 *
 *   minClass  the weakest route class that may authorise it: `"chat"`, or
 *             `"local"` for an act that cannot be taken back (§4.7). Nothing
 *             else, and no default: an unknown class fails closed.
 *   confirm   the confirmation the host must have drawn: `"always"` is
 *             required of the grant's `cfm` when the act changes or removes
 *             something that cannot be put back (Jelly's answer 7).
 *   scope     which store may spend the grant (§4.7, step 12):
 *             `"personal"` — the caller's own personal space, as its owner
 *             (`commitment.*`, `review.decide`, `write.decide`,
 *             `profile.erase`); or `"space"` — the store the input names
 *             (`page.write`), and, for an act that names no store at all (a
 *             new space, a handover, a join), the caller's own personal one.
 *             Anything else is `grant_scope`.
 *   store     where in the input that store is named, when it is not `space`:
 *             a dot path such as `"from.space"` (`page.copy`) or
 *             `"target.space"` (`share.*`), `"space"` by default, or `null` for
 *             an act whose `space` names something to act on rather than the
 *             store to spend the grant in (`space.join` asks to join a space the
 *             caller is not in). The input's `space` is the fallback for a path
 *             that names nothing.
 *   settle    the terminal states `acts.settle` may give the reservation, for
 *             an act whose change spans services (`profile.erase`:
 *             `["erased", "refused"]`; A2–A9 and A11: `["applied",
 *             "refused"]`). An act without it is applied inside this service
 *             and is never settled.
 *   stateBound true for an act whose press is bound to state a preview showed
 *             and a page never sends back — a copy's page version and the file
 *             it lands at, a space change's state digest. Its preview records
 *             what it showed (`acts.preview`, `store.recordPreview`), and the
 *             press spends that snapshot once, in the grant's own transaction,
 *             which answers it to the plugin (`applyGrant`).
 *   inputKeys each of the act's closed input keys and its JSON type
 *             (`{revision: "integer", itemId: "string"}`). A key present in the
 *             input must have that type; which keys must be present is `run`'s
 *             business, because some are conditional. The host's own keys
 *             (`jellySpeaker`) come from the key entry's `extra_input`.
 *   run       applies the act inside the grant's transaction and answers its
 *             receipt. **It must be synchronous**: it runs in the same SQLite
 *             transaction as the ledger row (`handle.tx`), and the row is
 *             rolled back with it. A `run` that returns a promise is refused
 *             and the transaction rolls back, because the row would otherwise
 *             commit before the act's work finished. It receives
 *             `{store, handle, actor, input, claims, entry, now}`, writes
 *             through `handle`, and returns the receipt the person sees.
 *
 * **History.** Every record an act changes carries `via: "grant"` with `host`,
 * `device`, `class` and `jti` from the claims (§4.8), so a record's history says
 * "by you, in <host>" and never looks like a tool's write. The store's act
 * methods do that; a new act that writes through `store` inherits it.
 *
 * **Adding an act** (the lane that builds A3–A8 and A11, and every later one):
 * one `registerAct` call here, one synchronous store method that writes the
 * change, and a plugin action of the same name in `src/actions.js`. The scope
 * and the class are the whole of the server's frame; nothing else has to learn
 * the act.
 */
import { GRANT_CLASSES, INPUT_TYPES } from "./action-grant.js"

/**
 * An act's declared name: `service.act` or `service.family.act`, such as
 * `inbox.decide` or `space.joinRequest.decide`.
 */
export const ACT_NAME = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,2}$/
/** The stores an act may be spent in (§4.7 step 12). */
export const ACT_SCOPES = Object.freeze(["personal", "space"])
/** The confirmation an act's host must have drawn before it signs (Jelly's answer 7). */
export const ACT_CONFIRMS = Object.freeze(["never", "session", "always"])
/** A dot path into an act's input, naming the store the grant is spent in. */
const STORE_PATH = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*){0,3}$/

/**
 * Check one act declaration, and answer it. Registration and start-up both use
 * this, so a declaration a grant could never meet — an unknown class, an
 * unknown scope, an unknown input type, an asynchronous `run` — cannot enter the
 * service and fail open later.
 *
 * @param {string} name
 * @param {{ minClass?: string, scope?: string, inputKeys?: Record<string, string>, run?: Function }} definition
 */
export function assertAct(name, definition) {
  if (typeof name !== "string" || !ACT_NAME.test(name)) throw new Error(`an act name is service.act (such as inbox.decide); got ${JSON.stringify(name)}`)
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error(`the act ${name} is not an object`)
  if (typeof definition.minClass !== "string" || !Object.hasOwn(GRANT_CLASSES, definition.minClass)) {
    throw new Error(`the act ${name} declares minClass ${JSON.stringify(definition.minClass)}; a grant can meet only ${Object.keys(GRANT_CLASSES).join(" or ")}`)
  }
  if (!ACT_SCOPES.includes(definition.scope)) {
    throw new Error(`the act ${name} declares scope ${JSON.stringify(definition.scope)}; an act is spent in ${ACT_SCOPES.join(" or ")}`)
  }
  if (!ACT_CONFIRMS.includes(definition.confirm)) {
    throw new Error(`the act ${name} declares confirm ${JSON.stringify(definition.confirm)}; it is ${ACT_CONFIRMS.join(", ")}`)
  }
  if (definition.control !== undefined && typeof definition.control !== "boolean") {
    throw new Error(`the act ${name} declares control ${JSON.stringify(definition.control)}; it is true for an act whose change lands at the control plane`)
  }
  if (definition.stateBound !== undefined && typeof definition.stateBound !== "boolean") {
    throw new Error(`the act ${name} declares stateBound ${JSON.stringify(definition.stateBound)}; it is true for an act whose press is bound to state a preview showed`)
  }
  if (definition.previewRequired !== undefined && typeof definition.previewRequired !== "boolean") {
    throw new Error(`the act ${name} declares previewRequired ${JSON.stringify(definition.previewRequired)}; it is true for an act a press may take only from a live preview`)
  }
  if (definition.store !== undefined && definition.store !== null && (typeof definition.store !== "string" || !STORE_PATH.test(definition.store))) {
    throw new Error(`the act ${name} declares store ${JSON.stringify(definition.store)}; it is a dot path into the input (such as "from.space"), or null`)
  }
  if (definition.settle !== undefined) {
    if (!Array.isArray(definition.settle) || definition.settle.length === 0) throw new Error(`the act ${name} declares settle ${JSON.stringify(definition.settle)}; it is the terminal states, such as ["applied", "refused"]`)
    for (const state of definition.settle) {
      if (typeof state !== "string" || !/^[a-z][a-z_]{0,39}$/.test(state)) throw new Error(`the act ${name} declares settle state ${JSON.stringify(state)}; a state is lower case, at most 40 characters`)
    }
  }
  const inputKeys = definition.inputKeys ?? {}
  if (!inputKeys || typeof inputKeys !== "object" || Array.isArray(inputKeys)) throw new Error(`the act ${name}'s inputKeys is {key: type}, such as {revision: "integer"}`)
  for (const [key, type] of Object.entries(inputKeys)) {
    if (!INPUT_TYPES.includes(type)) throw new Error(`the act ${name} declares ${key} as ${JSON.stringify(type)}; the types are ${INPUT_TYPES.join(", ")}`)
  }
  if (typeof definition.run !== "function") throw new Error(`the act ${name}'s run is a function`)
  if (definition.run.constructor?.name === "AsyncFunction") throw new Error(`the act ${name}'s run must be synchronous: it runs inside the grant's transaction`)
  return definition
}

/**
 * Add one act to a registry, checking it first.
 *
 * @param {Map<string, object>} acts
 * @returns {Map<string, object>} the same map
 */
export function registerAct(acts, name, definition) {
  if (!(acts instanceof Map)) throw new TypeError("registerAct: a Map of acts is required")
  if (acts.has(name)) throw new Error(`the act ${name} is already registered`)
  acts.set(name, assertAct(name, definition))
  return acts
}

/**
 * The acts whose change is made outside this service (A2–A9, A11): each one
 * reserves the grant here and is settled by the plugin once the operation has
 * run. `store` is where the input names the store the grant is spent in; both
 * `share.revoke` and `page.copy` may name it without `space` (a target's own
 * space), so the path carries it.
 *
 * @type {Array<[string, { minClass: string, confirm: string, scope: string, store?: string | null, settle?: string[], inputKeys: Record<string, string> }]>}
 */
const RESERVED_ACTS = [
  // A6: taking back someone else's access cannot be put back by the person
  // whose device pressed, so it is an owner device's, always confirmed.
  ["share.revoke", { minClass: "local", confirm: "always", scope: "space", store: "target.space", inputKeys: { space: "string", target: "object", person: "string" } }],
  // A6: a grant is spent in the store its target names.
  ["share.grant", { minClass: "chat", confirm: "always", scope: "space", store: "target.space", inputKeys: { space: "string", target: "object", person: "string", access: "string" } }],
  // A7: a handover changes who owns a space or a page, which its owner's device
  // asks for and the other person answers. The request names a store; both
  // answers name only the request, so they are spent in the person's own.
  // A handover is G2-P and its change lands at the control plane, so its
  // reservation answers a proof control verifies and spends (p2-control.md):
  // `control: true`. The two answers are person-only too, and they name a
  // request rather than a store.
  ["share.transfer", { minClass: "local", confirm: "always", scope: "space", store: "target.space", control: true, inputKeys: { space: "string", target: "object", to: "string" } }],
  // One handover answer, accept or decline: `op` is the discriminator, so a
  // family Jelly binds by no name costs one act instead of two.
  ["share.decide", { minClass: "chat", confirm: "never", scope: "space", store: null, control: true, inputKeys: { op: "string", requestId: "string", note: "string" } }],
  // A2–A4: a page's words, its path, and the two acts that remove a page or a
  // whole wiki. Each is spent in the store its `space` names; a page or a wiki
  // cannot be put back by the person whose device pressed, so the two deletes
  // are an owner device's, always confirmed.
  ["page.save", { minClass: "chat", confirm: "always", scope: "space", inputKeys: { space: "string", path: "string", folder: "string", title: "string", body: "string", meeting: "object", transcript: "string", files: "array" } }],
  // A move across spaces copies first and removes the original second, so it can
  // end `partial`: the copy is there, and the receipt says so with its id. One
  // name moves one page (`path`), a folder (`prefix`) or up to 50 pages
  // (`paths`): one consequence, so one act.
  ["page.move", { minClass: "chat", confirm: "always", scope: "space", settle: ["applied", "refused", "partial"], inputKeys: { space: "string", path: "string", prefix: "string", paths: "array", to: "object" } }],
  ["page.delete", { minClass: "local", confirm: "always", scope: "space", inputKeys: { space: "string", path: "string", paths: "array" } }],
  ["wiki.delete", { minClass: "local", confirm: "always", scope: "space", inputKeys: { space: "string", wiki: "string" } }],
  // A5: a new space does not exist yet, so the grant is spent in the person's
  // own store. It names members, who gain access at once, so it is always
  // confirmed: `reserveAct` refuses a weaker `cfm` for one that does.
  ["space.create", { minClass: "chat", confirm: "always", scope: "space", store: null, inputKeys: { name: "string", kind: "string", visibility: "string", members: "array" } }],
  // A9: a proposal is created in, and decided in, the space it names.
  ["proposal.create", { minClass: "chat", confirm: "session", scope: "space", inputKeys: { space: "string", path: "string", wiki: "string", parent: "string", title: "string", body: "string", note: "string", baseVersion: "integer" } }],
  ["proposal.decide", { minClass: "chat", confirm: "always", scope: "space", inputKeys: { space: "string", id: "string", op: "string", edits: "string", note: "string" } }],
  // A11: joining an open space, or asking to join one that is not. `op` picks
  // which; `space` is the space to join, not the store the grant is spent in
  // (the person is not in it yet), so the act is spent in their own.
  ["space.join", { minClass: "chat", confirm: "never", scope: "space", store: null, inputKeys: { space: "string", op: "string", note: "string" } }],
  // A11: a join request names a request, not a store: it is spent in the
  // person's own, as the answer to a handover is.
  ["space.joinRequest.decide", { minClass: "chat", confirm: "always", scope: "space", store: null, inputKeys: { requestId: "string", decision: "string", note: "string" } }],
  // A11: who can find or join a space disposes of other people's access, so it
  // is an owner device's act, always confirmed.
  ["space.visibility", { minClass: "local", confirm: "always", scope: "space", control: true, inputKeys: { space: "string", visibility: "string" } }],
  // A11's lifecycle: renaming, archiving, unarchiving and leaving a space. One
  // name, four ops: all four change the same space's place in the person's
  // catalogue, and the preview names the op. G2-P, so `control: true`.
  // Leaving cannot be undone, so the whole act is an owner device's (`local`),
  // and rename, archive and unarchive are safe at that class. Control's G2
  // changes are committed at the state the person was shown (`expectedDigest`),
  // which a host's press never sends: the preview's snapshot supplies it
  // (`stateBound`).
  ["space.manage", { minClass: "local", confirm: "always", scope: "space", control: true, stateBound: true, inputKeys: { space: "string", op: "string", name: "string", expectedDigest: "string" } }],
  // A8: a copy reads one store and writes another; the grant is spent in the
  // one it copies from. One name copies a page or the person's own memories.
  // `version` is the page's version the preview showed, and `to` names the wiki
  // (with the exact file) or the folder a page copy lands in. A host's press
  // sends neither: its page was shown them, so the preview's snapshot supplies
  // them (`stateBound`).
  ["share.copy", { minClass: "chat", confirm: "always", scope: "space", store: "from.space", stateBound: true, inputKeys: { op: "string", from: "object", to: "object", ids: "array", version: "integer", note: "string" } }],
  // A memory organiser: retiring, restoring or confirming memories, each
  // reversible by another op in the same act. A move is not here: it changes who
  // can see a memory, so it needs its own action (#59 §4.5).
  ["memory.organise", { minClass: "chat", confirm: "always", scope: "space", inputKeys: { space: "string", op: "string", ids: "array" } }],
  // A commitment between spaces: a copy into the target, read back, then the
  // source removed (the console's own move), so it can end `partial`.
  ["commitment.move", { minClass: "chat", confirm: "always", scope: "space", settle: ["applied", "refused", "partial"], inputKeys: { space: "string", id: "string", what: "string", revision: "integer", to: "object" } }],
]

/**
 * The acts this build applies. Each name is also the plugin's action name, so a
 * grant's `act`, the action Jelly drew and the record's history agree.
 *
 * @returns {Map<string, object>} the acts, dark until `RECORDS_ACTIONS_ENABLED`
 */
export function createActs() {
  const acts = new Map()
  // A13: a commitment's five controls (#58 A13, #55 item 1). Its own private
  // memory, so `chat`, and no preview: nothing beyond the person's space changes.
  for (const op of ["done", "cancel", "reopen", "snooze", "edit"]) {
    registerAct(acts, `commitment.${op}`, {
      minClass: "chat",
      confirm: "never",
      scope: "personal",
      inputKeys: { id: "string", space: "string", revision: "integer", ...(op === "snooze" ? { due: "string" } : {}), ...(op === "edit" ? { what: "string", due: "string" } : {}) },
      run: (context) => context.store.applyActCommitment({ ...context, op }),
    })
  }
  // A13's two more: adding a commitment, and deleting one. Add is a change to
  // the person's own private memory (`chat`, never confirmed); a delete cannot
  // be put back, so it is an owner device's, always confirmed.
  registerAct(acts, "commitment.create", {
    minClass: "chat",
    confirm: "never",
    scope: "personal",
    inputKeys: { space: "string", what: "string", due: "string" },
    run: (context) => context.store.applyActCommitmentCreate({ ...context }),
  })
  registerAct(acts, "commitment.delete", {
    minClass: "local",
    confirm: "always",
    scope: "personal",
    inputKeys: { id: "string", space: "string", what: "string", revision: "integer" },
    run: (context) => context.store.applyActCommitmentDelete({ ...context }),
  })
  // A10 and A15: one decision on a held or proposed record, whichever kind it
  // is. `op` is the discriminator, so the two families cost two names instead of
  // eight under Jelly's 32-action cap.
  registerAct(acts, "review.decide", {
    minClass: "chat",
    confirm: "always",
    scope: "personal",
    inputKeys: { op: "string", id: "string", revision: "integer", text: "string" },
    run: (context) => context.store.applyActReview({ ...context }),
  })
  // A memory a person keeps, corrects or forgets (Jelly's answer 5): the class
  // is per action, so `forget` is its own act — an owner device only, always
  // confirmed — and `revise` (confirm, correct) is a chat one.
  registerAct(acts, "memory.revise", {
    minClass: "chat",
    confirm: "session",
    scope: "space",
    inputKeys: { space: "string", id: "string", revision: "integer", action: "string", content: "string" },
    run: (context) => context.store.applyActMemoryRevise({ ...context }),
  })
  registerAct(acts, "memory.forget", {
    minClass: "local",
    confirm: "always",
    scope: "personal",
    inputKeys: { id: "string", revision: "integer" },
    run: (context) => context.store.applyActMemoryForget({ ...context }),
  })
  // #58 A14 (jelly's "Save to Memory" on a Messages line): one line kept as a
  // memory, in the space the press names (the person's own when it names none)
  // and cited to it. Adding to the person's own memory is a `chat` act with no
  // confirmation beyond the click on the line; a shared space is held to the
  // person's own role there, and a reader is refused.
  registerAct(acts, "memory.saveLine", {
    minClass: "chat",
    confirm: "never",
    scope: "space",
    inputKeys: { text: "string", from: "object", space: "string" },
    run: (context) => context.store.applyActSaveLine({ ...context }),
  })
  // The Inbox's own decision (the ADR's `inbox.decide`, Jelly's answers 2 and
  // 6): Memory's key for the item, and the version the Inbox showed. It routes
  // to the same review and held-write decisions as `review.decide`, and its
  // refusals carry the item's current state so the host can say "already done".
  registerAct(acts, "inbox.decide", {
    minClass: "chat",
    confirm: "always",
    scope: "personal",
    inputKeys: { itemId: "string", decision: "string", revision: "integer" },
    run: (context) => context.store.applyActInboxDecide({ ...context }),
  })
  // A1: a page's words, at the version the person saw. A team space needs the
  // approval the person's own page draws, so this act answers `needs_approval`
  // there and writes nothing (#58 A1).
  registerAct(acts, "page.write", {
    minClass: "chat",
    confirm: "always",
    scope: "space",
    inputKeys: { space: "string", path: "string", body: "string", expectVersion: "integer" },
    run: (context) => context.store.applyActPageWrite({ ...context }),
  })
  // A15: a held team write, edited or turned private by its author.
  registerAct(acts, "write.decide", {
    minClass: "chat",
    confirm: "always",
    scope: "personal",
    inputKeys: { op: "string", id: "string", revision: "integer", text: "string" },
    run: (context) => context.store.applyActHeldWrite({ ...context }),
  })
  // #78 (Jelly's Proposals): a held team write's one decision — accept, edit or
  // drop — bound to the version its preview showed. `op` is the discriminator,
  // so one name covers the three, as `proposal.decide` does for a proposal.
  // `accept` answers `accepting`; the plugin completes the shared write, the one
  // way held writes are completed (src/tools/held-write.js).
  registerAct(acts, "held.decide", {
    minClass: "chat",
    confirm: "always",
    scope: "personal",
    stateBound: true,
    previewRequired: true,
    inputKeys: { id: "string", op: "string", edits: "string", revision: "integer" },
    run: (context) => context.store.applyActHeldDecide({ ...context }),
  })
  // #77 (Jelly's suggestion card): "Not now" hides one suggestion from
  // `mem.suggestions` without deciding it. It touches only the person's own
  // space, but its press is bound to what its preview showed, so the host draws
  // that confirmation first (Jelly shows a preview on an `always`). `forever`
  // also stops that kind being suggested in this space.
  registerAct(acts, "suggestion.dismiss", {
    minClass: "chat",
    confirm: "always",
    scope: "personal",
    stateBound: true,
    previewRequired: true,
    inputKeys: { id: "string", forever: "boolean", revision: "integer" },
    run: (context) => context.store.applyActSuggestionDismiss({ ...context }),
  })
  // A12: the erasure receipt. `local`: it cannot be taken back (§4.7). The
  // profile itself lives in the memory core, so records spends the grant and
  // keeps the receipt; the plugin does the erase and refuses a profile that
  // changed since the person saw it (`revision_conflict`).
  registerAct(acts, "profile.erase", {
    minClass: "local",
    confirm: "always",
    scope: "personal",
    inputKeys: { phrase: "string", snapshot: "string" },
    settle: ["erased", "refused"],
    run: (context) => context.store.applyActProfileErase({ ...context }),
  })
  // A2–A9 and A11: the space and sharing acts (`src/ops`). Their change is made
  // through the control plane and the records service, which decide access, so
  // this service **reserves** the grant here — verified, bound, spent once, with
  // its audit row — the plugin runs the operation as the person, and
  // `acts.settle` makes the receipt terminal. A reservation nothing settles is
  // marked `unrecorded` past the grant's window.
  for (const [name, definition] of RESERVED_ACTS) {
    registerAct(acts, name, { ...definition, settle: definition.settle ?? ["applied", "refused"], run: (context) => context.store.reserveAct({ ...context, act: name }) })
  }
  return acts
}

/**
 * The act names this build registers, in registration order: exactly what
 * `RECORDS_ACTIONS_ENABLED` may name. The setting is checked against this, not
 * against the shape of a name, because a name is `service.act` or
 * `service.family.act` (`space.joinRequest.decide`) and only this registry knows
 * which acts exist: a pattern refused a registered act with three segments, and
 * an operator could not enable one (#127).
 *
 * @returns {string[]}
 */
export function registeredActNames() {
  return [...createActs().keys()]
}
