# Core oracle handoff: H1, H2, M6, M7

Base: `acdcf7c0a8e11c85b03c8479099379b689a54de2`.
This change contains offline oracle corrections, not runtime approval.
Independent review remains pending.

## Implemented seams

H1 validates the complete initial snapshot against the bound frozen seed on every core path.
Unknown initial fields remain visible and cause failure.
The validator permits only explicit atom metadata, projected scope, RAW versions, and derived file references.
Atom metadata consists of a generated ID, version 1, and ISO timestamps.
Frozen values take precedence over generated metadata.
The validator never derives expected content from the actual initial snapshot.

H2 retains the actual HTTP session in each wiki operation.
Missing or foreign sessions cannot inherit the current native session.
Bound operations require an active native call, matching case, trial, turn, session, family, and an unexpired intent.
The recorder applies the same binding requirement to creator authority.
The wiki oracle requires the binding fields in its operation proof.
Old snapshots without those fields cannot pass that oracle.

M6 accepts a `Core Notes` heading, blank-line padding, block quotes, and bounded emphasis around each exact literal paragraph.
The append still preserves the initial bytes, digest chain, revision sequence, document identity, and private scope.
The pure `coreWikiIntentPayloadMatches(expected, actual)` validator permits the same presentation contract.
All other payload fields remain exact.
The validator rejects unknown fields and unrelated content.

M7 includes `mem-durable.mjs`, the Markdown helper, and the canonical helper in `ADAPTER_FILES`.
The dependency test traverses local adapter imports.
The digest test runs the actual pure `graderHash()` function against an owned file copy.
A change to only the durable oracle changes that hash.
No provenance comparison override occurs.

## Integration blockers outside this assignment

**M6 is not closed at the permission seam.**
The prohibited `src/run/guard/mem-intents.mjs` still uses exact payload equality.
Its owner must call the new validator after the existing case, trial, turn, session, and created-ID checks.
The call must remain limited to the sealed `core-wiki-write` intent and wiki family.
Creator validation also compares exact creation arguments in `baseline-proof.mjs`.
Combined create-with-content requires the same presentation check there, without changing the stored actual creator arguments.
That file was restricted to HTTP-session observation changes in this assignment.
No current production caller uses the new payload validator.

**Runtime H2 proof remains gated.**
The prohibited guard currently emits active-call receipts only for writes.
Its owner must emit and clear legitimate read receipts before runtime reads can satisfy the stricter recorder.
The later source transport must forward the actual session header.
Neither source transport nor guard lifecycle changes belong to this assignment.
Missing receipts fail closed rather than borrow model results.

M3 and M4 remain open under the other owner.
The diagnostic retains their two discrepancies and exits 1.
Discovery coverage, source authorization, runtime containment, paid evaluations, and release remain outside this change.

## Offline evidence

The explicit 24-file Memory allowlist passes 80 tests with no skips.
This count includes the existing aggregate of 38 literal gold cases.
The copied independent controls pass 273 tests with no skips.
Their comparison JSON retains SHA-256 `4e3d5163a7d12e01af245ced11e9d5de2a9895df5743808c0212a41dfb2dc1f5`.
All eight assigned discrepancies match their expected offline verdicts.
The other five sanity controls still match.
Those verdicts do not close the M6 integration blocker.

All 143 frozen archive hashes remain unchanged.
The independent script deeply compares all 38 frozen declarations with the archived pure declarations.
No prompts, seed facts, assertion parameters, or expected answers change.
Synthetic fixture extensions add explicit binding evidence only.
No runtime module imports the synthetic proof helper.

The lead retains the separate worktree and sibling evidence directory for review and integration.
The evidence directory records red tests, green tests, import audit, migration patches, commands, and cleanup results.
No host listener, provider, model, container, production service, or credential database ran.
