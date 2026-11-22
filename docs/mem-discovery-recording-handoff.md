# Discovery recording lineage and contradiction precedence

Base: signed `21005bbb6d3527fcbf49bfff2f5c68b201afed9f`.
This increment addresses residual Standards H/S1-R1 and M/S3-R1.
It does not accept the earlier SPEC work or merge the separate S2/S4 and core/guard work.
The lead owns independent review at the new signed pin.

## Private interface

`projectMemoryRecording(rawLines, source)` parses one private native recording.
The CLI supplies `source.case_id` and the physical trial selection from its case-file selection.
These values are not caller headers or claims from the model.
Discovery is a single-native-run, single-turn contract.
The proof turn index and backend context must both identify that turn.
The recording supplies the actual per-event sessions and ordered invocation identities.

The parser uses the existing `parseEvents`, `summarize`, `extractInnerCalls`, `parseFirstJson`, and `memoryTurn` codecs.
It never evaluates JavaScript or runs a model.
The typed projection contains:

| Field | Private fact |
| --- | --- |
| `source` | Native CLI case and physical trial selection |
| `raw_sha256` | SHA-256 of the actual JSONL joined exactly as the official codec joins it |
| `sessions`, `text_session`, `text` | Actual event sessions and final recorded answer |
| `calls` | Actual ordered Memory calls, identities, typed arguments, statuses, outputs, and digests |
| `trace` | Structural call lineage for comparison with the normalized trace |
| `issues` | Bounded parser or attribution conditions, without private values |

`runView(..., {memoryRecording})` carries this projection as a non-enumerable private property.
Only Memory discovery clauses receive the projection in CLI grading.
Other plugins retain their existing evidence-loading behavior.
The ordinary trace, vocabulary, argument redaction, and generic grading defaults remain unchanged.
The projection never enters verdicts, ordinary JSON/debug enumeration, or diagnostics.

## Reconciliation

The actual JSONL digest must match the official trace source digest.
Each actual call has a native call identity and an ordered position.
Duplicate call identities, duplicate part identities, replays, and inconsistent identity digests fail.
The existing native proof omits per-call IDs, so its ordered tuple is reconciled with the actual recording.
That tuple includes tool, argument digest, status, output, and the native turn session.
Optional identities present in a proof must also match.
No ID is invented when the actual recording lacks its required identity.

The validator also reconciles all normalized call positions, parent links, argument digests, and outcomes.
It rejects duplicate result events and mismatching recorded outcomes.
Argument digests retain the official `sha256(JSON.stringify(arguments))` codec and recorded key order.
No sorted canonical digest or redacted argument shape replaces the actual argument digest.

The actual final answer must satisfy the case truth contract and agree with the proof answer.
Only leading and trailing whitespace is normalized.
Actual sessions must agree across the recording, private proof, backend observations, and creator evidence.
A successful proof cannot credit a foreign or failed actual recording.

Missing lineage is BLOCKED.
Present contradictions are FAIL.
Complete recordings without the expected call or backend operation remain FAIL.
This includes the eight baseline missing-tool cases.

## Code Mode execution evidence

A source call site alone does not establish execution.
The bounded supported inner form is a sole returned unconditional await with an attributable recorded result.
The argument literal is parsed by the existing codec, not evaluated.
The projection binds that result to the containing call identity and normalized parent.

Conditional, multi-site, or other unattributed programs require native per-inner execution evidence that this recorder does not supply.
They are BLOCKED, not credited as successful executions.
The existing `unattributable` status means missing attribution, not an observed tool error.
An explicit native `args_resolved:false` still fails the discovery contract.
Actual errors and known no-data outcomes remain FAIL.
No runner, guard, or source-plugin changes were made to manufacture missing receipts.

## One validation reduction

The adapter now evaluates predicates only when their own required fragments are available and well typed.
It records both known contradictions and unavailable fragments.
It makes one final choice: FAIL before BLOCKED before PASS.
There is no preliminary missing-artifact return before the state or invocation checks.
Expected facts never fill an unavailable actual artifact.

For example, available seed and poststate can prove an unexpected shared write without a guard log or answer.
The same rule applies to unauthorized personal content, closed payloads, unresolved invocations, failed output, and foreign sessions.
Backend and creator sessions are compared with the actual recording even when the proof turn is unavailable.
Malformed nested values fail without unsafe dependent dereferences.

## Tests and fixture migration

The original reviewer source and artifacts remain immutable.
The owned red run reproduced all three real-CLI false passes and all 144 FAIL-to-BLOCKED counterexamples.
Separate upgraded copies add only legitimate synthetic recording identity, source digest, and private-projection plumbing.
Their negative expectations remain unchanged.

The new pure CLI matrix covers all 24 cases in direct and inner modes: 48 positive and 144 contradictory recordings.
Actual recordings are captured independently before private-proof mutations.
Additional controls cover order, identity, replay, outcomes, unsupported execution attribution, and privacy.
One unit matrix checks 3,496 contradiction-plus-independent-absence combinations without spawning per-case processes.

All original 79 units, 2,218 SPEC controls, 2,617 S3 controls, 273 core controls, and 792 reviewer assertions remain passing.
The new recording suite has seven passing tests with the larger matrices inside them.
The residual reviewer requirements have two passing assertions.
The generic CLI/grader/analyzer/privacy/trace suites have 37 passing tests with zero skips.
Their private replay is synthetic and temporary, not a source recording or catalog measurement.

Compilation remains 62 cases and 74 items.
All 143 archive hashes, 38 core contracts, and 48 frozen discovery artifacts remain unchanged.

## Hash inventory and integration

The inventory preserves every prior entry and adds the new private helper, its newly consumed codec dependencies, and the CLI projection loader.
The additions are `mem-recording.mjs`, `mem-turns.mjs`, `innerArgs.mjs`, `resultCounts.mjs`, and `src/cli.mjs`.
Existing analyzer and grader modules were already in the effective grader hash.

The four older S2 closure omissions on this branch remain known and unmerged.
Integration must union the separately reviewed S2/S4 entries and immutable-plan implementation, not replace either inventory.
Core f846 and other guard work remain outside this branch.
The combined lock must be refreshed only by the integration owner, with unrun/runtime flags preserved.

These pure results are implementation evidence, not runtime readiness, independent acceptance, or permission to integrate.
