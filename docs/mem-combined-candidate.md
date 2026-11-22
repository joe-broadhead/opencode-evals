# Combined Memory candidate: offline integration

This document describes candidate assembly, not acceptance of the discovery delta or runtime approval.
The signed merge retains discovery `63e89a0cb2625f01f4288f9f5eadc3e7b8d640bf` and cleared core `f846f27f915a2f83a95481f58812979917133406`.
Their common base is `acdcf7c0a8e11c85b03c8479099379b689a54de2`.
The only merge conflict was the adapter digest list. The resolution retains both sets of dependencies.

## Integration closure map

| Finding | Implementation | Offline evidence |
| --- | --- | --- |
| M3 typed arguments | `mem-arguments.mjs`, `mem-turns.mjs`, and the core argument predicate | Unresolved spreads, nested markers, aliases, and computed arguments remain unverifiable. Closed literal and actual native arguments pass. |
| M4 closed-turn replay | The guard tracks turn incarnations and consumed invocation identities | Closure, transition, repeated closure, reused calls, replay, and foreign sessions cannot restore a call. A fresh permitted turn remains valid. |
| H2 read receipts | The guard records permitted reads and writes, with actual context, call identity, expiry, and pass state | Missing or foreign HTTP sessions remain unbound. Deny, pending ask, completion, cancellation, and teardown clear receipt authority. |
| Native continuation | The runner provisions the session before activation and records a fresh activation ID | Private hook arguments take precedence over source literals. The finalizer closes and clears on success and exception. Memory retries cannot reopen the old seal. |
| M6 presentation | The guard and creator comparison call the cleared core payload validator | Only sealed `core-wiki-write` payloads gain the constrained presentation alternative. Other fields and discovery payloads remain exact. |
| Packaging and digest | The isolated copies relocate only static imports. The grader inventory includes all imported helpers | The staged validator imports work without external files. Changes to executable grader dependencies change the actual grader hash. |

The native hook journal supplies actual typed arguments. It does not derive arguments from a case expectation or an answer.
The source fallback uses a literal reader, never JavaScript execution. Parse success alone does not prove resolution.
The frozen action predicates inspect the root action, not comments, strings, or nested metadata.

The receipt exists only during its permitted call window. Its private file and journal are not model tools.
The recorder uses the original HTTP session header. A sidecar cannot substitute its current session for a missing header.
The source archive declares session forwarding through `scopeHeaders`. Actual host forwarding and reload behavior still require runtime evidence.

The presentation validator runs after sealed context and resource resolution.
Creator aliases require the observed backend identifier, actual creation arguments, call identity, and registered private scope.
The recorder retains actual document bytes and digests. It never normalizes the stored prefix or readback.
The cleared H1 seed checks, durable truth checks, and Markdown helper remain unchanged.

## Candidate source inputs

Release commit: `772bf914c71e6d0fcb4d7016d2f9b614e2af467d`.
Approved archive: `joe-broadhead-opencode-mem-0.15.14.tgz`.
Archive SHA-256: `50b88966af9bf5e358f85b8a33600b9b44d07503a708ba24d934555fd4e6368d`.

`packs/mem/candidate-772bf914` preserves the supplied static schemas, first-117 descriptions, and binding inputs.
All 24 discovery arguments validate against both static registration modes.
These files are not runtime registered sidecars or catalog observations.
The baseline 586 catalog, historical 548 schemas, source commits, and earlier evidence remain intact.

The versioned discovery lock remains explicitly unrun and excludes final comparison approval.
It retains the prior 63 compile identity and all original prompt-repair hashes.
No further human prompt, frozen assertion, seed fact, or expected answer changes.

## Remaining gates

The discovery verdict and an independent review of this combined integration remain required.
Real host registration, search, reload, native session forwarding, and permission behavior remain unrun.
Containment, source authorization, authentication, price caps, provenance comparison, and CI remain separate gates.
No VM, container, listener, host OpenCode, harness model, provider, or paid trial ran for this assembly.
