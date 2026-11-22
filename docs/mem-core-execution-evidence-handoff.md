# Core M3: execution evidence, not source inference

The subsequent [scoped-evidence correction](mem-core-m3-fragments-handoff.md) supersedes this increment's coverage claims.

Base: signed `6a7c4f7ec67eb3abfee6b389edd1c4a75c430e69`.
This change implements the lead's stronger proof contract.
Independent delta review remains required before M3 closure.

## Contract correction

The previous fallback treated a supported source literal as proof of executed inner arguments.
Repeated parser false passes showed that this requirement was wrong.
A source parser cannot establish whether a call executed or which arguments reached the tool.

`memoryTurn` retains source calls only as diagnostics.
Those calls carry `args_source: "source"`, `args_resolved: false`, null output, and unattributable status.
The outer `execute` response never supplies an inner result, even for one parsed call.
The fallback no longer uses dataflow or return-key extraction to borrow outer output.
The existing parser and its diagnostic `parsed` value do not change.
Optional diagnostic parser errors also remain BLOCKED rather than invalidate the evidence pipeline.
Both generic reader files retain their exact base blobs.

Turns also distinguish complete observations from unavailable execution evidence.
Missing or malformed journals and unknown inner execution produce BLOCKED, not a capability failure.
A complete empty journal is authoritative evidence of no calls.
It never triggers a source fallback, and a required missing invocation fails.
The raw journal reader distinguishes an installed observer with no calls from a missing observer frame.
An empty raw log without `guard_start` remains unavailable, not evidence of no invocation.
Parser disagreement cannot convert unavailable execution evidence into a capability failure.

## Trusted observations

Scoped private-hook arguments remain preferred.
The existing journal function requires the actual case, trial, turn, session, activation, pass, call ID, and incarnation.
A unique matching terminal observation supplies argument proof.
Known actual arguments survive a completed or error outcome, as before.
The recorded outcome remains unchanged, so an error cannot satisfy a successful-output assertion.
Missing completion, invalid outcome, malformed identity, duplicate records, or an incomplete tuple remains unverifiable.
The function signatures and journal fields remain stable.
The guard, receipt emitter, creator lineage, and lifecycle implementation do not change.

Official structured direct-tool events can still supply arguments.
Their session and terminal outcome must match the native recording.
Model text, outer output JSON, and model-provided `memoryCalls` fields inside stdout are not native observations.
The existing runner-owned activation wrapper overwrites a client result's `memoryCalls` property with its private observations.
Tests retain this envelope distinction for empty and unavailable observations.

The core argument gate rejects both explicit source provenance and legacy source calls with a `code` field.
Changing only `args_resolved` cannot promote those calls.
Actual known wrong actions still fail, regardless of source text or claimed outer success.
Direct and Code Mode paths use the same scoped public-hook captures in the parity controls.

## Test-first evidence and fixture migration

Both duplicate-prototype strings and a valid literal first reproduced false PASS results.
The correction does not add a duplicate-prototype parser rule.
Those examples now become BLOCKED because source is not execution evidence.
The reader can still classify the malformed source as a diagnostic literal without granting acceptance authority.

The explicit 154-test allowlist remains, with authorized proof upgrades.
The new provenance file adds nine controls and three repeated imported gold tests, for 166 passing tests without skips.
The controls cover identical source with actual correct/wrong arguments, missing and empty journals, fake output, session mismatch, and receipt cleanup.
They also cover incomplete/duplicate native records, unexecuted branches, optional calls, and provenance-flag forgery.

Source-only positive fixtures now expect BLOCKED.
Positive execution claims use actual injected public hooks and their scoped private journal.
The shared fixture accepts explicit native inputs, not source text or expected answers.
The existing native integration fixture adds an explicit activation ID for its real hook observations.
Original wrong-action negatives retain FAIL and gain actual wrong-action captures where their old evidence was source-only.

The copied 27-probe suite tightens one source-only positive from PASS to BLOCKED.
The copied 142-probe suite tightens eleven source-only positives in the same way.
Its output retains every prior expectation explicitly.
No original negative expectation changes, and no source expression supplies argument proof.
The immutable reviewer scripts and prior red logs remain unchanged.
The sibling evidence includes exact migration patches and verifies every changed expectation.

The 273 independent checks retain their result digest and all 38 frozen truth outcomes.
The 830 variations and 15 retained diagnostics still match their expected outcomes.
All 143 frozen archive hashes match.
All 1,512 generic API comparisons remain unchanged.

## Grader identity and remaining gates

`mem-turns.mjs` was absent from the existing grader dependency list.
It now decides this proof contract, so the list appends that file without changing prior entries.
Its transitive local dependencies already belong to the actual CLI digest inventory.
No new runtime module or package dependency is added.
The new shared helper is test-only and is never imported by runtime or grader code.
The exact new digest and isolated sensitivity checks are recorded in the sibling verification report.
Compile/offline locks remain untouched for their separate owner.

Reviewed M4, H2 receipt/codec, and M6 permission/creator closure remains offline only.
Their guard, emitter, durable/Markdown/payload, and creator blobs remain unchanged.
This correction does not accept discovery completeness, known discovery-base issues, real-host behavior, authorization, containment, paid scores, or release.
The lead owns the retained worktree and bounded evidence for independent review and later integration.
