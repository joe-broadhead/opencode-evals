# Darwin identity ownership — offline candidate

This module is not active in the default process adapter.
The owned snapshot and spawn defaults remain null. The transport still returns `qualified:false`.
This source change does not build or deploy a helper asset.
The separate native run observed refused-operand exits, but never observed a successful QMAC1 lookup.
Native qualification of successful identity reads remains a separate gate.

## Private composition

The parent supplies `identityOwner` to `createOwnedDockerProcess` as a trusted dependency.
This dependency and plain `readIdentity` are mutually exclusive.
The adapter registers only the original child returned by its pinned spawn function.
There is no public PID lookup or signal interface.

`createDarwinIdentityReader(ownerPins, trustedDeps)` returns these private methods:

| Method | Contract |
| --- | --- |
| `register(child)` | Records the original child and observes exit, close, and error. Registration alone does not supply identity. |
| `readIdentity(child, {signal})` | Returns a promise for identity or null. Only a registered, live original child can start a lookup. |
| `ready()` | Returns the construction warm-up result as a promise of true or false. It grants no identity or current admission authority. |
| `available()` | Reports whether the owner permits another attempt. Busy and stopped owners refuse without a queue. |
| `reconcile()` | Observes actual helper closure for at most 100ms. It does not cancel or signal a helper. |
| `stop()` | Permanently stops admission, invalidates the active result, and observes closure for at most 100ms. |
| `closed()` | Reports actual helper closure, not lookup completion or Docker-client closure. |

The caller retains the owner, also exposed as `transport.identityOwner`.
The constructor starts warm-up after pin and asset validation. It returns the owner immediately, with admission closed.
The caller awaits `ready()` and verifies `available()` before admission. No call queues a lookup during warm-up.
Parent shutdown requires both Docker-client closure and identity-owner closure.
A false cleanup result blocks a successor. A late close can reconcile ownership but cannot restore a canceled result.
This change does not connect that private composition to a parent launcher.

## Owner pins

The owner supplies a copied `qmac-owner/1` record with these fields:

| Field | Requirement |
| --- | --- |
| `schema` | Exactly `qmac-owner/1` |
| `platform`, `arch` | Darwin and the actual Node architecture, `arm64` or `x64` |
| `runId` | Nonempty ASCII letters, digits, underscores, and hyphens, at most 128 characters |
| `cwd` | Absolute canonical private directory with mode `0700` |
| `helper.path` | Absolute canonical executable path |
| `helper.sha256`, `helper.size` | Exact SHA-256 and byte size, from 1 byte through 1MiB |
| `helper.mode`, `helper.arch` | Exactly `0555`, with the same architecture as the owner |
| `sourceSha256` | SHA-256 of the reviewed C source |
| `buildManifestSha256` | SHA-256 of the complete build evidence |
| `platformProfileSha256` | SHA-256 of the qualified platform profile |
| `nodeSha256` | SHA-256 of the actual pinned parent Node executable |
| `lookupMs`, `cleanupMs` | Exactly 100ms each |

The invoker validates the schema, digest syntax, platform, helper metadata, canonical paths, and helper bytes.
Missing assets or invalid pins throw `darwin-identity-pins-refused` at construction.
Each lookup verifies the helper asset again before spawn.
There is no executable discovery, alternate backend, interpreter, or approval-boolean capability.

Digest syntax does not authenticate build or platform evidence.
The owner must establish that evidence independently and retain the complete byte closure outside trial data.
That closure includes source, invoker modules, Node, SDK headers, compiler, linker, build environment, and the final signed helper.
The profile must identify the actual OS build, architecture, and loaded system images through an approved attestation method.
SDK linker stubs are not runtime-library bytes.

The owner must protect helper bytes and path ancestry throughout use.
A path/hash check cannot prevent replacement between the check and exec.
The invoker does not install protection, discover platform evidence, or qualify a binary from a digest.
Filesystem checks use synchronous reads of an owner-protected local asset. They do not provide a hard bound against a stalled filesystem.

## Lookup and closure

### Construction warm-up

The owner deploys the final protected helper copy before construction.
Construction executes that deployed path exactly once with operand `"0"`, under a separate fixed 1000ms deadline.
The existing C source rejects `"0"` at its first argument check, before `getppid`, `getpid`, credential calls, or `proc_pidinfo`.
This execution queries no target, registers no identity, and supplies no signal authority.

Warm-up uses the same pinned executable, private cwd, empty environment, and stdio contract as lookup.
Success requires exit 64, no signal or stdout, and aggregate close before its deadline.
Wrong exit, error, output, timeout, or missing close keeps admission closed permanently for that owner. There is no retry.
Pin or asset validation failure still throws before any execution.

The owner accounts for warm-up in `stop()`, `closed()`, and `reconcile()` exactly as it accounts for a lookup helper.
`ready()` returns false on warm-up failure or cancellation, but that result does not prove helper closure.
An unclosed warm-up remains registered after the unchanged 100ms cleanup observation. Late exit cannot restore admission.
`ready()` retains the warm-up outcome after success. A later `stop()` still disables admission permanently.

The retained native qualification report measured a 299.485ms first execution of a fresh deployed file copy, with refused-operand exit 64.
Warm executions of the same deployed copy took about 10ms on that host.
The first identity lookup missed its 100ms deadline and failed closed. No native QMAC1 success was observed.
These measurements describe that host and asset, not a universal latency guarantee.
The source is the 2026-11-23 `mem-q-mac-native-qual.74gDW75Cn7/evidence/REPORT.md`, sections 3–5.

Warm-up addresses that deployment cost without changing the 100ms lookup or 100ms cleanup-observation budgets.
A fresh deployment, rebuild, or replacement requires a new owner and its own warm-up.
This correction's tests use finite fake helpers only. Fresh bounded native qualification remains required.

### Identity lookup

The fixed invocation uses the helper path, `[String(originalChild.pid)]`, private cwd, `env:{}`, and `stdio:["ignore","pipe","ignore"]`.
Both `shell` and `detached` are false. The invoker never signals a helper.
Only one helper attempt can exist per owner. Busy calls return null without retry or a queue.

The invoker registers helper ownership immediately after spawn returns, before it awaits anything.
It retains at most 64 stdout bytes and discards non-ASCII or oversized output before copying it.
It accepts only one exact `QMAC1` record with matching PID and bounded integer fields.
Seconds remain decimal text, and microseconds retain all six digits.
The tuple prefix is `darwin-bsd-v1:`.

Success requires helper exit zero and aggregate close before the 100ms lookup deadline.
Error, signal termination, invalid output, abort, and timeout provide no identity.
EOF does not prove process closure. An established helper PID requires both exit and close.
A failed spawn without an established PID requires error and close.

Abort or timeout revokes result authority immediately. The owner continues to observe helper lifecycle without helper-kill authority.
`reconcile()` and `stop()` provide the separate 100ms cleanup-observation budget.
An unclosed helper remains registered after that budget, with `closed:false` and admission disabled.
The clock bounds authority and observation, not kernel scheduling or successful reaping.

## Adapter sequencing

Initial asynchronous identity suppresses bootstrap input until lookup success and current-state validation.
Cancellation, child exit, close, identity loss, or owner shutdown prevents later input.
Each signal stage requires a new lookup and an exact PID/start tuple match.

Each attempt has a generation token and an internal AbortController.
KILL invalidates a pending TERM result, observes the obsolete helper's actual closure, and then starts its own lookup.
Unknown helper cleanup prevents that lookup and all signals from the canceled attempt.
After each await, the adapter verifies the original child, PID, identity, generation, stage, and owner state.
No await occurs between the final checks and the original handle's kill call.

Synchronous Linux behavior remains unchanged.
Plain asynchronous `readIdentity` callbacks remain unsupported because they lack the explicit helper-ownership interface.
The original asynchronous-refusal diagnostic therefore remains valid and unchanged.
The new positive tests cover the explicit owned seam instead of rewriting that diagnostic.

## C source contract and limits

The helper uses SDK declarations, not a copied struct or guessed offsets.
It performs one `proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, ...)` call.
Canonical PID validation precedes that call. The helper rejects its own PID, its parent PID, and privilege elevation.
Exact returned size, PID, parent, effective and real UID, live state, and INEXIT checks precede start-field use.
Seconds must be positive. Microseconds must be less than one million.

The helper writes one bounded ASCII record, with no stderr or raw struct output.
Its explicit return codes are 0 for success, 64 for invocation, 65 for unavailable identity, 66 for malformed ABI fields, and 67 for output failure.
An OS signal can terminate the helper instead. The invoker refuses signal termination as identity.

The SDK calls libproc private and subject to change.
This is a version-pinned SDK/system-ABI dependency, not a guaranteed stable public API.
The retained research uses XNU `xnu-12377.121.6` and SDK `MacOSX26.5.sdk` declarations.
Those sources do not attest to the installed kernel or system-library bytes.

Offline tests inspect C source text and exercise finite fake helpers through the real invoker, adapter, and client.
Static checks are not C syntax, ABI, linkage, return-size, field-validation, or native execution proof.
No JavaScript ABI model substitutes for that missing evidence.
This correction neither repeats nor replaces the separate build evidence.
Successful native QMAC1 grammar, PID equality, tuple stability, and natural-exit closure still require the next approved qualification run.

This contract supplies verification-time PID/start equality only.
It does not supply atomic check-and-signal, collision-free incarnation identity, descendant absence, immediate CLI prevention, or native Docker qualification.
