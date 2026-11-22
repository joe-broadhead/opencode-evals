# Discovery consumer reconciliation

This change reconciles the approved core and discovery consumers. It adds no native observer wiring, authority producer, or launcher.
Runtime readiness remains false.

## Evidence contract

`memoryTurn` reports Code Mode source sites with `args_source: "source"`.
These rows describe syntax, not executed calls. Discovery excludes them from private invocation checks.
The independent recording still supplies execution evidence.

A turn with excluded source rows cannot establish an exhaustive private call inventory.
The same restriction applies when `calls_complete` is false, including a turn with no source sites.
Neither case overrides a complete independent journal or supplies a missing journal.

Actual captured rows remain evidence. An unresolved actual argument remains negative under the existing contract.
Missing actual arguments remain unavailable. A known contradiction still takes precedence over missing evidence.

For partial inventories, direct-event copies match the ordered direct recording.
Other captured rows require a call identity. Missing identities block credit, and duplicate identities fail.
Tool, arguments, status, output, and supplied identity fields still require agreement.

The existing checks retain complete-empty semantics, journal scope, digest binding, reciprocal mutation counts, and read-only mutation rejection.
Core conversion and grading semantics do not change.

Public inner trace rows also describe source sites, not actual executions.
Their raw-derived signatures still bind count, sequence, tool, arguments, parent, and duplicate-result structure.
They do not require execution outcomes. Carrier, direct-call, and independent journal outcomes still require the existing checks.
An incomplete or missing journal still blocks credit. Actual errors and backend rejections still fail.

C1 changes the earlier source-only mutation test from BLOCKED to PASS only with complete independent actual coverage.
The migrated test verifies unchanged journal operations, projected observations, and scope after the source-only edit.
The original assertion treated an extra source site as an unavailable invocation outcome.
That interpretation conflicted with the combined rule that source diagnostics cannot veto independently recorded execution.
No actual missing-status, missing-identity, incomplete-journal, failed-carrier, or backend-mutation expectation changes.

## Synthetic test support

The finite-store fixture records each completed operation and its returned output before conversion.
Its private proof now retains that operation list instead of source diagnostics from `memoryTurn`.
The fixture does not use an expected verdict, answer, or case payload to replace an observation.
Existing probes can reuse those observations without turning unavailable source outputs into a synthetic journal.

The new source-diagnostic tests call the real converter separately.
Thus the fixture correction does not remove coverage of the core/discovery interface.
Neither fixture form represents a real native run.

## Inventory and remaining gates

At the semantic correction, the combined grader inventory contained 38 unique inputs.
The original M7 assertion failed because it checked adapter membership alone.
`src/trace/analyse.mjs` was already a common input.

M7 now obtains membership by executing the extracted pure `graderHash` function with a recording file reader.
It does not import the CLI or maintain a second expected inventory.
The test derives loader roots from imported functions that `gradeAll` calls, including its default paths.
It follows all local module imports from those roots and the existing continuation/intent proof seams.
Thus it includes actual grading imports but does not traverse unrelated CLI run/auth/container imports.
The CLI itself remains a hashed entrypoint artifact, including its local loader helpers.
This is a module-level closure, not a claim that every export in each module runs during grading.

That broader loader/verdict closure found 11 genuinely missing inputs:

| Inputs | Grading dependency |
| --- | --- |
| `src/run/accounts.mjs`, `src/case/schema.mjs` | Account exceptions and seed-plugin classification |
| `src/run/lockdown.mjs` | Pack loading and write classification |
| `src/store.mjs` | Recording, target, and canary locations |
| `src/run/guard/logic.mjs` | Created-identifier shape used by target evidence |
| `src/fake/facts.mjs`, `src/fake/fixtures/github.mjs`, `src/fake/fixtures/jira.mjs`, `src/fake/fixtures/when.mjs` | Fixture evidence and its transitive fact definitions |
| `src/pack/from-plugin.mjs`, `src/pack/snapshot.mjs` | The loader's snapshot reader and its transitive module import |

Only these inputs were added. The inventory now contains 49 unique inputs, so the grader digest changes.
No input was duplicated or reordered. No runtime grading behavior or frozen lock was changed.
M7 changes each hashed input independently in a disposable copy and verifies hash sensitivity and exact restoration.
Negative controls omit each consumed module from the extracted hash function and verify that closure validation rejects the omission.

Dormant observer modules remain outside the consumed grader closure. Separate preservation evidence covers their bytes.

Fresh independent review remains required. Native trusted wiring, authority, launcher, and real-host qualification remain separate gates.
