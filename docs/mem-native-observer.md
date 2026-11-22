# Private native entered-executor observer

## Status and coverage

This opt-in module observes entered Promise executors. It is **not wired into the runner, guard, or consumers**.
It does not grant permission, change permission checks, or certify all dispatch attempts.
It never emits `oc-mem-invocations/1` or `complete:true`.

The implementation has offline tests at two seams: the supported Promise tool editor/control interface and the version-specific raw decoder.
The new producer has not run in OpenCode. Native integration needs separate authorization and qualification.

- [Observer](../src/run/mem-observer/observer.mjs): installation, invocation snapshots, audit facts, and private scope lifecycle.
- [Raw decoder](../src/run/mem-observer/raw-2.2.6.mjs): explicit OpenCode 2.2.6 CLI fields and original bytes.
- [Projection](../src/run/mem-observer/projection.mjs): entered occurrences and carrier terminals, in separate orders.
- [Offline tests](../test/mem-observer.test.mjs): lifecycle, failure isolation, identity, and control races.

## Producer interface

`createNativeObserver(options)` returns `install`, `ready`, `open`, `seal`, `status`, `invalidate`, and `close`.
Control methods return status snapshots. Control failures latch health errors instead of admitting a new scope.
One instance handles one scope. Create a new instance after revocation or closure.

Required options:

| Option | Contract |
|---|---|
| `version` | Exactly `2.2.6`. |
| `inventory` | Nonempty array of selected tools: `{id,input,options}`. Input schemas and options must be representable JSON values. |
| `journal.append(line)` | Synchronous private append; return `undefined`. Each line includes a sequence and observer ID. |
| `journal.read()` | Synchronous read of that instance's persisted journal; return a `Buffer`. |
| `verifyAuthority(request)` | Trusted capability described below. Required even for a zero-entry scope. |
| `qualifyInventory(observed)` | Trusted native integration qualification described below. |

Optional `readReservation({scope,native,tool})` returns synchronous evidence `{grant_id,reservation_id}`.
Both IDs must be nonempty strings. They remain separate from observer IDs and native carrier IDs.
This capability must read existing authority evidence without reserving, consuming, or granting authority.
An unavailable or malformed reservation invalidates coverage but does not stop the executor.

The journal must be private, initially empty, and exclusive to this observer instance.
The owner supplies storage, access control, durability, capacity limits, and retention policy.
The module starts no process, listener, transport, or filesystem store. It retains scope evidence in memory.

### Installation and readiness

Pass the controlled Promise `tool` domain to `await observer.install(tool)`.
The domain must expose `hook`, `transform`, and `list`, with disposable hook/transform registrations.
The transform captures the current executor **inside** each `editor.update` callback, then replaces only `execute`.
Its wrapper delegates once with the original arguments and context references.

Call `ready()` after installation and final registration, before prompting.
Readiness inspects the actual selected registrations using `tool.list()` and compares their schemas/options with the supplied inventory.
It rejects missing tools, output schemas, and nonfunction executors. It inspects again after asynchronous qualification.

Public inventory inspection cannot prove Promise provenance or final executor ownership.
Therefore `qualifyInventory({inventory,inventoryHash,revision})` must return:

```js
{
  generation: 'trusted-generation',
  inventoryHash,                 // exact inspected inventory hash
  promiseTools: ['mem_recall'],    // exact selected ID set
  auditFirst: true,
  transformsFinal: true,
  textOnly: true,
}
```

These fields are attestations from a trusted integration capability, not configuration booleans supplied by a model.
The integrator must prove Promise origins, audit placement before rejecting hooks, final transform ownership, and supported text outputs.
It must prevent later executor replacement without revocation. Schema equality alone does not prove executor identity.
Until that capability exists and is qualified, readiness is an **unmet integration dependency**.
The offline fake is not that proof.

### Trusted open and seal

`open(proof)` calls `verifyAuthority({action:'open',proof,generation})`.
Only its verified response can establish scope; arbitrary scope-shaped arguments cannot do so.
The response must contain the acknowledged `generation` and this `scope`:

```js
{
  case_id, trial, trial_id, turn,
  activation_id, incarnation, sessionID,
}
```

`trial` and `turn` are positive integers. `incarnation` is a positive integer or nonempty string.
Other identity fields are nonempty strings. The verifier owns activation, native-session, trial, and turn binding.
Native context proves only the session/message/carrier fields available there; it does not independently prove the other scope fields.
Do not overlap activations in one native session. Revoke on authority loss, cancellation, or generation changes.

`seal(proof)` calls `verifyAuthority({action:'seal',proof,scope,generation})`.
The response must repeat the exact scope and generation, with `quiescent:true`.
The trusted owner must establish successful native completion, no outstanding dispatch, and clean audit coverage before attesting quiescence.
No later entry may reuse the scope. Cleanup and zero pending are not quiescence attestations.

Seal also checks actual inventory, pending count, sticky health, and aggregate before/after/executor evidence.
It compares persisted journal bytes with the full expected journal and returns the count and SHA-256.
`health` is returned independently of the journal, so a failed recorder cannot certify itself through its own log.
A storage read proves equality at seal, not permanent durability or cryptographic authenticity.

`status()` returns an owned snapshot, not a live revocable object.
Late entry invalidates current status but cannot mutate an older returned snapshot.
The owner must prevent late work and check live health when consuming a certificate; never treat a detached status object as authority.
`close()` disposes registrations and revokes live status. It does not seal or cancel pending executor work.

## Occurrences, failures, and outputs

Each evaluated invocation allocates an observer occurrence ID in its closure.
Repeated and concurrent calls remain distinct even when inputs and native carriers are identical.
Native `{sessionID,messageID,id}` remains unchanged. Neither `partID` nor an invented inner `callID` replaces occurrence identity.

Audit hooks retain independent before/after facts, including observed native errors.
Multisets compare counts, inputs, and normalized results only to veto scope coverage.
They never pair hooks with individual occurrences. Journal return order can differ from occurrence order.
Execution success is not independent proof of a committed effect; effect evidence remains the existing effect owner's responsibility.

Snapshots accept finite JSON values with plain objects and dense arrays.
They reject accessors, custom prototypes, cycles, symbols, undefined, nonfinite numbers, and negative zero.
They do not call `toJSON`. Unsupported values and recorder failures latch health errors without changing execution outcomes.
The wrapper preserves fulfilled result and rejection identities; its returned Promise object is necessarily new.
Arbitrary Effect values and Effect causes are not supported or qualified.

Text extraction accepts `content:string` or text-only part arrays, joined with newlines as in the pinned runtime.
The codec checks native output against metadata content. It rejects nontext, truncated, or mismatched output instead of stringifying envelopes.
String-to-text-part normalization does not imply whole-envelope byte equality.

Cancellation, missing native after-hooks, foreign sessions, reload, late entry, unsupported output, and ambiguous coverage remain partial.
The observed default legacy schema error reached before/error-after hooks without entering an executor.
Other prevalidation paths and the alternative VM branch remain untested. Exhaustive attempted-call coverage is excluded.

## Raw evidence and private projection

`decodeNativeRaw(buffer,{version:'2.2.6'})` preserves a copy of the exact input bytes and their SHA-256.
It interprets actual `part.id`, `part.partID`, `part.messageID`, and `part.sessionID` fields.
Unknown versions, malformed/truncated data, duplicate carriers, unsupported shapes, and session mismatches yield issues.
No carrier is fabricated for cancellation. A session finish alone does not prove entered-executor coverage.

`projectEnteredScope({observation,raw})` consumes trusted, unmodified observer status and a decoded raw result.
It checks the decoded view against the retained bytes. It does not authenticate observer status or mint authority.
It returns `private-native-entered-projection/1`, with `status:'sealed'` or `'partial'` and explicit issues.
`occurrenceOrder` follows wrapper entry order; `carrierTerminalOrder` follows CLI tool-terminal order.
An outer returned array never creates inner occurrences. Zero-entry projection still requires a matching native session finish.

## Minimal future owner patches — not included

1. In the private plugin installation owner, instantiate this observer behind an explicit opt-in and install it on the supported Promise tool domain.
   Supply exclusive journal I/O and qualified inventory/authority capabilities. Do not expose them as model-callable RPC methods.
2. Around the existing native prompt boundary in `src/run/runner.mjs`, await ready/open before dispatch and seal after trusted completion.
   Map existing `session` to native `sessionID`; add verified trial and incarnation without inferring them from source or call order.
   Invalidate on timeout/cancel/activation loss. Preserve the original client result and cleanup path.
3. In the authority owner beside `src/run/guard/index.ts`, expose verified open/seal and reservation evidence without changing permission decisions or replay deduplication.
   Current mutable active-call state is not sufficient proof for concurrent reservations. Its redesign remains a separate task.
4. In the reviewed consumer owner beside `src/run/mem-turns.mjs`, opt into the explicit decoder/projection and retain original raw bytes plus sticky health.
   Do not translate a private sealed result to existing `/1 complete:true` until the authority and consumer contract is separately validated.

No generic codec, runner, guard, permission/context code, adapter, lock, plan, or frozen artifact changes are included here.

## Fixture provenance and offline checks

[Fixture copies](../test/fixtures/mem-observer-2.2.6/sha256.json) contain synthetic actual-host probe bytes, unchanged except for filenames.
The `.txt` suffix avoids the repository's prohibition on committed `.jsonl` paths.
The retained probe used OpenCode 2.2.6 on Linux ARM64 with a deterministic fake provider, not a model or real Memory deployment.
Source pin: `dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06`.
Executed binary SHA-256: `ce4f5e7502b6e32ccd8b05654410e8e8607b9660737222b0b1279621bcea2b03`.
This identifies provenance, not reproducible binary-to-source equivalence.

Run only these offline checks for this change:

```sh
node --test test/mem-observer*.test.mjs test/docs.test.mjs test/mem-turns.test.mjs
for file in src/run/mem-observer/*.mjs test/mem-observer*.test.mjs test/support/mem-observer.mjs; do node --check "$file"; done
```

The fixtures qualify the earlier seam probe, not this new producer's native integration.
Full-suite tests can start listeners and were not authorized for this task.
