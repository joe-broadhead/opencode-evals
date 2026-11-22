# Bounded completion reads

[The module](../src/run/native-completion-http.mjs) implements six reads for the
[unchanged verifier](native-completion.md). It does not qualify a native transport.
The native gate remains false. Offline byte-stream tests do not change that gate.

The source contract is OpenCode 2.2.6, commit
`dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06`.
The consumer baseline is `642cb99fd2b242ec7e687eec02e8412432034390`.
No runner, launcher, verifier, or containment interface changes here.

## Factory and launcher capability

```js
const client = makeCompletionReadClient({
  endpointLease, binding, fetchImpl, transportOwner,
});
```

All four arguments are required. The launcher supplies the endpoint lease through
a private reference, not user input. The factory captures its values once.
The signal remains live. Later mutations of the lease cannot redirect a request.

| Lease field | Required value |
| --- | --- |
| `origin` | Literal `http://127.0.0.1:<port>`, port 1–65535, no trailing slash |
| `authorization` | Canonical Basic header for `opencode:<nonempty password>`, at most 4096 characters, no control bytes |
| `sessionIDs` | Unique array of 1–16 nonempty IDs, at most 512 characters each |
| `incarnationID` | Exact equality with `binding.incarnationID` |
| `signal` | Launcher-owned `AbortSignal` for live revocation |
| `limits` | Optional reductions of the ceilings in the limits table |

IDs must permit URI encoding. A path ID cannot be `.` or `..`.
The lease inventory must equal `binding.scope.sessionIDs`, without duplicates.
The inventory must include `binding.sessionID`.
The binding must declare `scope.complete:true` and `scope.serial:true`.
These fields describe caller preconditions. They do not prove containment or ownership.

The launcher owns namespace provenance, source pin, process identity, credentials,
session receipts, and the fixed descendant inventory. This module performs no discovery.
Host loopback is not sufficient containment. The launcher must supply the approved private namespace.
No local boolean can certify that namespace.

`fetchImpl(url, init)` is required. There is no fallback to global fetch.
It must use the task-owned transport, without hidden retries or redirects.
The adapter sends only `Authorization` and `Accept` headers.
Every request uses `redirect:'error'` and `credentials:'omit'`.
Credentials never enter a URL, query, body, or diagnostic.
The lease and caller signals are checked synchronously immediately before each fetch.

### Exact transport ownership interface

```js
transportOwner.track({ abort, settled }) // synchronous; returns release()
```

`track` registers one exact request handle before dispatch.
Its synchronous `release` callback unregisters that handle after successful transport cleanup.
Both callbacks belong to the trusted launcher and must not throw or return promises.
`abort()` revokes this request only. It never interrupts native session execution.
`settled` resolves to `{released:true}` after actual cleanup succeeds.
It resolves to `{released:false}` when cancellation or lock release fails.
The owner must retain a failed handle for explicit containment cleanup.
An unresolved request keeps `settled` pending and stays registered.

A close timeout fails the public operation but does not fabricate resource settlement.
Late fetch completion still cancels the body and releases the reader.
It cannot add evidence after the timeout.
The handle unregisters only if that late cleanup succeeds.
The owner separately closes its private dispatcher or connection pool after all users finish.
The adapter never terminates a global pool.

## Six logical methods

Options are only `{signal?, maxBytes?}`. Unknown fields are errors.
Options occupy the second argument except for `event.subscribe`.
The object has no creation, prompt, permission, interruption, or discovery methods.

| Logical call | Exact request | Return |
| --- | --- | --- |
| `event.subscribe(options)` | `GET /api/event` | Synchronous single-consumer iterator |
| `message.list({sessionID,limit:200,order:'desc'}, options)` | `GET /api/session/S/message?limit=200&order=desc` | Original `{data,cursor}` page |
| `message.list({sessionID,limit:200,cursor}, options)` | Same path with `limit=200&cursor=...` | Original page |
| `experimental.session.wait({sessionID}, options)` | `POST /api/experimental/session/S/wait` | `undefined` |
| `experimental.job.list({sessionID,descendants:true}, options)` | `GET /api/experimental/job?sessionID=...&descendants=true` | One unwrapped data array |
| `session.inbox.list({sessionID}, options)` | `GET /api/session/S/inbox` | One unwrapped data array |
| `session.active(undefined, options)` | `GET /api/session/active` | One unwrapped data map |

The two message rows describe one method. `S` is an encoded path component.
Query values use `URLSearchParams`. The wait request has no body or query.
The active method honors its second logical argument, despite the generated client's different signature.
Foreign active IDs remain in the returned map.

The adapter preserves order, IDs, statuses, timestamps, and cursor values.
It does not decode opaque cursors or filter arrays.
The verifier owns repeated-cursor and duplicate-message checks across pages.
Every nonempty native page can have a next cursor, including the last nonempty page.
The verifier continues through the empty sentinel. Pagination is not an atomic snapshot.

## Wire subset and limits

Finite reads require status 200 and JSON, except the empty 204 wait response.
Media types permit only the expected type and an optional UTF-8 charset parameter.
Error bodies have the same byte bound but never become diagnostic text.
Content-Length is an early rejection hint, not a substitute for streamed accounting.
Byte counts use the typed-array intrinsic before decoding.
JSON and UTF-8 errors are explicit failures. There is no catch-to-empty fallback.

| Limit | Ceiling |
| --- | ---: |
| `maxBytes` per response or whole subscription | 4,194,304 |
| `maxFrameBytes`, including comments and framing | 262,144, also bounded by `maxBytes` |
| `maxEvents` per subscription | 10,000 |
| `maxQueue` undelivered events | 10,000 |
| `maxDepth` per JSON value | 64 |
| `maxNodes` per JSON value | 100,000 |
| `closeMs` per close, shared by all teardown stages | 1000 |

The launcher can lower these positive integer ceilings.
Each call can lower `maxBytes` again. A call cannot raise the captured ceiling.
Total wire bytes include heartbeats and partial frames.
The lifetime byte bound also bounds queued event data and parser storage.

The message codec supports native `user`, `assistant`, and `idle` records.
It validates their nested prompt attachments, content, tools, timing, errors, and optional accounting fields.
Other transcript variants fail with `unsupported_message_type`. No variant is silently removed or renamed.
The separate transcript extension does not automatically expand this codec.

Jobs preserve all three native kinds and all four statuses.
Inbox records preserve all four types and both delivery modes.
The active codec accepts only native `{type:'running'}` values.

The event codec deliberately supports a restricted lifecycle subset:

- `server.connected`
- `session.inbox.delivered` and `session.inbox.cancelled`
- `session.execution.started`, `succeeded`, `failed`, and `interrupted`.

Other event schemas fail with `unsupported_event_type`.
This includes normal native content, step, tool, status, and RPC events.
Thus a real run that emits those events is unavailable, not successful.
Broader event support requires a separately reviewed codec extension.
The adapter never synthesizes events or converts event IDs into message IDs.
Lifecycle events require native creation time, session fields, and the version-1 durable envelope.
The connected event does not require creation time or a durable envelope.

## Local seal and iterator contract

Subscription returns synchronously. Its first `next()` starts one connection.
The pump reads continuously into a bounded FIFO, independently of consumer speed.
The first event must be a fresh connected event. Replay and reconnect are errors.
Unknown SSE fields, malformed frames, structural excess, and remote EOF are explicit failures.
SSE supports multiline data, comment heartbeats, LF, CRLF, lone CR, and split UTF-8 bytes.

Abort and `return()` synchronously seal ingress. No later `reader.read()` starts.
The pump still processes bytes from its already-issued read under the same limits.
It joins that handler, cancellation, and reader release before successful closure.
Only cancellation with the adapter's exact reason suppresses a read exception.
Incomplete UTF-8 or a partial final frame fails the fence.

`return()` is idempotent and does not clear the FIFO or consume queued events.
It resolves after teardown, without waiting for consumer drainage.
A teardown error rejects `return()`.
The verifier intentionally continues `next()` after `return()`.
Already-resolved results and queued events retain their original order.
After that prefix, a sticky error rejects every subsequent `next()`.
Only settled, failure-free closure permits EOF. EOF is permanent.
A second iterator or a concurrent pending `next()` is refused.

The local fence covers issued read results and enqueued or resolved events only.
It excludes unread transport buffers, sockets, kernel buffers, and the remote queue.
Cancellation can discard those excluded bytes.
The adapter cannot prove a remote drain, absence of racing remote loss, or an atomic endpoint snapshot.

Errors use bounded local codes such as `response_byte_limit`, `invalid_wire_shape`,
`stream_partial_frame`, `event_loss`, `read_aborted`, and `transport_teardown_failed`.
HTTP failures use `http_status_<number>`. Remote bodies and authentication text never enter error messages.

## Evidence and qualification

[Offline tests](../test/native-completion-http.test.mjs) inject finite byte streams without a server or listener.
They cover routes, schemas, limits, pagination, cancellation, prefix preservation, and unchanged-verifier composition.
The composed verifier still returns `PROVISIONAL`, `accepted:false`, and `wire.status:'unqualified'`.

Native qualification remains pending for actual codecs, close ordering, loss races,
CLI prompt joins, cancellation settlement, descendant inventory, and job-to-inbox-to-active transitions.
The restricted event and transcript subsets remain explicit compatibility limits.
