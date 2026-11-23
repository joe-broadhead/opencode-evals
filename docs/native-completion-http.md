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

## Wire coverage and limits

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

The message codec preserves all 11 native message types, including conflicting work that the verifier can refuse.
It validates the declared fields, nested discriminants, timing, errors, and optional accounting fields.
Metadata, provider-native records, tool input, and tool metadata remain bounded opaque JSON records.
The adapter does not validate their application-specific meaning.
Unknown message types fail with `unsupported_message_type`. No variant is silently removed or renamed.

| Message type | Additional validation |
| --- | --- |
| `agent-switched` | Agent and optional previous agent |
| `model-switched` | Model and optional previous model |
| `location-switched` | Public location, optional project/subpath, absent/null/object previous location |
| `user` | Text and optional prompt attachments |
| `synthetic`, `system` | Text and optional description |
| `skill` | Skill ID, name, text |
| `shell` | Shell ID, command, four statuses, optional finite exit/output and completion time |
| `assistant` | Model, agent, text/reasoning/tool content, four tool states, optional snapshot/accounting/error/retry |
| `compaction` | Running/completed/failed variants, auto/manual reason, variant-specific summary/error/model/native/accounting |
| `idle` | Succeeded/failed/interrupted outcome and optional structured error |

All messages require a `msg_` ID and creation time. Optional metadata must be a record.
Message pages retain optional or null `previous` and `next` cursors unchanged.
The adapter does not infer chronology, completion, or cross-page identity from these values.
Encoded shell exits `"Infinity"`, `"-Infinity"`, and `"NaN"` remain explicitly unsupported and fail with `invalid_wire_shape`.
Checked IDs and non-null cursors retain the 512-character, nonempty bound. Event IDs require `evt_`.
Locations require absolute POSIX directories. These restrictions are not native qualification.

Jobs preserve all three native kinds and all four statuses.
Inbox records preserve all four types and both delivery modes.
The active codec accepts only native `{type:'running'}` values.

The event codec preserves all 98 variants in the pinned public `V2Event` union.
It validates event IDs, type declarations, finite creation time, metadata records, locations, and durable envelopes.
Durable sequences must be nonnegative safe integers. Versions must match the table.
The aggregate ID must equal the session ID, or the project ID for `worktree.resolved`.
Ephemeral events reject durable envelopes. Ordinary locations retain optional `workspaceID`.

Every `session.*` event requires `data.sessionID`.
Permission, persistent-PTY, form-replied/cancelled, and TUI session-select events also require that field.
Other ordinary events validate `data.sessionID` when present.
Step, text, reasoning, tool, and retry events require a `msg_` assistant ID.
All inbox events require a `msg_` inbox ID.
The six lifecycle payloads retain their exact validators, including failure errors and interruption reasons.

**Other event payload fields remain opaque bounded JSON.** The codec requires an object, but does not validate those fields against their native schemas.
For example, it retains step accounting, tool input/results, permission details, status payloads, and project/form/terminal records without certifying their meaning.
The table specifies supported discriminators and envelopes, not full semantic payload validation.
Future consumers must validate additional fields before they use those fields as evidence.

The RPC declaration is `rpc.${string}`, including an empty suffix. It does not enumerate plugin names.
RPC requires finite `created`, a public location, and record-valued `data`.
It rejects a durable envelope and a private workspace location.
Its complete data record remains opaque, including fields named `sessionID`.
A different RPC envelope or undeclared event type fails explicitly rather than disappearing.

Connected uses its special envelope: no `created` or `durable`, empty data, and optional public location and metadata.
Unknown event types fail with `unsupported_event_type`. Malformed validated fields fail with `invalid_wire_shape`.
Internal `session.usage.recorded` and replay-only `session.message.content.updated` are not public variants and remain unsupported.
The adapter never synthesizes events, converts event IDs into message IDs, filters unrelated events, or sorts timestamps/sequences.

### Source-derived event inventory

The table uses exact names. Braces list suffixes, not wildcards. `E` means ephemeral, and `D1`/`D2` mean durable version 1/2.
All paths refer to source pin `dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06`.
The controlling inventory is `packages/client/src/promise/generated/types.ts:2845-2943` and `packages/schema/src/event-manifest.ts:72-82`.

| Event names | Envelope | Generated declaration lines |
| --- | --- | --- |
| `location.shutdown`, `models-dev.refreshed`, `credential.updated`, `credential.switched`, `integration.updated`, `provider.updated`, `model.updated`, `agent.updated` | E | 1657-1728 |
| `session.created` | D1 | 2334-2356 |
| `session.agent.selected`, `session.model.selected`, `session.moved`, `session.renamed`, `session.metadata.updated` | D1 | 1167-1216 |
| `session.permissions` | D1 | 2357-2366 |
| `session.viewed`, `session.archived`, `session.unarchived` | D1 | 1217-1246 |
| `session.usage.updated` | E | 1729-1737 |
| `session.deleted`, `session.forked` | D2 | 1247-1272 |
| `session.inbox.delivered`, `session.inbox.cancelled`, `session.inbox.delivery.changed` | D1 | 1273-1304 |
| `session.inbox.enqueued` | D1 | 2723-2732 |
| `session.execution.{started,succeeded,failed,interrupted}` | D1 | 1305-1344 |
| `session.instructions.updated` | D2 | 1345-1354 |
| `session.synthetic`, `session.skill.activated`, `session.shell.{started,ended}` | D1 | 1355-1398 |
| `session.step.{started,streamed,ended,failed}` | D1 | 1399-1466 |
| `session.text.{started,ended}`, `session.reasoning.{started,ended}` | D1 | 1467-1518 |
| `session.text.delta`, `session.reasoning.delta`, `session.tool.input.delta`, `session.tool.progress`, `session.compaction.delta` | E | 1738-1782 |
| `session.tool.input.{started,ended}`, `session.tool.called`, `session.retry.scheduled` | D1 | 1519-1571 |
| `session.tool.{success,failed}` | D2 | 2105-2141 |
| `session.compaction.{started,ended,failed}`, `session.revert.{staged,cleared,committed}` | D1 | 1572-1656 |
| `filesystem.changed`, `reference.updated`, `permission.{asked,replied}`, `plugin.updated`, `project.updated`, `worktree.updated` | E | 1783-1863 |
| `worktree.resolved` | D1 | 1864-1873 |
| `command.updated`, `config.updated`, `skill.updated` | E | 1874-1900 |
| `pty.{created,updated,exited,deleted}` | E | 2171-2188, 1901-1918 |
| `persistent-pty.{added,removed,updated}` | E | 2189-2206, 1919-1927 |
| `shell.{created,exited,deleted}` | E | 1928-1954 |
| `form.{created,replied,cancelled}` | E | 2772-2780, 2222-2230, 1955-1963 |
| `websearch.updated`, `artifact.updated`, `session.status`, `session.idle` | E | 1964-1999 |
| `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`, `tui.session.select` | E | 2000-2059 |
| `installation.{updated,update-available}`, `vcs.branch.updated`, `mcp.{status.changed,resources.changed}` | E | 2060-2104 |
| `rpc.${string}` | RPC | 1005-1013 |
| `server.connected` | Connected | 1014-1021 |

`packages/schema/src/event.ts:9-35,109-156` defines the ID, sequence, and envelope rules.
`packages/schema/src/session-event.ts:33-705` supplies the session versions and relevant payload fields.
`packages/protocol/src/groups/event.ts:8-36,80-86` declares RPC and connected independently of the manifest.
`SessionMessageInfo` at generated lines 2742-2753 lists all 11 message variants.
Their declarations include the wire-specific nullable previous location and encoded shell exit alternatives.
`packages/schema/src/session-message.ts:21-315` supplies message discriminants and nested field semantics.

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
The [codec correction tests](../test/native-completion-http-codec.test.mjs) cover the source inventory, mixed traffic, all message types, and malformed envelopes.
The original 58 transport checks remain, with one explicit expectation migration in the message-discriminant test.
Its eight formerly unsupported known types now reach native payload validation.
The existing synthetic/system examples are valid and must round-trip unchanged.
The other six examples lack required fields and still fail, now with `invalid_wire_shape`.
The `other` example still fails with `unsupported_message_type`. Existing malformed and unknown controls remain.
The composed verifier still returns `PROVISIONAL`, `accepted:false`, and `wire.status:'unqualified'`.

Native qualification remains pending for actual codecs, close ordering, loss races,
CLI prompt joins, cancellation settlement, descendant inventory, and job-to-inbox-to-active transitions.
Opaque payload semantics and the explicit bounded-wire restrictions remain separate from native qualification.
