# Silver storage foundation (D2A)

Status: internal storage and offline tests. **D2B adapter and wiring remain pending.**
No production constructor installs `silverIngest`. No request field or environment
variable enables Silver. Existing events and engine backfill do not materialize it.
This module does not write Gold claims, run a model, or change retention consent.
The column layout and DTO remain private to D2B.

## Trusted seam

Every write uses the existing per-space `Handle` inside its synchronous transaction.
There is no separate database. A savepoint protects each storage operation.
The outer page transaction still owns the event, sequence counter, receipt, and source cursor.
An exception rolls them back together. Callbacks must be synchronous.

The constructor-only `openStore({silverIngest})` hook receives:

```js
silverIngest(tx, { identity, event, binding, cursor, nowIso })
```

The hook runs after baseline admission of a new or changed event, before page commit.
Duplicates, removals, and engine backfill do not call it.
The supplied event remains fenced source data. Baseline normalization does not prove source capabilities.
The test supplies a synthetic trusted adapter. This is not a production capability adapter.

D2B must validate source creation, stable identity, revision ordering, scope, consent, suppression, and shorter source limits.
Plugin revision strings, claimed hashes, normalizer versions, and booleans from a request provide no authority.
The existing binding check is necessary, but it is not a replacement consent check.

## Interface and receipts

```js
materializeSilver(tx, {
  identity: { source, account, object },
  evidenceParts: [{ id, text, createdAt }],
  capabilities: { stableParts, creationTime, orderedRevisions, completeSnapshot },
  receipt: { id, sequence, generation },
  now, normalizationPending, retentionPolicy,
}, { eraseDerivative, textDays, maxSpaceBytes })
```

`now` comes from the server clock. Constructor hooks and limit configuration are server/test-only.
The capability fields describe validated source semantics, not permissions.
`createdAt` requires trustworthy source creation semantics and known time precision.
Unknown creation or ordering causes abstention. A kind name never supplies those guarantees.

`receipt.sequence` is the adapter-validated source order, **not** an engine ingest counter.
The store refuses older or conflicting same-order changes. A newer plugin revision string does not establish source order.
`receipt.generation` must equal `generationFence(tx, identity)`.
An epoch read before any pending or ready materialization is not a work lease.

The result has `status`, `evidence`, `coverage`, and a meaningful-parts `fingerprint`.
Statuses are `ready`, `pending`, and `abstain`. Coverage contains typed reasons, never omitted source text.
Reasons include `unknown_age`, `text_expired`, `part_removed`, `stale_revision`, `normalization_pending`, and `comparison_bound`.
A partial ready result does not claim full source coverage.

A receipt ID binds its payload, source order, and retention limit.
An identical retry returns the original receipt without new anchors or longer expiry.
A conflicting retry throws `receipt_conflict`.
The receipt describes its original commit. Consumers must read live evidence again before derivation.
An accepted empty or whitespace-only replacement invalidates the supplied part, including its aliases and derivatives.
The supplied identity comes from the part array, not the list of nonempty spans.
An unavailable eraser refuses the operation and rolls back the cursor, evidence, and epoch.
An accepted clear fences old work before erasure. The receipt returns `generation` and `requestGeneration`.
Its exact retry can replay that self-fenced receipt without another erasure or epoch increment.
A later lifecycle fence still refuses the old receipt. Unaffected independent artifacts remain separate.
Receipt rows expire within 30 days, or earlier with evidence metadata. They disappear on invalidation of their object.

A pending receipt stores no evidence text and exposes no ready evidence.
Completion uses a different receipt ID at the same source order.
Completion requires identical parts, creation proof, capabilities, and retention limit.
The initial observation and source age still bound expiry. Processing time cannot renew it.

## Internal operation handoff

The internal D2B seam separates this invocation from the durable receipt:

```js
materializeSilverOperation(tx, input, options) // same trusted input/options
// {
//   disposition: "accepted" | "replayed" | "refused",
//   result,                 // legacy receipt, or a soft-refusal result
//   generation,             // current partition epoch after this operation
//   before, after,          // null, or { status, fingerprint }
//   changed,                // comparison of these two metadata snapshots only
//   anchoring: { freshEvidenceIds, carriedEvidenceIds }, // this invocation only
// }
```

This is a private storage DTO, not a public wire contract. No production caller or notification hook is installed.
The operation requires the same real transaction and source-validated input as `materializeSilver`.
Disposition comes from authoritative control flow, not from status or evidence count:

| Disposition | Meaning |
|---|---|
| `accepted` | This invocation admitted evidence, a pending observation, or an explicit clear, and wrote its receipt. |
| `replayed` | This invocation returned an exact unexpired receipt after current consent and epoch checks. It admitted no new work. |
| `refused` | This invocation accepted no operation. Its savepoint restored all operation-owned state, including tentative retirement and erasure. |

Hard errors still throw unchanged. Only an invocation-local rollback sentinel becomes a normal soft-refusal result.
The sentinel and disposition never enter a receipt, table, global cache, or post-commit queue.
An error after the operation returns still rolls back the outer transaction. An accepted result is provisional until that transaction commits.
The shared Handle savepoint and outer-transaction helpers also restore the entry value of `erasePending` after successful SQL rollback.
An earlier `true` remains `true`. Successful commits and joined nested transactions retain committed dirty state.
This guarantee covers that erasure flag only, not generic mutable Handle caches.
If SQLite rollback fails, the original error still propagates and the helper does not falsely reset the flag.
Callers must not publish readiness, schedule extraction, or notify another worker before commit.

An accepted clear can have `result.status === "abstain"` and no evidence.
Its durable result preserves `requestGeneration: 0` and `generation: 1`, while the operation reports current `generation: 1`.
An exact retry reports `replayed`, not another accepted clear. A later lifecycle fence still throws `stale_generation`.
Operation replay requires the stored result epoch to equal the current partition epoch and its stored request epoch to equal this request.
Substituting the current epoch in an older request cannot revive its cached receipt, including pending/completion receipts.
Consent checks precede operation replay. The stored fence check precedes expired-receipt soft refusal.
This stricter operation rule changes neither the legacy request digest nor legacy replay behavior.
A pure comparison gap instead reports `refused`. A clear plus comparison gap still throws and requires outer-transaction propagation.
New unknown-age attempts without admitted evidence, a pending observation, or an explicit clear report `refused` without a receipt.

The old `materializeSilver` return and deep-replay contracts remain unchanged, including its historical abstaining-observation receipts.
The new seam deliberately rolls back such unaccepted attempts rather than recording them.
A cached legacy abstaining observation can replay, but it does not become new accepted work.
In the new seam, an expired cached receipt reports payload-free `receipt_expired` refusal, even before maintenance.
It returns neither the expired fingerprint nor historical evidence IDs. This expiry rule also covers a self-fenced clear receipt.

Before/after metadata contains only the current, unremoved object's stored status and unexpired fingerprint, or `null` when unavailable.
Queries use the exact HMAC source/account/object tuple, including identities with colons. They never compare another object or account.
There is no generic metadata reader, history listing, accepted-receipt lookup across objects, or new evidence listing.
Each snapshot has at most two fixed fields. It contains no words, raw source identities, anchors, or evidence arrays.
The existing bounded live-evidence readers remain the only text read seam, with their existing continuation markers and scope checks.

`changed` means only that the two fingerprint/status snapshots differ. It does not describe every SQL change.
A copied paragraph under a renamed part can produce `changed: true` while it keeps its original evidence ID, anchor, and expiry.
A new accepted receipt can produce `changed: false`. Neither value proves newly authored text, semantic novelty, extraction permission, or complete coverage.
A stored `ready` status is also not a current liveness or authorization grant.
Replayed receipt evidence IDs require a fresh scoped live read before derivation, just as with the old seam.

Callers own deterministic receipt IDs and validated source order; this seam does not invent either from timestamps or revisions.
They can compare before/after metadata within the same transaction without private SQL.
Metadata is transaction-local and must not become a new retained fingerprint archive or outlive the existing lifecycle.
The top-level generation is a current fence value, not a work lease. D2B still owns input authorization, source proof, and post-commit coordination.

### Invocation-local anchoring effects

The enumerable `anchoring` field contains only two closed arrays of opaque evidence UUIDs: `freshEvidenceIds` and `carriedEvidenceIds`.
The existing materialization branches populate them, not timestamps, UUID comparisons, incoming revisions, or caller novelty flags.
They classify evidence units, not individual memberships, authors, independent statements, or semantic truth.

| Existing admission branch | Call-local classification |
|---|---|
| Trusted initial creation, verified append, or initial pending completion obtains a first anchor | Fresh |
| Reused, reactivated, or renamed unit keeps its old anchor | Carried |
| New segmentation or substring unit inherits permitted history's anchor | Carried, even with a new UUID |
| Unproven, expired, held, tombstoned, or otherwise rejected unit | Not fresh; unadmitted units enter neither list |

The arrays are deduplicated and disjoint. A unit first anchored in this invocation remains fresh if another supplied part reuses it later in the same call.
The existing 128-span admission limit bounds their combined length at 128. Overflow fails with the existing typed capacity/gap behavior, never a silently truncated list.
Accepted metadata-only reuse can return carried IDs but no fresh IDs. Accepted clears and pending observations with no evidence return two empty lists.
Every replay and soft refusal returns two empty lists. Historical receipt effects cannot become replayed scheduling permission.
Hard errors still throw without an effects DTO, including genuine eraser callback errors.

Fresh and carried timestamps can legitimately be equal at server/source precision. A newly segmented retired fragment can get a new UUID and revision while still carrying its old anchor.
For example, the actual-ingest fixture appends `Violet nebula` after a Quartz prefix in one store and copies that fragment from retired wording in another.
At the same millisecond, the former unit is fresh and the latter is carried; legacy content hashes and other exported metadata can match.
This is a mechanical anchoring distinction, not a general novelty or authorship test.

The field never enters `result`, stored receipt JSON, database rows, a metadata archive, or a global cache.
The raw `materializeSilver` return, digest recipe, retention rules, source-proof requirements, and stored/replayed receipt shape remain unchanged.
No source words, anchors, raw source IDs, accounts, or new provenance association are exposed by this field.

All effects remain provisional until the outer transaction commits. Rollback discards their database basis; this module publishes no work flags or notifications.
After commit, D2B must intersect the fresh IDs with current authorized selected input and scoped live evidence, and recheck current consent and lifecycle generation.
Liveness reads alone do not replace authorization or the generation fence. Expiry, erasure, or a later lifecycle change can invalidate returned IDs.
Effects are not permission, freshness proof, a work lease, semantic truth, or an executable callback. No production adapter or paid runtime is enabled here.

## Reconstructing receipt input

The internal constructor caller can recover one request epoch from an existing receipt:

```js
const generation = resolveSilverRequestGeneration(tx, input, { textDays: 30 })
const operation = materializeSilverOperation(tx, {
  ...input,
  receipt: { id: input.receipt.id, sequence: input.receipt.sequence, generation },
}, options)
```

`input` is the full prospective materialization DTO, but `receipt.generation` is not required or inspected by the resolver.
Resolve and materialize immediately inside the same actual transaction. The operation repeats its exact payload, consent, and fence checks.
This is one bounded read export, not another materialization wrapper or public wire contract.

All three materialization/resolution entry paths share a non-executing data preflight before input destructuring, property reads, or serialization.
The preflight inspects own property descriptors, including nonenumerable extras. It rejects accessors, functions, serializer hooks, symbols, bigint, custom prototypes, proxies, and cycles.
Objects must have `Object.prototype` or a null prototype. Arrays must be dense and have `Array.prototype`.
Arrays admit only own canonical integer indexes within their actual length, plus intrinsic `length`.
Any other own array key is invalid, even when nonenumerable or primitive-valued. Named fields cannot shadow array operations.
Unknown plain-object data fields remain valid and budgeted; this restriction applies only to arrays.
Existing optional `undefined` data remains allowed. Nonfinite numeric values fail with fixed validation codes.
The resolver skips only the exact own `receipt.generation` field, including a hostile getter. Root receipt accessors and aliases do not inherit that exception.
The trusted, data-valued server `options.eraseDerivative` callback is separate from request data. The guard never invokes or serializes it.
Actual eraser exceptions still propagate unchanged, including exceptions with a validation-like code.

Preflight limits are 32 property levels, 4,096 scheduled data values/property slots, and 32,768 UTF-8 primitive/key bytes across request and options.
The evidence-part subtree has a separate 24,000-byte primitive/key budget. Individual strings and keys also cannot exceed 24,000 bytes.
Unknown and nonenumerable fields count. Intrinsic array length and ignored generation payloads do not count as serialized data.
The original 128-part and exact 24,000-byte serialized-part checks remain, after safe preflight.
No JSON serialization or JSON clone serves as preflight; bounded accepted data keeps its original JSON ordering and digest recipe.
Malformed structure fails `invalid_request`; part-byte bounds fail `text_bound`. Existing key, sequence, and retention-limit refusals remain typed.
Proxy detection uses Node's built-in `types.isProxy` before traps. Native own-key enumeration and trusted runtime intrinsics remain outside a JavaScript sandbox guarantee.

The caller's stable logical request key must already bind canonical identity, full validated wire/proof, source order, effective D1 authorization partition, limits, and mapping version.
Memory generation and poll time must not enter that logical key. Identity is not permission.
The resolver shares validation and the exact existing receipt-digest recipe with materialization.
That digest binds the full part array, source sequence, capabilities, normalization-pending state, and `textDays`.
It does not replace the caller's binding of D1 purpose, scope, proof, or mapping version.
`textDays` defaults to 30 and must remain an integer from 1 to 30. Unsupported retention policies still fail.

The only result is a nonnegative request-generation number:

| Existing row | Resolver behavior |
|---|---|
| True exact-key miss | Returns the current partition generation without writing anything |
| Matching, unexpired, current-fence receipt | Returns its stored original request generation |
| Same key with different materialization payload/order/retention limit | Throws `receipt_conflict`, never falls back to a miss |
| Matching receipt from an older lifecycle fence | Throws `stale_generation` |
| Matching expired receipt | Throws `receipt_expired`, even before maintenance |
| Unknown, malformed, oversized, or inconsistent stored receipt | Throws `invalid_receipt`, never returns a guessed generation |

Current binding and plugin consent checks precede the receipt lookup. Paused or unbound sources fail under the existing policy.
The stored result epoch must equal the current fence. Its request/result relationship must match a normal receipt or the supplied accepted clear parts.
Multiple clear parts can advance several epochs. The resolver never guesses `current - 1`.
The stored-fence check precedes expiry refusal. Caller-supplied generation substitutions cannot revive a pre-lifecycle receipt.

For example, a stable one-part clear key stores request 0/result 1. After restart, resolution returns 0 and the operation reports `replayed`.
For three cleared parts, request 0/result 3 also resolves to 0.
After pause/resume, that three-part receipt fails with `stale_generation` at current epoch 5.
If it expires without another lifecycle change, resolution throws `receipt_expired`, not an original epoch or replay payload.

Lookup uses the existing object/receipt primary key and exact HMAC source/account/object tuple, including colon and Unicode identities.
It reads at most one receipt row, never a latest receipt, object history, another account, or a source-proof corpus.
Returned storage fields are bounded: at most 24,000 outcome bytes plus fixed digest/expiry fields.
The indexed query admits digest and expiry only when SQLite reports TEXT storage and complete raw BLOB lengths of exactly 64 and 24 bytes.
Malformed held rows remain held rows; their invalid fields become null projections and fail `invalid_receipt`, never a fresh miss.
Complete digest bytes must be lowercase hexadecimal. Complete expiry bytes must be a canonical 24-character ISO timestamp.
These checks precede payload-conflict comparison. NUL tails, embedded NUL, nontext values, and overflow fail without returning unbounded bytes.
The existing stored-fence check still precedes the expired-receipt refusal. Outcome shape and its 24,000-byte cap remain unchanged.
The resolver validates the current internal receipt shape and source-order/fingerprint consistency before recovering an epoch.
It returns no words, evidence IDs, fingerprint, receipt object, or provenance grant.

On an otherwise empty authorized file, a miss returns 0 without creating a key, protection marker, fence, receipt, or tombstone.
The resolver changes no TTL or dirty flag. It adds no schema, receipt table, RAM association, fingerprint archive, or retained source hash.
Shared Handle helpers remain unchanged by this handoff.

A miss is not a claim that the wire event is new or permitted. Forget, expiry, or erasure can legally remove a receipt.
The existing object order, suppression marks, and source policy can then refuse materialization; the caller must not relabel refusal as replay.
The original input cannot always be recovered after legal erasure. A forged replacement key does not bypass those guards.
Recovered input is not a lease: a lifecycle change between lookup and use invalidates it under the unchanged operation fence check.
Do not persist the resolver result as freshness evidence or use it instead of D2B authorization/source proof.

## Age and bounded comparison

Each unit has an immutable ID, opaque part membership, first-observed anchor, revision, and text expiry.
Source birth and first observation are distinct. Conservative source age can shorten the 30-day window.
Identical wording in the same source/account/object keeps its old anchor, including a renamed part.
Mechanical splitting can inherit a containing permitted span's earlier anchor and expiry, including an inactive span from a retired revision.
`semanticDigest(parts)` includes part identity and canonical text only. It does not redefine the baseline event hash.

The fallback compares all permitted, unexpired text within the same source/account/object, whether active or inactive.
Retirement removes current support, not comparison history. It does not change the original retention deadline.
It carries known wording. **Unmatched changes inside an existing part abstain.**
A changed snapshot or ordinal alone cannot prove that its whole paragraph is new.
D2B still needs a reviewed source/delta adapter for broader revision-delta admission.
New-part birth does not prove new wording in an existing object.
A bounded append can receive a fresh anchor only from a complete, still-live prior snapshot receipt.
The incoming snapshot must preserve that full prefix.
The appended span must contain no lexical word from any permitted retained span, not just the latest snapshot.
This narrow mechanical proof is conservative, not a general semantic novelty judgment.
Copied prefixes retain their original anchors. Unmatched or lexically overlapping additions abstain with `unknown_age`.
After baseline expiry, renamed parts and new part timestamps cannot establish novelty.
Expired or missing history blocks append novelty even before maintenance installs its suppression marks.
Explicit erasure removes comparison text immediately. Its suppression marks also block novelty proof from the remaining snapshot alone.
Mixed copied fragments without a separable known prefix abstain instead of gaining a fresh whole-span anchor.
Day-40 additions to an expired object therefore remain a coverage gap until D2B supplies a reviewed broader proof.
Initial observation of a genuinely new source object retains the separate trusted creation check.
Expired and removed part marks prevent retries from restoring old text under a new creation assertion.

Receipt fields `sequence`, `completeSnapshot`, and `initialPending` describe store-generated proof state.
The last field permits completion only for the initial observation of a previously unseen object.
No input `novel`, `independent`, or `initialPending` assertion grants freshness.
The proof uses only permitted unexpired text and expiring receipts. It never compares another object, account, or private corpus.
No expired-text fingerprint archive, new proof field, or retention extension is added.

Evidence metadata expires with text by default. This implementation rejects every non-null `retentionPolicy` as `retention_adapter_pending`.
It does not activate the target twelve-month metadata policy, even for a version-shaped input.
A future extension requires actual retention consent and a trusted policy adapter.
Opaque suppression marks and membership needed by surviving derivatives serve deletion, not general historical reconstruction.
Expired lineage retains no source wording, semantic digest, title, URL, or raw account/object/part identifier.

## Read and derivative seam

```js
listLiveEvidence(tx, { identity, now, limit = 128, after = null })
readLiveEvidence(tx, { identity, now, ids })
generationFence(tx, identity)
fenceSilver(tx, identity)
addDerivativeEdges(tx, { derivativeId, evidenceIds, identity, generation, now }, limits)
derivativeEvidence(tx, derivativeId)
removeDerivativeEdges(tx, derivativeId)
invalidateSilver(tx, { identity, refs, before, all }, eraseDerivative)
expireSilver(tx, now)
prepareSilverRollback(tx, eraseDerivative)
```

Reads return only live, active evidence from a ready object in the same space and object scope.
The list returns `next` when another bounded page exists. An expired continuation requires a new read.
Each unit includes its ID, opaque part, first revision, text, anchor, and expiry.

The exact edge index has no display-citation truncation.
Canonical object and account identities use tuple-based HMAC keys.
The legacy `evt_` reference remains a lookup alias, not an exact namespace key.
An unqualified alias matching multiple known canonical objects raises `ambiguous_evidence_ref` before erasure or fencing.
This remains true when a colliding object is already removed. The operation reports no successful deletion.
Existing source/account scoping and identity-qualified source removals remain available.
This does not migrate global Bronze event IDs or establish retrospective lineage for unmaterialized legacy data.
The caller must create a derivative and every edge in the same outer transaction.
The real `jobWritePage` test proves that an edge-cap refusal also rolls back the projection.
All referenced evidence must remain live, active, and in the named account partition.

Only existing `records` derivatives are supported. Unknown future artifact kinds cannot register edges without an eraser.
These edges mean **whole-artifact dependency**, not alternative independent support for each sentence.
Invalidation deletes a mixed record even when it has another citation.
A separate record supported only by unaffected evidence survives.
This does not implement Gold claim attribution, edited projections, or recomputation from independent support.
D3 must use the existing claims layer and add those erasure rules before Gold writes.
No full Gold cascade proof follows from these tests.

The eraser must delete the record and its versions synchronously, or throw.
The store verifies their absence before it removes the edges. A no-op acknowledgement cannot unprotect retained content.

## Privacy operations

| Operation | Implemented effect |
|---|---|
| Pause | Retains permitted evidence until expiry. An inactive binding refuses new materialization and edges. |
| Ordinary retention | Deletes expired text, digests, receipts, and unneeded unit rows. Keeps opaque deletion membership for surviving derivatives. Truncates the WAL. |
| Source removal | Fences and invalidates by opaque object identity, even without a Bronze row. |
| Explicit forget | Fences first, erases registered derivatives and selected evidence, and keeps minimal suppression marks. Part aliases cannot bypass the marks. |
| Unbind | Erases the account payload and registered derivatives. Keeps its opaque generation and suppression marks. Truncates the WAL. |
| Account erase | Fences before the yielding claims cascade. Erases personal-space Silver or the identified accounts in a shared space. |
| Space purge | Deletes the SQLite file and its sidecars through the existing purge operation. |

Silver age-scoped forget uses immutable evidence anchors, not the last poll time.
It removes old units without removing an independently new part of the same object.
Unresolved pending/abstain observations lose their receipts and fingerprints conservatively.
The Bronze portion keeps its existing occurrence-time predicate.

Partition epochs persist in the space file. Erasure still runs when no ingest adapter is installed.
Both write seams recheck the confirmed binding and the existing authoritative plugin-consent guard at commit time.
Public plugin lifecycle changes fence affected Silver partitions in the same transaction, including pause and resume.
Neither a source's enabled column nor a pre-pause epoch bypasses a paused consent.
A lifecycle change without an existing Silver partition creates no key, fence, or protection marker.
This lifecycle check does not replace D2B input scope, grant, capability, or source-identity validation.
Restores require the existing account-erasure tombstone procedure.
Backups, external copies, and storage below SQLite retain the existing documented residuals.

## Tables and admission bounds

The seven tables are `silver_objects`, `silver_evidence`, `silver_memberships`,
`silver_edges`, `silver_receipts`, `silver_part_tombstones`, and `silver_fences`.
They share the existing space file, secure-delete pragmas, and transactions.

Admission limits are:

- 128 incoming parts/spans and 24,000 UTF-8 bytes for the serialized part array
- 512 comparison units and 24,000 permitted comparison bytes within one object, including inactive history
- 512 memberships per object and 100,000 units/memberships per space
- 50,000 object marks and 50,000 live receipts per space
- 4,096 edge references per call and 100,000 exact edges per space
- 128 MiB for the whole SQLite file, including other tables and indices.

Only smaller server/test limits are accepted. Capacity errors refuse admission, not old deletion edges.
If retained history exceeds the comparison bound, admission returns `abstain` with `comparison_bound` coverage and no new evidence.
The unit query reads one extra row to detect overflow. It never treats truncated history as proof.
The combined history-and-input unit bound also returns this coverage gap.
These refusals leave prior permitted evidence unchanged. Explicit erasure remains available.
If a request also supplies an empty or whitespace clear, comparison-bound refusal throws `comparison_bound` instead of returning coverage.
The exception rolls back the operation savepoint, including erasure, fencing, and receipt deletion.
The caller must propagate the exception through the outer page transaction to roll back its cursor and other page writes.
No clear is accepted and no clear receipt is written. The same payload and epoch can retry without a stale-generation error.
A pure admission gap still returns the existing `abstain` coverage result.
Accepted clears retain their existing replayable self-fenced receipts. Explicit forget and erasure remain independent of admission bounds.
The file check uses SQLite page allocation. It is not a disk quota for WAL, backups, or transient files.
Fixed fields exclude free-text structure. The design's 1 KiB structural target still needs measured index amplification.
These bounds are not capacity or runtime proofs. Cold-file overhead, large erasures, and admission latency need measurements before enablement.

## Protected rollback

Empty tables keep schema version 7. The first materialization atomically records `silver@1` and protected version `1000007`.
The actual baseline migration refuses that version. A supported build recognizes only its exact marker.
An unknown marker refuses startup and closes its SQLite connection.
No acknowledgement bypass exists. Already open older writers require a drained cell before activation.

Before rollback, drain all writers and workers. Run `prepareSilverRollback` in a current-build transaction with the real record eraser.
The helper refuses an incomplete eraser. It removes every Silver row and key before it restores the baseline version.
After commit, truncate the WAL and close the file before an older writer opens it.
The helper is internal, not a new operator route. This lane changes no deployment.
The existing claims rollback procedure remains separate.

## Offline verification

### Original implementation at `8bbd3ede`

This subsection records historical results before the four review corrections.
It does not describe verification of the corrected implementation.

The focused store suite passes 27 tests without skips.
The initial tracer failed with 0 passes and 1 failure before the module existed.
The startup-refusal tracer then exposed a real handle leak: 21 passes and 1 failure.
The corrected guard closes the refused connection.

The root privacy fixture fills and scans all seven Silver tables as personal data.
Opaque hashes receive no classification exemption.
The first full run found two missing privacy fixtures and two unstable resume hashes from unignored scratch files.
The corrected privacy fixture and an ignored task scratch root resolve those failures.
The root regression subset passes 42 tests.

All full suites use the external coordinator lock, serially:

| Command | Passed | Failed | Skipped |
|---|---:|---:|---:|
| `npm test` | 4223 | 0 | 4 |
| `RECORDS_ENGINE=off npm run test:records` | 1314 | 0 | 9 |
| `RECORDS_ENGINE=ingest npm run test:records` | 1314 | 0 | 9 |
| `RECORDS_ENGINE=shadow npm run test:records` | 1314 | 0 | 9 |
| `RECORDS_ENGINE=off node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |
| `RECORDS_ENGINE=ingest node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |
| `RECORDS_ENGINE=shadow node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |

These are fixture results, not live deployment, model-quality, capacity, or complete Gold-erasure evidence.

### First review corrections at `f0974ffc`

Four separate regression runs reproduced the review findings before their corrections:

| Finding | Red: passed / failed | Green verification |
|---|---:|---|
| New-part birth renewed copied wording | 0 / 3 | 31 focused tests passed |
| Public plugin pause did not fence writes | 1 / 2 | 79 Silver, consent, and account-erasure tests passed |
| Empty and whitespace replacements retained old evidence | 0 / 2 | 36 focused tests passed |
| A legacy reference erased two canonical accounts | 0 / 1 | 37 focused tests passed |

The final focused suite passes 37 tests without skips.
The historical migration test loads the actual `c208a0e8` and `596f7f91` migrators.
Both accept unprotected files and refuse protected zero-claim files, including with the claims rollback acknowledgement enabled.
Both accept the file after the supported Silver scrub.
The erasure test with more than 50 references checks accepted knowledge, versions, outgoing links, FTS, and an independent surviving record.

Two additional offline compatibility probes pass with those 37 tests: 39 passed, zero failed, and zero skipped.
They cover snapshot/install/retarget, cached migrations, UTF-8 and part bounds, file-cap savepoint rollback, and erasure availability.
The external evidence retains the probe script and its output.

The complete corrected matrix ran serially through the external coordinator lock:

| Command | Passed | Failed | Skipped |
|---|---:|---:|---:|
| `npm test` | 4223 | 0 | 4 |
| `RECORDS_ENGINE=off npm run test:records` | 1324 | 0 | 9 |
| `RECORDS_ENGINE=ingest npm run test:records` | 1324 | 0 | 9 |
| `RECORDS_ENGINE=shadow npm run test:records` | 1324 | 0 | 9 |
| `RECORDS_ENGINE=off node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |
| `RECORDS_ENGINE=ingest node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |
| `RECORDS_ENGINE=shadow node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |

`npm run check:docs`, `npm run check:syntax`, and `git diff --check` also pass.
These results describe an inert foundation, not a release or permission to enable it.
D2B still requires reviewed adapters, input authorization, and broader novelty proof.
D3 still requires capacity measurements, runtime approval, and complete Gold attribution and erasure coverage.

### Retired-history privacy correction

The privacy re-review found a residual age-renewal path at `f0974ffc`.
A fragment from an inactive but permitted revision could pass the latest-snapshot append proof.
The real-store regression reproduced its later anchor and readability after the original expiry: zero passed and one failed.
The correction compares all permitted retained text of the same object and preserves its earlier anchors.

The focused suite now passes 50 tests without skips, including all prior 37 tests without weaker assertions.
New cases cover active and inactive excerpts, mixed copied text, expiry before maintenance, purge, erased history, and comparison bounds.
The original positive append tests still pass.
An additional positive case admits a novel append with accounted inactive history, without comparisons across objects or accounts.
The owned copy of the reviewer probes and the prior compatibility probes also pass: 59 total, zero failed, and zero skipped.

The complete matrix ran serially through the external coordinator lock:

| Command | Passed | Failed | Skipped |
|---|---:|---:|---:|
| `npm test` | 4223 | 0 | 4 |
| `RECORDS_ENGINE=off npm run test:records` | 1337 | 0 | 9 |
| `RECORDS_ENGINE=ingest npm run test:records` | 1337 | 0 | 9 |
| `RECORDS_ENGINE=shadow npm run test:records` | 1337 | 0 | 9 |
| `RECORDS_ENGINE=off node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |
| `RECORDS_ENGINE=ingest node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |
| `RECORDS_ENGINE=shadow node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |

Docs, syntax, and whitespace checks pass. The external evidence retains the failing reproductions, self-test, matrix script, and logs.
No retention deadline or structural metadata lifetime changed. Erased and expired text supplies no comparison authority.
This remains an inert foundation. The D2B and D3 gates remain unchanged, including the day-40 novelty coverage gap.

### Clear plus comparison-bound rollback correction

The state delta review found a partial-clear path at `e5b073ef`.
A normal coverage return committed earlier clear mutations without an accepted receipt.
Both byte-cap and unit-cap regressions reproduced the issue before correction: zero passed and two failed.

A comparison-bound refusal with a supplied clear now throws through the operation savepoint and the outer page transaction.
The focused suite passes 52 tests without skips. It preserves all prior 50 tests without weaker assertions.
The new cases compare every Silver row, source cursor, protected version, record, FTS entry, version, and outgoing link before and after refusal.
They also verify an identical retry, a caught operation exception, and explicit erasure above admission caps.
The combined privacy and compatibility self-test passes 61 tests, with zero failures and zero skips.

The complete matrix ran serially through the external coordinator lock:

| Command | Passed | Failed | Skipped |
|---|---:|---:|---:|
| `npm test` | 4223 | 0 | 4 |
| `RECORDS_ENGINE=off npm run test:records` | 1339 | 0 | 9 |
| `RECORDS_ENGINE=ingest npm run test:records` | 1339 | 0 | 9 |
| `RECORDS_ENGINE=shadow npm run test:records` | 1339 | 0 | 9 |
| `RECORDS_ENGINE=off node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |
| `RECORDS_ENGINE=ingest node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |
| `RECORDS_ENGINE=shadow node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |

Docs, syntax, and whitespace checks pass. The external evidence retains both failing reproductions and all verification logs.
No copy-age proof, retention deadline, production wiring, or D2B/D3 gate changed.

### Internal operation handoff verification

The handoff adds 13 operation tests and preserves all 52 legacy tests unchanged: 65 passed, zero failed, and zero skipped.
The author self-test also includes prior STATE, privacy, and compatibility probes: 86 passed, zero failed, and zero skipped.
Red evidence covers the absent export, unknown-age acceptance versus refusal, and expired receipt replay before maintenance.

The complete matrix ran serially through the external coordinator lock on the integrated candidate plus this handoff:

| Command | Passed | Failed | Skipped |
|---|---:|---:|---:|
| `npm test` | 4244 | 0 | 4 |
| `RECORDS_ENGINE=off npm run test:records` | 1428 | 0 | 9 |
| `RECORDS_ENGINE=ingest npm run test:records` | 1428 | 0 | 9 |
| `RECORDS_ENGINE=shadow npm run test:records` | 1428 | 0 | 9 |
| `RECORDS_ENGINE=off node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |
| `RECORDS_ENGINE=ingest node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |
| `RECORDS_ENGINE=shadow node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |

Docs, syntax, copies, and whitespace checks pass. External evidence retains all red/green and full-matrix logs.
Independent STATE and bounded privacy review remain required before D2B resumes. These author checks do not replace that review.

### Operation fence and erasure-flag corrections

The STATE probes reproduced two stale-replay cases and one mutable-flag rollback case before correction: six passed and three failed.
Operation replay now binds both stored epochs, while legacy digest and replay behavior remain unchanged.
The shared Handle helpers restore only `erasePending`, and only after successful SQL rollback.

The focused suite passes 78 tests without skips, including all prior 65 tests unchanged.
New cases cover ready, clear, pending, and completion replay after public pause/resume, including generation-only rebasing and error precedence.
Flag cases cover prior-false/prior-true rollback, caught operation rollback, nested earlier erasure, successful commit, and joined nested writes.
Isolated fault injection verifies original-error propagation and conservative dirtiness when SQL rollback is impossible.
The combined author self-test passes 108 tests, with zero failures and zero skips.

The complete shared-helper matrix ran serially through the external coordinator lock:

| Command | Passed | Failed | Skipped |
|---|---:|---:|---:|
| `npm test` | 4244 | 0 | 4 |
| `RECORDS_ENGINE=off npm run test:records` | 1441 | 0 | 9 |
| `RECORDS_ENGINE=ingest npm run test:records` | 1441 | 0 | 9 |
| `RECORDS_ENGINE=shadow npm run test:records` | 1441 | 0 | 9 |
| `RECORDS_ENGINE=off node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |
| `RECORDS_ENGINE=ingest node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |
| `RECORDS_ENGINE=shadow node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |

Docs, syntax, copies, and whitespace checks pass. The external evidence retains the original failing probes and all verification logs.
Independent STATE and privacy delta review remain required. No D2B resumption or broader mutable-cache guarantee follows from these author checks.

### Receipt reconstruction handoff verification

The resolver adds 17 real-store tests while preserving all prior 78 cases unchanged: 95 passed, zero failed, and zero skipped.
Public-consent fixtures verify close/reopen reconstruction for one-part and three-part clears, ready observations, pending observations, and completion receipts.
Other cases cover fresh-file non-mutation, conflicts, malformed rows, expiry, lifecycle races, exact identity isolation, forget, unbind, and account erasure.
The blocked D2B probe, adapted in owned scratch to a stable key and the resolver, passes without edits to its original evidence.
The combined author self-test passes 126 tests, with zero failures and zero skips.

The complete matrix ran serially through the external coordinator lock:

| Command | Passed | Failed | Skipped |
|---|---:|---:|---:|
| `npm test` | 4244 | 0 | 4 |
| `RECORDS_ENGINE=off npm run test:records` | 1458 | 0 | 9 |
| `RECORDS_ENGINE=ingest npm run test:records` | 1458 | 0 | 9 |
| `RECORDS_ENGINE=shadow npm run test:records` | 1458 | 0 | 9 |
| `RECORDS_ENGINE=off node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |
| `RECORDS_ENGINE=ingest node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |
| `RECORDS_ENGINE=shadow node records/scripts/routines-on-real-store.mjs` | 169 | 0 | 3 |

Docs, syntax, copies, and whitespace checks pass. The shared Handle file is unchanged from the integrated baseline.
Independent STATE and privacy delta review remain required before D2B resumes. No new persistence or provenance authority follows from resolution.

### Resolver data and raw-field correction verification

The correction preserves the preceding 95 focused tests unchanged and adds 33 regressions: 128 passed, zero failed or skipped.
The owned copy of the exact STATE probe first reproduced six failures, then passed all 15 cases after correction.
Accessor and serializer counters stay zero, with unchanged transaction rows and erase flags. Proxy traps and the ignored generation getter also stay uncalled.
Real eraser exceptions retain their identity, including a validation-like code. A bounded plain/null-prototype JSON fixture preserves the legacy digest and replay.
Actual SQLite cases cover NUL tails, canonical-length embedded NUL, overflow, BLOB values, numbers, large prefixes, and canonical positive values for both stored fields.
Malformed field refusals do not mutate tables and remain `invalid_receipt` even when the request payload also differs.

Combined author STATE/compatibility checks pass 174 tests. Owned copies of all preceding privacy probes pass with the focused suite: 154 tests.
These author reruns do not extend the earlier independent privacy verdict to this correction.

The serial coordinator-locked matrix passes: root 4,244 passed/4 skipped; records 1,491 passed/9 skipped in each of off, ingest, and shadow.
Real-store routines pass 169 tests/3 skipped in each mode. All runs have zero failures.
Docs, syntax, copies, and whitespace checks pass. Handle helpers remain unchanged.
Independent STATE and privacy delta review remain required; D2B stays stopped.

### Closed array-shape correction verification

The array correction preserves all 128 preceding focused tests unchanged and adds eight regressions: 136 passed, zero failed or skipped.
Own nonenumerable `some` and `map` primitives now receive `invalid_request` across all three entry paths, before array consumers run.
Named, noncanonical, out-of-range, sparse, accessor, and symbol array cases also fail with fixed codes; dense nested JSON retains its digest and replay.
The exact owned supplemental STATE probe first reproduced all six native errors, then passed all 13 tests without changing its assertions.
Focused plus original resolver, old STATE, and supplemental probes pass 169 tests. Focused plus all prior privacy positives pass 162 tests.
The supplemental depth, slot, byte, ignored-generation, zero-callback/proxy-trap, eraser-identity, indexed-read, and raw-field checks remain passing.

The serial coordinator-locked matrix passes: root 4,244 passed/4 skipped; records 1,499 passed/9 skipped in each engine mode.
Real-store routines pass 169 tests/3 skipped in each mode. All runs have zero failures; docs, syntax, copies, and whitespace checks pass.
No limits, plain-object data admission, digest recipe, Handle helper, storage driver, or retention behavior changed.
Independent STATE and bounded privacy delta review remain required; D2B stays stopped.

### Invocation-local anchoring handoff verification

The handoff adds 11 focused tests: 147 passed, zero failed or skipped.
Exactly four original envelope assertions intentionally add enumerable `anchoring`; every other byte in the original 136-test prefix remains unchanged.
The strict key list stays closed, and the three exact refused-envelope checks add only empty lists. No prior behavior assertion was removed or relaxed.
An owned copy of one prior privacy probe adds that same empty field to its exact expired-refusal expectation; reviewer originals remain unchanged.

The real-ingest history pair passes with actual plugin consent, D1 authorization, immediate resolution/materialization, and equal legacy content-hash bytes.
The reported probe, adapted only to observe and assert the new signal, passes in off, ingest, and shadow modes.
Additional cases cover mixed append/carry, retired substring splitting, reactivation, renamed copies, same-call deduplication, pending completion, partial coverage, replay/refusal, clear/expiry, 128/129-span bounds, tentative erasure rollback, outer rollback, and lifecycle invalidation.
Focused plus original and supplemental STATE probes pass 180 tests. Focused plus prior privacy probes pass 173; 31 earlier compatibility/operation probes also pass.

The final serial coordinator-locked matrix passes: root 4,244 passed/4 skipped; records 1,510 passed/9 skipped in each engine mode.
Real-store routines pass 169 tests/3 skipped in each mode. All final runs have zero failures; docs, syntax, copies, and whitespace checks pass.
The first matrix exposed a test-only binary-hash reference-equality error in ingest mode. Byte-wise equality, as used by the reported probe, corrected that assertion; its failure log is retained.
Earlier red runs, the four-envelope authorization block, and new-fixture setup corrections are retained in author evidence, not presented as passing runs.
No runtime retention, proof, resolver, input-guard, or Handle/driver behavior changed. Independent STATE and bounded privacy review remain required before D2B resumes.
