# Discovery SPEC corrections from 63e89a0

Base: `63e89a0cb2625f01f4288f9f5eadc3e7b8d640bf`.
This increment addresses independent discovery findings H1, M2, M3, and M4.
It does not include the separate core corrections in f846.
The lead owns integration and independent review.

## Changed behavior

H1: The discovery grader binds private typed arguments to `args_sha256` from the official normalizer.
The codec uses `sha256(JSON.stringify(arguments))`, with recorded key order.
It does not use sorted canonical JSON or redacted argument shapes.
Missing, malformed, or different digests produce an unverifiable result.
The trace privacy policy and global normalizer remain unchanged.

M2: A successful write requires the full personal state to equal the seed plus exactly one authorized object or file.
The grader no longer exempts a whole durable family.
Stored IDs require matching native creator evidence.
The finite record projection permits only explicit, content-bound source metadata from the actual wire input.
The permitted metadata covers type, title, stated-by enum, native session, and the exact commitment fields.
The backend adds only its ID, current status, and version 1.
Unknown fields, timestamps, scope expansion, extra objects, and unrelated changes fail.

M3: Each observation requires HTTP 200 and its typed success status: `read` or `stored`.
Error-bearing and conflicting failure envelopes fail before content assertions.
Native errors also fail.
A stored source request can await confirmation without becoming an account binding.
A stored job remains an inactive draft with no next due time.

M4: Every content read and write requires an active native case, trial, turn, and session within the intent lifetime.
Fake permission must be `allow` or `ask-approved`.
The store pins the established native session for its single-turn lifetime.
Missing context never falls back to a prior context.
The HTTP codec rejects a caller session that differs from the supplied native context.
The four exact bootstrap routes expose only bounded metadata and use the same lifetime validation.
Health metadata remains separate from content.

The synthetic context is a native-owner input at this pure seam.
It is not real backend authorization or proof of actual host permission behavior.
No per-read guard receipt requirement was added because the pinned guard emits receipts only for writes.

## Fixture migration

The previous positive tests used handwritten traces with unredacted arguments.
The tests now use real `events()` output and legitimate native contexts for fixture lookups.
The new flow helper also uses `memoryTurn()` for direct and inner-call positives.
Denied fixture flows stop before forbidden lookups.
No negative assertion, human prompt, answer, or actual run log was relaxed or changed.

The original reviewer probe remains unchanged in the retained task evidence.
A separate probe copy replaces only handwritten fixture traces with official normalized traces.
It preserves the original observations, mutations, expected verdicts, and all 60 read-boundary observations.
The safety wrappers assert outcomes rather than treating diagnostic exit zero as success.

## Pure check results

The initial safety wrapper reproduced 132 discrepancies among 732 scorer comparisons and 60 exposed read responses.
Its result was 600 passes and 192 failures.

Final results:

| Check | Result |
| --- | --- |
| Existing explicit 24-file unit allowlist | 79 pass |
| New discovery scorer and lifetime tests | 2,218 pass |
| Unchanged copied core safety controls | 273 pass |
| Migrated reviewer comparisons and read assertions | 792 pass |
| `node bin/evals compile --plugin mem --check` | 62 cases, 74 items |
| Syntax checks of nine changed modules | Pass |
| `git diff --check` | Pass |
| Archive manifest | 143 hashes unchanged |
| Core contracts | 38 unchanged |
| Frozen discovery source and compiled files | 48 hashes unchanged |

All test suites report zero skips.
The retained `checks.sh` contains the exact explicit allowlist and isolated environment.
The focused command is:

```sh
node --test --test-concurrency=1 test/mem-discovery-spec.test.mjs test/mem-discovery-lifetime-spec.test.mjs
```

## Integration limits

This branch changes only the discovery adapter, its digest dependency inventory, the finite store, the HTTP codec, focused tests, and this handoff.
The original checkout remains outside this increment.
The guard, runner, core grader, baseline proof, archive, and global trace modules remain unchanged.

The lead must combine this increment with the original author's independent core and guard corrections.
That combined change requires a separate review and its own checks.
Actual model trials, runtime catalogs, public clients, authorization, permission resources, and teardown remain unrun gates.
These pure results do not establish runtime readiness.
