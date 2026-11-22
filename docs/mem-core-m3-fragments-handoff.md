# M3: scoped evidence and independent predicates

Base: `d6a76eeea7567c819ab35d6e9a48905cd0c2e01e`.
This increment corrects the four SPEC findings and the additional Standards findings.
Independent review remains required.
This document supersedes the coverage claims in [the earlier handoff](mem-core-execution-evidence-handoff.md).

## Evidence rules

The journal reader accounts for every scoped start and terminal record.
A valid pair cannot hide an orphan terminal or a malformed start.
Orphan arguments and status remain diagnostic data, without a false resolved flag.
Valid independent pairs remain available when another record is incomplete.
A malformed array entry cannot erase an independently established wrong action.

Global startup does not prove observation coverage for a turn, session, or activation.
Foreign-only records and startup-only records therefore remain unavailable.
An explicitly supplied authoritative empty array still means no invocations.
It never falls back to source or direct events.

An absent or undefined journal permits independently valid structured direct events.
Their input must be an object, their session must match, and their status must be terminal.
Missing session, missing status, and malformed input cannot certify a complete turn.
The adapter reads the original event input, not the generic summary's default empty object.

The core adapter evaluates known assertion failures before unresolved obligations.
Known wrong actions and forbidden durable changes remain FAIL despite unrelated missing coverage.
Unknown direct metadata remains BLOCKED unless another predicate establishes a failure.
Source diagnostics supply no execution, count, arguments, status, or output authority.

The Memory adapter no longer compares actual calls with generic source-derived trace sites.
Alias calls and dead source sites cannot veto the same actual native capture.
The regression crosses the real generic normalizer and grader interfaces.
It does not construct the trace from observed calls.
The generic trace modules remain byte-identical.

## Recall capture

The guard classifier recognizes only the exact `mem_recall` and `mem.recall` names.
It uses the committed pack's read classification.
The classifier requires an object input, known recall keys, and a nonempty query.
Unknown actions and malformed input do not acquire read authority.
Existing scope, session, permission, replay, and write-intent enforcement remain unchanged.
Neither the hook implementation nor the runner changes.

The hook regression uses the committed pack and injected public callbacks.
It checks direct and inner consumers, actual input/output, foreign sessions, replay, and denied writes.
These are offline synthetic observations, not proof of native runtime delivery.

## Test evidence and explicit corrections

The unchanged SPEC probes reproduced 19 discrepancies among 72 comparisons at the exact base.
The unchanged Standards probes reproduced their assigned discrepancies before implementation.
The final focused suite passes 104 tests with no skips.
The retained safety, native, edge, diagnostic, and generic corpora pass 273, 27, 142, 15, and 1,512 checks respectively.
All 38 frozen contracts retain their deep equality check.
All 143 archive hashes remain unchanged.

The original probe files remain immutable outside the worktree.
Owned copies explicitly correct startup-only coverage expectations to BLOCKED or unavailable.
The foreign-only test expectation changes from FAIL to BLOCKED because absence of scoped observation is not a product failure.
Two existing tests also replace foreign-context `[]` expectations with `undefined`.
The native corpus replaces its foreign-array length assertion with an unavailable-result assertion.
No actual wrong-action FAIL expectation changes.

The retained safety fixture had concurrent module imports that modified the same hook environment.
Its wrong-action capture contained only startup when the other fixture removed that environment.
The owned test driver now imports the second fixture after the first completes.
The original attack input, capture implementation, and FAIL expectation remain unchanged.
Separate before/after capture logs record this fixture correction.

## Remaining producer gate

The current producer cannot prove complete-empty coverage for the full scope tuple.
This increment does not invent scope markers from startup, source, expected cases, or a filtered empty list.
A future trusted producer must explicitly prove observation coverage for case, trial, turn, session, and activation.
Missing coverage must remain BLOCKED.

The native sidecar, raw-byte binding, carrier association, and full capture coverage remain separate integration work.
This increment creates no guessed carrier linkage and makes no runtime claim.
The runner, discovery contracts, plans, worlds, frozen cases, and locks remain unchanged.
All three changed runtime modules already belong to the 33-input grader inventory.
No inventory replacement, package dependency, or lock refresh is necessary here.

The lead owns the retained worktree and sibling evidence until review and integration finish.
The evidence contains exact commands, red/green logs, migration patches, integrity checks, and cleanup verification.
