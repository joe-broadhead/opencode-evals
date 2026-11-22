# Standalone native completion verifier

**Implementation status: offline logical-client tests only. Wire and native qualification are pending.**

The [module](../src/run/native-completion.mjs) observes one runner-controlled serial turn.
It does not submit a prompt, answer permissions, interrupt execution, discover a server, or obtain credentials.
It does not launch a process itself. The caller supplies its existing native CLI launch operation.
No runner, observer, guard, fixture, consumer, CLI, or containment integration is included.

## Source pin and limits of the evidence

The implementation follows OpenCode **2.2.6**, commit
`dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06`, specifically
[packages/cli/src/run/noninteractive.ts](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/cli/src/run/noninteractive.ts).
The retained source file has SHA-256
`771876a072ddbbe878c98c8470e25b030c2b5356123f79e668a2e38c3342bdb8`.

| Source lines | What the source establishes |
| --- | --- |
| 67–76, 217–224 | Event subscription is separate from prompt admission. The prompt admission response supplies creation time, not completion. |
| 71, 173, 217–222 | The CLI supplies its generated message ID to prompt submission and matches it against `data.inboxID` on delivery. |
| 181–207 | Background reads use jobs with `descendants:true`, then session inboxes, then active sessions. |
| 241–254, 309–325 | Wait and stored projection are separate. The first following idle closes this prompt's turn. |
| 328–337 | Execution events have succeeded, failed, or interrupted outcomes. Event-to-message ID conversion uses a schema helper. |
| 340–353 | Message pages contain `data` and `cursor.next`. The first request uses descending order; later requests use the cursor. |
| 457–505 | `step_finish` describes a step, not a prompt outcome. |

The retained source collection does **not** include the generated public client, session-message schema,
event schema, or server OpenAPI. This module has **no HTTP/fetch adapter**.
It does not assert URL paths, HTTP methods, query encoding, auth headers, response wrappers,
or the event-to-message ID transformation. Current documentation is not a pinned wire specification.
The supervision ticket requires `server.connected` readiness.
The retained CLI only waits for the first stream item at lines 68–69.

The decoder validates the logical fields the implementation consumes. It is not a complete native wire decoder.
Tests use synthetic source-shaped values, not recorded native message/event responses.

## Caller interface

```js
import { verifyNativeCompletion } from './src/run/native-completion.mjs';

const provisional = await verifyNativeCompletion({
  client: readOnlyClient,
  binding: {
    caseID, trialID, turnID, activationID, incarnationID, sessionID,
    scope: { complete: true, serial: true, sessionIDs: [sessionID] },
  },
  signal: parentAbortSignal,
  limits: { deadlineMs: 30_000 },
  launch: async ({ binding, signal }) => {
    // Runner-owned operation: retain the exact existing CLI and raw bytes.
    // Return only after that CLI's streams have settled. Honor cancellation.
    const raw = await existingBoundedNativeCLI({ binding, signal });
    return { binding, raw }; // raw is Uint8Array/Buffer, not parsed JSONL
  },
});
```

`launch` is a gate for the runner, not a replacement executor. It runs at most once.
The runner must retain its independent process-exit/stream-close proof. This verifier does not attest CLI exit.
The callback must enforce raw byte bounds while capturing, not allocate unlimited output before returning.
The verifier checks size again and hashes the original bytes without parsing or changing them.
It reads the receipt's `raw` property once. The size check, reported byte count, and digest use that same byte value.
A subarray retains its original offset and length. Its backing buffer is not the capture.
It returns a provisional object, not a file. The caller must persist it only in its private, bounded staging store
with owner-only permissions (for example, directory mode `0700`, file mode `0600`). Do not append it to native JSONL.
The object can contain full prompt/message/error data and must not be published as a public trace.

The binding comes from the trusted runner, never the workload or a discovered “latest” session.
Every identity string is required and limited to 512 characters.
`incarnationID` is the runner's explicit service/trial incarnation, not a guessed PID or native event ID.
The launch receipt must match all six identity fields and the scope.
Invalid configuration rejects before any client operation. Runtime failures return provisional evidence.

`scope.complete` and `scope.serial` are **trusted preconditions**, not facts this module discovers.
The list must contain the root and every existing owned descendant (at most 16 IDs).
The private server must have no competing clients or automation. No new descendants are permitted during the turn.
Unknown/foreign session events, admissions, jobs, inbox entries, or active entries fail the controlled turn.
Jobs are queried with descendant coverage; inboxes are read separately for every inventory entry.
There is no supported complete descendant-inventory method in the retained source.
If the runner cannot supply that inventory and exclusion guarantee, it must not call the launch gate.
An unknown quiet descendant inbox cannot be discovered by this implementation.

### Injectable read/event client

The client exposes only these operations. Their names, principal inputs, and read results follow the pinned CLI source.
The added transport options are this module's adapter contract, **not a claim about generated SDK option types**.
Subscription must return an async iterable synchronously. A Promise-returning subscription is unsupported.
The verifier observes its rejection but does not await or adopt its eventual value as a subscription.

| Operation | Logical result |
| --- | --- |
| `event.subscribe({signal,maxBytes})` | Async iterable of `{type,data,...}`. Its iterator must implement `return()`. |
| `message.list({sessionID,limit:200,order:"desc"}, options)` | `{data:[message,...],cursor:{next:string|null}}` |
| `message.list({sessionID,limit:200,cursor}, options)` | Same page shape. The cursor continues descending order. Missing `next` means end, as in the native CLI. |
| `experimental.session.wait({sessionID}, options)` | Settlement response, retained as evidence. It is not an outcome. Undefined is recorded as null. |
| `experimental.job.list({sessionID,descendants:true}, options)` | Array. Each entry is unexpected work, including foreign work. |
| `session.inbox.list({sessionID}, options)` | Array. Only empty is quiescent. |
| `session.active(undefined, options)` | Object keyed by active session ID. Only an empty object is quiescent. |

`options` is `{signal,maxBytes}`. The adapter must bind an explicit private endpoint and location,
honor abort, bound response bytes **before** decoding, and release its transport when aborted.
It must not convert failures or unsupported endpoints into empty collections.
The stream adapter must not hide disconnects, reconnect/replay, parser loss, queue overflow, or missing event frames.
Its byte/queue bounds must apply for the full subscription, not only each frame.
An adapter is trusted code: this module cannot preempt synchronous blocking code or reclaim a transport that ignores abort.

Abort and iterator return must seal event ingress without discarding buffered or already-yielded frames.
The adapter must expose those frames through ordered `next()` results, followed by `done:true`.
An iterator return result alone does not establish this local fence.
After `next()` returns `done:true`, the adapter must not produce more frames.
If the adapter cannot preserve its buffer, it must report failure rather than successful end-of-stream.
These are logical adapter obligations, not claims about the absent pinned native client implementation.

Message pages require distinct nonempty IDs, a known message type (`user`, `assistant`, or `idle`), and valid cursors.
If a message has a session ID, it must agree with the requested session.
Only the first following idle can supply an outcome, and only `succeeded`, `failed`, or `interrupted` is accepted.
The native terminal event ID is retained unchanged. No guessed ID conversion or event-only outcome fallback is used.
Repeated explicit terminal event IDs invalidate the logical proof. Distinct IDs with the same outcome do not, by themselves, establish replay.

## State transitions and evidence

1. Subscribe and consume an actual `server.connected` event. An iterable is not readiness.
2. On that live stream, page the entire baseline and verify jobs → all owned inboxes → active are empty.
   A delivery, stream loss, or foreign-session event during preflight closes the launch gate.
   An observed execution start outside the dispatch window is also a sticky conflict, for root and inventoried descendants.
   A later empty status snapshot cannot erase that conflict. Execution starts never establish prompt identity.
3. Open the bound window and call `launch` once. Capture exactly one new root-session delivery.
4. After caller settlement, invoke native wait and page the stored projection.
   The baseline must remain its unchanged ID/type suffix. The captured inbox ID must be the sole new user ID,
   outside the baseline, and the oldest new message. Equal text, timestamps, and newest-message matching are never used.
5. Read the first idle in chronological order after that exact user. Retain its ID, outcome, and error.
6. Independently read jobs → all inboxes → active. Unexpected work fails immediately. The verifier does not supervise that work.
7. Close the dispatch window and request transport abort and iterator return.
   Continue the ordered event pump through local end-of-stream, within the shared close grace and existing event/byte limits.
   Join the pump before the verdict. Then recheck all collected admissions and terminal conflicts.

There is no polling loop that submits or retries a prompt. Missing delivery, prompt, or idle remains unknown.
A failed wait does not suppress a separately readable stored failure, but it still blocks logical proof.
Native negatives remain recorded if final quiescence, transport, raw capture, or iterator close fails.
Each complete validated projection page extends a contiguous observed segment.
That segment can establish a separate failed/interrupted native fact for the exact delivered user and its first following idle.
No intervening user or baseline message can belong to that following segment.
If a later older-history read fails, the verifier retains this negative with its explicit prompt and idle IDs.
Full baseline corroboration, admission, and logical proof remain unavailable. Partial history never promotes success or joins an idle across an unseen gap.
Multiple deliveries can invalidate admission after the verifier reads a native outcome.
The native fact stays associated with its explicit observed prompt ID, not a certified caller admission.
Buffered terminal events remain evidence during shutdown. A matching terminal does not become a conflict merely because the pump records it during close.
Contradictory negatives and duplicate deliveries still invalidate the proof. New execution starts during close remain outside-window conflicts.

The return has `phase:"PROVISIONAL"`, `accepted:false`, and `wire.status:"unqualified"` **unconditionally**.
`logicalProof` requires a single corroborated admission, stored success, empty final quiescence, and a known raw digest.
It also requires a connected stream through the read window, successful iterator return, a complete local fence, and no health issue.
It is an offline logical-client result, **not authorization to run or accept a trial**.
`health.close:"closed"` means the iterator returned. It does not prove process/container cleanup or remote billing cancellation.
`health.fence:"complete"` means the pump consumed ordered results through `next()` end-of-stream during close.
It does not prove an empty remote queue, atomic endpoint snapshots, or native transport qualification.
An unresolved `next()` leaves the fence unknown, even if iterator return succeeds.
The close deadline terminates the local pump and records unavailability. A later unresolved result cannot mutate the returned sidecar.
Diagnostic normalization is bounded and tolerates a throwing `error.message` getter without leaking the thrown object.
Pump rejection has an owner from creation. Iterator-return cleanup remains independent of pump settlement.
No observer certificate, cleanup certificate, or usage/cost completeness field is minted.
The observer owner supplies ready/open/seal and the parent supplies cleanup, accounting, and final acceptance elsewhere.

### Bounds

| Limit | Default | Hard maximum |
| --- | ---: | ---: |
| Overall deadline | 30 seconds | 120 seconds |
| Message pages, per baseline/projection | 100 | 100 |
| Items per page | 200 | 200 |
| Events | 10,000 | 10,000 |
| Retained response/event JSON payload bytes | 4 MiB | 4 MiB |
| Raw bytes accepted for digest | 8 MiB | 8 MiB |
| Shared pump-fence and iterator-close grace | 1 second | 1 second |

All configurable limits are positive integers. The caller can lower them but cannot raise the hard maxima.
Repeated cursors and duplicate IDs fail instead of looping. Health holds at most 32 issues of 160 characters each.
Evidence wrapper overhead and copied IDs add a bounded amount above the payload byte budget.
The main deadline races each read and caller operation. The event pump and iterator shutdown share a separate close grace.
The pump retains already-yielded results instead of discarding them when main cancellation starts.
If the event/byte limit prevents a complete fence, the proof is unavailable.
After abort, late operation results cannot change the returned evidence.
The caller still owns cancellation and reclamation of its CLI and any noncompliant adapter resources.

## Required qualification before integration can certify a native turn

A separately authorized, private **pinned 2.2.6** capture must provide:

- OpenAPI/generated-client artifacts with hashes, plus the binary/source identity and location/auth binding contract.
- Event subscription envelopes, actual `server.connected`, disconnect/error/reconnect behavior, byte/queue limits,
  and ordered delivery guarantees. Validate that events cannot be silently lost or delayed past the final read/close fence.
- Lossless buffered-event delivery through abort/return, followed by ordered local end-of-stream. A queue-discarding adapter cannot satisfy the fence contract.
- One CLI-owned prompt's exact delivered inbox ID and stored user ID, including paginated baseline and projection captures.
- Stored succeeded, failed, interrupted, missing-idle, and competing-admission controls, with first-idle ordering across pages.
- Native wait request/response and errors, job descendant filtering, and empty/nonempty/error responses.
- Inbox responses for root/descendants, active-map responses, and ownership inventory guarantees.
- Abort/iterator-close behavior and evidence that no native prompt or permission write came from the verifier.
- Unchanged raw CLI byte digests, observer-owner binding, and parent-owned cleanup/accounting integration evidence.

Live-only events cannot establish a general atomic transaction across independently read endpoints.
The logical proof relies on the controlled serial scope and complete loss-reporting transport.
Without qualified stream ordering and scope guarantees, an apparently successful offline proof remains unqualified.
No current-document URL assumption, guessed codec, synthetic receipt, pending count, stop reason, or exit code closes that gap.

## Offline checks

The [tests](../test/native-completion.test.mjs) use a finite injected event queue and source-shaped responses.
The [boundary tests](../test/native-completion-boundaries.test.mjs) exercise preflight starts and already-yielded or buffered close conflicts.
They also cover explicit terminal replay, single-read raw capture, diagnostic failures, unsupported asynchronous subscription, and contiguous partial-history negatives.
They require no runtime, listener, network, model, provider, auth, install, VM, or container.
Run them with an empty environment and private HOME/TMPDIR/EVALS_STORE:

```sh
env -i HOME="$OWN_HOME" TMPDIR="$OWN_TMP" EVALS_STORE="$OWN_STORE" PATH=/usr/bin:/bin \
  "$PINNED_NODE" --test test/native-completion.test.mjs test/native-completion-boundaries.test.mjs test/docs.test.mjs
```

Do not run the repository-wide suite under a no-listener authorization: other suites exercise local HTTP servers.
