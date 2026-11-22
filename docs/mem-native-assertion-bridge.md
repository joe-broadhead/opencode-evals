# Controlled Memory assertion bridge

## Status and scope

This is an opt-in offline implementation for controlled synthetic Memory trials.
It does not install a native transform, modify Memory setup, inject a transport, or change native permission rules.
The native runtime, runner, container, CLI, observer, consumer, product release, and frozen fixtures remain unchanged.
Independent review and exact-runtime qualification remain required.

The original authority request-ID interface remains available for its existing synthetic callers.
The new assertion interface is separate. An executor cannot mix the two interfaces.
Native evaluation does not require a request ID. Only an actual pending ask supplies one.

## Sources

The implementation follows OpenCode `dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06` and Effect `9a91b1926a5fbfaffd302a7a41a94d4d53a1154e` (4.1.0).
The retained SOURCE-RESOLUTION report, sections 3–6, supplies the approved controlled-plugin design.
The source manifest verifies the individual source bytes. No downloaded source or native executable runs in these tests.

| Contract | Pinned source |
| --- | --- |
| ID-free assert input and evaluation | [AssertInput](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/plugin/src/permission.ts#L5-L14), [Promise permission interface](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/plugin/src/promise/permission.ts#L8-L31) |
| Configured deny skips hooks; unattended policy follows hooks | [evaluateInput](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/permission.ts#L184-L210) |
| Only ask allocates a request; assert waits for native completion | [request/assert](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/permission.ts#L212-L288) |
| Permission ID is event.data.id; replied precedes deferred settlement | [event schemas](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/schema/src/permission.ts#L26-L54), [reply](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/permission.ts#L306-L366) |
| Public get/reply check session membership | [host](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/plugin/host.ts#L106-L114), [permission domain](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/plugin/host.ts#L447-L466) |
| Promise assert has no executor AbortSignal | [setup adapter](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/plugin/src/promise/adapter.ts#L479-L486) |
| Captured executor and replacement Promise wrapper | [promiseExecutor](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/plugin/src/promise/adapter.ts#L255-L264), [editor.update](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/plugin/src/promise/adapter.ts#L529-L541), [executePromiseTool](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/plugin/src/promise/adapter.ts#L693-L702) |
| Async context restoration is runtime-conditional | [AsyncResource detection](https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/src/internal/effect.ts#L501-L515), [yield/resume](https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/src/internal/effect.ts#L617-L638) |

## Private assertion interface

`execution.beginAssertion(snapshot)` validates the reserved executor's session, source, action alias, and allowed resources.
It suspends that exact lease before native assert starts. One executor supports one assertion and at most one native ask.
Reads remain budget-free. A read assertion with no classified resource supports only an empty resource list.
No assertion allocates another operation use, changes an exact payload, or refunds a consumed use.
The existing explicit Memory-family and target write-policy check remains mandatory.

The returned private capability has these operations:

| Operation | Behavior |
| --- | --- |
| `evaluate(event)` | Validates the ID-free evaluation snapshot. Retains revision/effect observations. Preserves ask/allow or tightens to deny. |
| `bind(request)` | Captures one actual native request snapshot. Identical delivery is idempotent. Changed fields, another ID, or reused ownership refuse. |
| `reply(send)` | Starts at most one bounded-policy once send. Never restores the receipt. |
| `run(invokeNativeAssert)` | Calls the original assertion once and owns its awaited completion barrier. Preserves the native rejection object. |
| `cleanup(request, send)` | Revokes the original lease and tracks an exact pending rejection. Never supplies authority. |
| `recover(read)` | Tracks bounded public lookup work, including after executor termination. Never supplies authority. |
| `matches`, `live`, `reject` | Support private registry validation and terminal revocation. They are not tool methods. |

Only actual native assert success plus successful completion of an initiated once send can resume a live lease.
Hook allow, replied events, and successful once sends alone cannot resume it.
Any denial, cancellation, failed send, stale scope, or ended executor permanently prevents restoration.
Native assert failure retains its exact rejection object even when cleanup also fails.
An old assertion never selects a successor by carrier, payload, ordering, or current invocation.

Authority facts record assertion revision, latest effect, phase, and native request ID when one exists.
These are observations, not native completion certificates.
The original permission ABA revisions remain unchanged for the legacy interface.

## Setup facade and outer wrapper

`await createMemoryAssertionBridge({authority, context})` requires injected public host seams:
`permission.assert`, `permission.hook`, `permission.list`, `permission.get`, `permission.reply`, and `event.subscribe`.
The constructor registers the evaluate hook and subscribes to asked/replied events.
It has no fallback for missing seams.

The returned interface contains:

| Member | Owner use |
| --- | --- |
| `context` | Fresh setup facade. Only permission.assert changes. Other domains retain their original references. |
| `setup(originalSetup)` | Calls controlled setup with the facade and returns an idempotent disposer that forwards the original disposer. |
| `wrap(tool, capturedExecutor)` | Returns the outer executor wrapper. Preserves the original input, context, result, and rejection object. |
| `currentExecution()` | Returns a private receipt accessor for a later transport owner. Absent, foreign, ended, or aborted ALS stores refuse. |
| `recover()` | Performs one bounded recovery attempt per registered token. No polling or carrier fallback. |
| `status()` / `facts()` | Reports local outstanding assertions, host tasks, partial evidence, and cleanup failures. |
| `close()` | Revokes authority and cleans known asks. Retains the subscription and tombstones while native assertion work remains. |

The required order is authority → private ALS → inner observer/captured executor.
The final-transform owner must capture the selected executor inside editor.update and pass that captured function to `wrap`.
This module does not claim final transform ownership or rewrite the observer.
Mixed read/write observation must omit the observer's optional reservation lookup until its read-without-grant distinction qualifies separately.

The assertion facade captures `AsyncLocalStorage.getStore()` synchronously before any await.
It validates that store independently from metadata.
Each assertion receives one fresh random token in fresh metadata under `oc_mem_assertion_v1`.
A preexisting reserved key refuses, including an inherited key.
Original session, agent, action, resources, save, source, and metadata entries remain unchanged.
Tool arguments, schemas, native context, and tool results do not receive this token.

The token is correlation, not bearer authorization.
Evaluation and event callbacks resolve it only through the private registry, never their ambient ALS context.
The registry retains token tombstones and native request ownership for the trial lifetime.
Unknown tagged traffic or missing tokens on controlled Memory actions fail closed. Unrelated untagged host actions remain unchanged.
This controlled-process design does not protect against arbitrary hostile plugins that can replace executors or private dependencies.

## Recovery and cancellation

Asked events bind `event.data.id`, never the envelope ID or tool carrier.
The full immutable pending snapshot includes save and metadata. Evaluation does not contain save and does not invent it.
Snapshot comparison permits native removal of undefined metadata values, including during pending reevaluation. Caller metadata remains unchanged.
Repeated delivery cannot start a second once send. A second ask or changed snapshot revokes the assertion.
Late events address only the original tombstone and can trigger exact rejection, not new authority.

Recovery lists once per relevant session and matches only registered tokens.
One match requires an exact get confirmation. Zero matches, multiple matches, changed get results, or host errors mark evidence partial and revoke that assertion.
Ambiguity permits at most two exact cleanup attempts. Larger ambiguity requires external containment.
Each token receives at most one recovery attempt. Lost evidence never becomes a complete-empty claim.
Stream failure revokes the controlled scope and starts that same bounded recovery for cleanup, not approval.

Abort revokes the lease synchronously. An already-aborted executor never delegates.
The wrapper removes its abort listener when the executor ends. Tombstones and assertion Promises outlive that listener when necessary.
Native assert has no public AbortSignal here. Cancellation does not prove native fiber termination.
The authority tracks assertion, once-send, cleanup, and recovery work separately from executor leases.
Outstanding work prevents successor admission and sealing, including reentrant completion reads.
Admission rechecks the work ledger after trusted activation and scope readers, before scope publication or reservation.
Opening requires all work to drain. Execution refuses work from ended leases but permits supported concurrent live reads.
Refused admission does not consume an operation use. Genuine drain permits a later admission attempt.

`close()` can wait for public host operations. It reports `closed:false` if native assertions still remain after those operations settle.
That result retains the event subscription for late cleanup. The owner must drain the work and close again, or terminate the contained workload.
Concurrent close calls share one attempt. A partial attempt does not prevent another close attempt after native work drains.
The hook disposer and iterator return each run at most once, including after errors.
An unsuccessful disposer remains unsuccessful on later attempts. The bridge does not report a completed close after that error.
Close drains tracked host work before disposal and again after the event pump ends, including cleanup created during disposal.
Public `recover()` returns `{accepted:false,reason:"closing"}` during closing, or `{accepted:false,reason:"closed"}` after a completed close.
These refusal results start no lookup and consume no recovery attempt.
Internal stream-loss recovery and exact late-ask cleanup remain available during closing. They cannot approve an assertion.
The setup disposer does not itself certify this drain. The owner must inspect bridge status.
There is no timeout approval, retry, refund, force allow, always reply, or method that erases the outstanding-work ledger.
Public reject can reject other asks in the same native session. The synthetic runner must exclude unrelated concurrent session work during cleanup.

## Transport and native qualification remain separate

A receipt accessor is not a transport implementation or an additional permission grant.
Preparation reads can obtain the existing scoped receipt before an assertion. During assertion suspension, the receipt is null.
Neither state authorizes arbitrary HTTP traffic.
The transport owner must validate the exact method, route, body, target, and permitted preparation reads at every send attempt.
It must obtain a fresh receipt and check cancellation immediately before dispatch, with no intervening await.
Resends need the same checks. Cancellation cannot undo an already-sent request or guarantee that the backend will not commit it.

Memory's current setup constructs its backend/runtime without the required guarded transport injection.
Product setup, v3/records/control transport insertion, fixture receipt transport, and native supervision remain separately owned work.
No personal no-assert path acquires a fabricated permission request. No frozen case or discovery condition is removed.

Node fake-host tests prove this local bridge's behavior, not the exact Promise/Effect chain in a distributed binary.
The native qualification must cover AsyncResource availability, scheduler yields, interruptions, final observer order, pending-request cleanup, and every protected dispatch path.
Missing ALS context fails closed. No sole-current-executor fallback is available.
