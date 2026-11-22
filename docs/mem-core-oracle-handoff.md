# Core oracle handoff: H1, H2, M6, M7

Base: `acdcf7c0a8e11c85b03c8479099379b689a54de2`.
This change contains offline oracle corrections, not runtime approval.
Independent review remains pending.

## Incremental M6 presentation correction

The independent review of `39427e926fb575a101b561cec50a4e491c433c25` found six presentation discrepancies among 830 comparisons.
CRLF titles, second-level ATX titles, and Setext titles each failed the durable oracle and pure payload matcher.

The helper normalizes CRLF and lone CR line endings in a validation-only copy.
It permits one exact `Core Notes` title as an ATX heading at levels 1 through 6.
It also permits an exact-title Setext heading with an equals or hyphen underline.
The existing 512-character input bound remains unchanged.
Duplicate titles, title-only content, altered paragraphs, unrelated prose, links, HTML comments, and extra instructions still fail.

The correction changes no stored or observed bytes.
The focused controls retain actual CRLF digests and the initial append prefix.
Normalized-byte digest, prefix-replacement, and normalized-readback controls still fail.
The durable oracle, seed checks, session binding, resource links, revisions, and private scope remain unchanged.

The copied reviewer probe changes from 824/830 matching comparisons to 830/830.
The focused tests change from 5/12 passing to 12/12.
The original 24-file allowlist plus the focused file passes 92 tests without skips.
This count includes nine new tests and three repeated gold-module tests from the focused import.
The 273 independent controls and all 143 frozen hashes remain unchanged.
The M3/M4 diagnostic still exits 1 for exactly those two excluded findings.

The M6 permission/creator integration and H2 read-receipt/transport gates remain open.
The pure payload matcher benefits from the helper correction, but no production caller invokes that matcher.
Independent delta review remains pending.

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
