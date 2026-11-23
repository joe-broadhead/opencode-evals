# Whole-trial containment (unqualified)

This opt-in path contains the runner, fixture, server, CLI, and their descendants in one workload container.
The parent owns the proxy, networks, watchdog, resource receipts, and aggregate store.
The ordinary `container` and `none` modes retain their existing behavior.

**This implementation does not qualify native execution.** It always returns `complete: false` and `successor_allowed: false`.
The launcher composes containment through a private injected interface. Native completion, observer reconciliation, and final acceptance still need reviewed integration.
No VM, Docker, listener, provider, or OpenCode runtime test forms part of the offline evidence.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/run/wave-contained.mjs` | Parent admission, fixed descriptor, containment composition, and provisional report |
| `src/run/owned-containment.mjs` | Parent lifecycle, independent deadlines, configuration proof, exact-ID cleanup |
| `src/run/owned-docker-client.mjs` | Bounded Docker transport through original child handles |
| `src/run/container-receipt.mjs` | Full creation receipts for `create`, `run`, and `network create` |
| `src/run/owned-launch.mjs` | Bound descriptor and process-local inner capability |
| `src/run/owned-backend.mjs` | Local execution inside the outer container |
| `src/run/owned-entry.mjs` | One contained execution and provisional receipt |
| `src/run/owned-spool.mjs` | Continuous bounded raw-byte recording |
| `src/run/owned-io.mjs` | Fixed file readers, staging validation, and disk measurement |
| `src/run/owned-postmortem.mjs` | Data-only parent finalization |
| `src/cost/attempt.mjs` | Shared partial accounting without a completion claim |

`scripts/run-contained-trial.mjs` is the inner entry point. It does not use wave-worker IPC or start a successor.
It calls the existing runner with a process-local capability.
`evals run --isolation owned-container` alone refuses before store, credential, or world access.

## Parent interface

`containTrial(plan, dependencies)` performs creation, execution, cleanup, and finalization.
It does not release a wave lease or write aggregate accounting.
It requires these parent-owned dependencies:

| Dependency | Contract |
| --- | --- |
| `docker` | `run(args, options)`, `stopClients()`, and `closed()` |
| `journal(snapshot)` | Durable atomic receipt write outside every workload mount |
| `validateInputs(plan)` | Pinned hashes and the fresh work directory's device/inode |
| `measure(work)` | `true` only after disk, inode, and free-space proofs |
| `finalize(proof, {secrets})` | Fixed parent readers, never an output-selected module |
| `clock` | Optional injected `now`, `set`, and `clear` for deterministic tests |
| `signal` | Optional parent cancellation signal |
| `nativeSnapshot(binding)` | Optional synchronous snapshot from the independent verifier |

The native snapshot accepts only a bound `failed` or `interrupted` outcome.
It cannot certify success, observer health, usage completeness, or cleanup.
It preserves a known negative when cleanup remains unknown.

The plan contains:

- The invocation, manifest hash, and physical trial ID in `binding`
- The fixed context, pinned image ID, pinned image environment, and non-root user
- Separate canonical paths for `control`, `store`, `dockerConfig`, `work`, `inputs`, and `binaries`
- Pinned `inputs_sha256` and `binaries_sha256` tree digests
- The approved egress list and one credential name
- A descriptor containing only the one-trial runner configuration in `options`
- Finite `timeoutMs`, `cleanupMs`, `operationMs`, and `outputBytes` bounds.

The maximum execution deadline is 58 minutes. Cleanup and finalization share at most two more minutes.
Each Docker operation has at most 20 seconds and 1 MiB of client output.
The parent starts its watchdog before input validation and resource allocation.
The watchdog remains independent of the inner runner's event loop.
Each finalization operation also has a deadline within the same cleanup reserve.
Late callback results are rejected even if their timer callback has not run yet.
These deadlines cannot preempt synchronous parent code. Parent callbacks must avoid unbounded synchronous work and late authoritative writes.

The transport uses an explicit Docker binary and `--context colima-mem-evals-20261122` on every operation.
`createOwnedDockerClient` requires an injected `spawn`. It has no automatic native launch path.
The qualified native integration must supply the pinned executable, dedicated Docker configuration, and designated credential values in memory.
It must not discover credentials or inherit the host environment.

The client captures observed stdout and stderr bytes during stop and drain, under one shared `maxBytes` cap.
An oversized chunk retains only the remaining bounded prefix and sets `overflow: true`.
Stream errors, premature stream closure, or data after EOF set `truncated: true`; diagnostics are not exported.
Exec output remains private and is omitted from the returned text.
The client does not distinguish kernel pre-cancellation bytes from bytes produced after cancellation.

Process exit and stream settlement are separate. Stream EOF alone does not establish process exit.
The original child's `close` event supplies aggregate stdio-closure evidence; `exit` is also required.
A stop request or successful signal does not establish either fact.
The bounded stop grace can return `closed: false` while the original handle remains tracked.
After that result settles, late events cannot change its code, output, or flags; late exit plus close can retire the handle.
Capture buffers are released at result settlement. Hung handles remain unknown, without retaining growing output buffers.
These checks do not prove OS descendant absence or atomic remote drain.

## Creation and cleanup

Each creation first records a pending receipt. A successful full 64-character ID replaces that pending receipt.
The parent persists that ID before inspection or start. A name, label, short ID, or cidfile grants no cleanup authority.
If the complete successful ID arrives without client closure, the parent journals it for exact-ID removal but retains the pending uncertainty.
Any overflowed or explicitly truncated creation response grants no cleanup ID, including stderr-only overflow.
A full-looking retained prefix cannot supply authority. Both owned transport callers apply this rule before recording an ID.
Legacy complete responses still use their existing code/stdout shape; malformed or missing required fields grant no ID.
Unknown closure or output loss blocks continuation. Neither condition permits inspection for launch, start, exec, or finalization.
Creation identity and client closure are separate facts; removing the known ID does not resolve missing closure or lost output.

The parent verifies the image, mounts, environment, namespaces, resource limits, entry point, and network configuration before start.
It verifies effective network membership again before workload execution.
The workload uses 1.5 CPU, 3 GiB memory, equal swap, and 512 PIDs.
The proxy uses 0.25 CPU, 256 MiB memory, equal swap, and 128 PIDs.
Both containers have bounded Docker logs. These limits do not change the approved 2 CPU, 4 GiB, 40 GiB VM.

The existing internal isolated-gateway network and CONNECT proxy retain the egress boundary.
The proxy has no model credential. The workload has no Docker socket, host HOME, Docker configuration, or aggregate store mount.
Credential values enter only the private Docker exec environment. Exec arguments contain names, never credential values.

Cleanup closes admission first. It reclaims original Docker-client handles, then stops and removes exact owned container IDs.
It removes the exact network IDs after container removal. It then verifies all original client handles again.
A resource is absent only after an explicit missing-object response for its full ID from the same context.
A daemon error, timeout, or client exit is not resource absence.

A pending, partial, lost, or late creation remains unknown. This implementation does not recover a lost receipt by name.
Even a late response after the bounded operation cannot clear the retained uncertainty.
The launcher must retain locks and receipts for explicit scoped recovery. There is no automatic retry or successor.

Parent death is not automatically recoverable. The journal supports inspection by the existing scoped recovery owner.
The native transport still needs proof that Docker starts no unowned SSH or credential-helper descendants.

## Inputs and inner mode

The staging validator reads only already-approved staged artifacts. It does not collect source, install packages, or download binaries.
The work directory must be fresh and empty. No mounted root can overlap another root or a control path.
The input tree allows only harness, arm, cases, caps, model catalog/map, and condition artifacts.
The binary tree contains exactly executable Linux `node` and `opencode` files.
ELF checks cover the selected architecture and staged `.node` files. They do not replace runtime or dependency qualification.

Tree digests use sorted relative paths, file modes, byte sizes, and content SHA-256 values.
Each entry contributes `path\0mode\0size\0sha256\n`, with the mode represented as a decimal integer.
Links, hardlinks, special files, excessive entries, and excessive bytes fail validation.
The staging owner must preserve these immutable snapshots through execution.

The descriptor travels through bounded bootstrap stdin. Its digest binds the provisional receipt to the parent's final configuration proof.
The inner entry checks Linux, the exact mount layout, the descriptor binding, and the one-trial configuration.
`/.dockerenv` and environment hints do not establish containment.
Inner checks never replace the parent's external Docker proof.

Commands run locally with `--process-group inherited`. The outer container owns all descendants, including reparented processes.
This path does not use `liveGroups`, negative-PID signals, `pkill`, or nested Docker.
Inner `leave()` requests local shutdown. Inner `gone()` and `allGone()` always return false.
The generic `none` backend remains unconfined.

## Execution and finalization split

The inner runner stages the world and starts the fixture, server, and native CLI inside the workload container.
Server replacement, harness retries, and batch parallelism are disabled for this path.
The actual trial checks model routing. It does not start a replacement preflight server.

The recorder writes bytes continuously to fresh no-follow files. Each file has an 8 MiB limit.
The total spool has a 32 MiB limit and at most 63 children.
The runner retains a bounded in-memory view for its existing execution logic.
The entry keeps the recorder active after execution returns and waits for each original child's `close` event, not only `exit`.
That event establishes closure of the child's stdio, not descendant absence.
The drain allows one second by default, with an injectable bound no greater than two seconds.
If closure remains unavailable, the spool retains its prefix and marks the receipt incomplete (`overflow: true`, `streams_closed: false`).
Late data cannot upgrade that receipt. No new recorded child can start during drain, and legacy exit-only behavior remains unchanged without a recorder.
The receipt contains digests, bindings, bounded exit metadata, and fixed capture locations. It never certifies outer cleanup or native success.
The inner runner skips final sandbox reads, credential scrubbing, final summaries, reservation release, and final accounting.
Its private staging ledger is not the aggregate ledger.

Only after verified resource absence and client closure does the parent read the spool.
`finalizeOwnedTrial` reads fixed data formats. It never imports a world, fixture, plugin, or module named by output.
The bounded reader verifies root identity, path ancestry, regular-file type, link count, and size before reading.
The finalizer verifies receipt bindings and digests before it accepts bytes.
It redacts known secrets and computes partial accounting through the same reader as the legacy single-attempt path.
After validating the bound manifest and duplicate-free file entries, the finalizer verifies raw JSONL before auxiliary files, regardless of their order.
A missing or damaged auxiliary file or fixture capture does not erase independently verified partial billing.
A bounded incomplete spool can supply a verified prefix lower bound, never complete usage or verified overall evidence.
Unbound, duplicate, missing, or digest-invalid raw evidence supplies no billing.
The parent accepts exit metadata only as null or an integer from 0 through 255, even if the producer previously validated it.
Invalid exit metadata leaves overall evidence unknown without erasing verified raw cost.
Summaries export explicit bounded identity fields and typed statuses, not arbitrary receipt objects or extra parent binding properties.
The launch descriptor digest binds identity; it is not an authenticity signature over writable receipt metadata.

Raw spool files remain private, untrusted evidence. They can contain arbitrary runtime output.
The parent must supply every designated secret to redaction, including the generated server password passed to its finalization callback.
After redacted evidence import and verified cleanup, the staging owner can remove the private work root.
No removal or aggregate write occurs automatically in this adapter.

Native and observer success remain unknown. Complete billed cost and complete token usage remain unresolved.
CLI exit zero and step markers do not change those results.
The bootstrap itself returns a non-zero status after a provisional receipt, not a success certificate.

## Launcher composition (L-C)

The actual `main()` entry selects the parent containment path through `adapter.owned`.
The production adapter exposes no approved `snapshot` or `spawn` capability. Production qualification remains false.
Manifest fields and environment variables cannot supply these capabilities or override qualification.
Explicit legacy adapters retain their existing worker controls. The owned path never calls the host worker, host trial CLI, or `trialComplete`.

The private snapshot interface receives `{manifestSha, harnessSha, trial}`.
It returns already-approved `inputs`, `binaries`, and an exclusively created empty `work` directory.
Its result binds `manifest_sha256`, `harness_sha`, and `trial_id` to that request.
It also supplies tree digests, architecture, image digest, image environment, numeric user, approved egress list, and optional fixed pricing data.
This interface attests the selected harness, arm, case, condition, caps, catalog, and binaries. It does not collect or install them.
The snapshot owner must preserve these trees through execution. A snapshot timeout cannot authorize a late trial.

The parent requalifies the frozen manifest and repeats the $10 admission check after snapshot acquisition.
It constructs the descriptor from fixed paths and the admitted trial, not snapshot-supplied runner configuration.
`validateOwnedInputs` independently rehashes the trees before resource creation.
The model remains `opencode/deepseek-v4.1-flash#low`, with one physical trial at a time and zero retries.
The original 60-minute wave lease includes setup, execution, and the two-minute cleanup reserve.
Parent channel loss remains sticky, including after an apparent channel rebound.

The original private resource scope supplies the journal owner and admitted trial ID.
The parent writes the started marker before resource creation.
The journal uses exclusive no-follow temporary files, file synchronization, atomic rename, and directory synchronization.
Each write verifies the original directory and the previous file identity. Replacement, deletion, expiration, or closure denies further authority.
The parent repeats the previous-target check after temporary-file synchronization, immediately before rename.
No await or injected callback separates that final continuity check from rename.
The journal directory is parent-private, with one parent writer and no concurrent external writer under this contract.
These verification-time checks are not an atomic compare-and-swap against hostile same-UID processes.
File or directory synchronization errors retain uncertainty. The offline controls do not prove power-loss durability or parent-death recovery.
The parent retains uncertainty after a journal error and never releases the lease on unknown cleanup or settlement.

The fixed finalizer uses the retained work-directory identity only after resource absence and client closure.
Per-trial `containment.accounting` retains verified partial cost. Per-trial native negatives remain available even when cleanup fails.
Optional native lookup errors supply no new fact and cannot suppress the fixed postmortem reader.
Unsupported promises and thenables supply no native authority. The parent observes their rejection without adopting their result.
A previously bound native negative remains available after a later lookup error.
Public reason fields export only approved local codes, never callback diagnostics or remote exception text.
An unavailable operation is not evidence of provider failure.
The aggregate `report.cost` describes only the aggregate ledger. It does not include provisional per-trial cost before P-F import.
An aggregate read error marks only aggregate cost unresolved. It does not discard recovered trial facts or replace them with older progress.
The in-memory report remains current after a progress-write error. Failed writes do not guarantee persistence, and a persistent final report-write error still propagates.
The parent does not import artifacts, complete accounting, or remove the private work root in this slice.
Every attempted trial retains its reservation. Every owned report keeps `execution_qualified`, `complete`, and `successor_allowed` false.
The loop stops after its first provisional trial because no current result authorizes a successor.

## Integration changes for other owners

R-V still owns runner-to-verifier integration. O-C still owns observer-to-consumer reconciliation.
P-F still owns aggregate artifact import, accounting settlement, and the acceptance predicate.
Q still owns native staging, image, transport, and runtime qualification under separate authorization.
The separate authority contract remains excluded until independent clearance.

Required completion integration uses the existing runner-owned session and activation in `memoryClient`.
The separate verifier must observe native admission, the first stored idle outcome, and quiescence without submitting another prompt.
The existing observer owner retains ready/open/seal authority. No second completion or authority state machine belongs in this adapter.
Reviewed verifier data must bind to invocation, manifest, physical trial, case, activation, session, prompt, and raw digest.
Until those interfaces are wired and qualified, success and successor admission remain disabled.

## Offline checks and deferred qualification

The finite offline suite uses injected Docker, clocks, process handles, and readers.
Existing scoped cleanup, runner-control, fixture-codec, and turn-reader tests also remain applicable.
`test/isolation.test.mjs` is not an offline-safe import: its top level probes Docker.
The full suite also contains listeners and real child processes. It is outside this ticket's authorization.

Native qualification still requires staged Linux dependencies, exact Docker inspect envelopes, hostile descendants, OOM, disk limits, and original-client reclamation.
It also requires the pinned OpenAPI codec, observer integration, provider routing, and explicit approval for runtime tests.
This branch makes no native or paid-wave qualification claim.
