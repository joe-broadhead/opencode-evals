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

## Synthetic test support

The finite-store fixture records each completed operation and its returned output before conversion.
Its private proof now retains that operation list instead of source diagnostics from `memoryTurn`.
The fixture does not use an expected verdict, answer, or case payload to replace an observation.
Existing probes can reuse those observations without turning unavailable source outputs into a synthetic journal.

The new source-diagnostic tests call the real converter separately.
Thus the fixture correction does not remove coverage of the core/discovery interface.
Neither fixture form represents a real native run.

## Inventory and remaining gates

The combined grader inventory remains unchanged at 38 unique inputs.
No new production import requires another input. Dormant observer modules remain outside the consumed grader closure.
Separate preservation evidence covers their bytes.

The original M7 adapter-only assertion fails on `src/trace/analyse.mjs`.
The CLI already includes this file in its common grader inventory.
The assertion, inventory, and frozen locks remain unchanged. Lead disposition is required for this combined validation gate.

Fresh independent review remains required. Native trusted wiring, authority, launcher, and real-host qualification remain separate gates.
