# Discovery Standards S3 classification

Parent: signed `2d6d8ca53607ada28c0c58e03293cd3b65ab0709`.
The signed history from `63e89a0cb2625f01f4288f9f5eadc3e7b8d640bf` remains intact.
This increment addresses only missing-artifact classification in the discovery adapter.
The previous SPEC H1/M2/M3/M4 corrections still await independent review.
Standards S2/S4 and separate core/guard corrections are not included.

## Contract

`CONTRIBUTING.md` requires BLOCKED when a clause cannot be settled.
The grading contract in `docs/design.md` maps adapter `unverifiable` to native BLOCKED.
The adapter now distinguishes unavailable artifacts from supplied contradictions and recorded behavior failures.

| Evidence condition | Previous result | S3 result |
| --- | --- | --- |
| Missing capture or discovery capture | FAIL | BLOCKED |
| Missing state, seed, native, backend, creator, or guard artifact | FAIL | BLOCKED |
| Unsupported numeric capture, discovery, or suite version | FAIL | BLOCKED |
| Unavailable case contract | FAIL | BLOCKED |
| Missing official raw recording text | Native clause could pass | BLOCKED |
| Missing trace argument digest | BLOCKED | BLOCKED |
| Supplied malformed digest | BLOCKED | FAIL |
| Established digest mismatch | BLOCKED | FAIL |
| Redacted argument forgery with missing digest | BLOCKED | FAIL |
| Complete native recording with no required call | FAIL | FAIL |
| Complete backend recording without the required operation | FAIL | FAIL |
| Wrong or empty recorded answer | FAIL | FAIL |
| Foreign, inactive, denied, error-bearing, or contradictory proof | FAIL | FAIL |
| Complete official-normalizer positive | PASS | PASS |

Missing fields represent unavailable artifact fragments.
Empty supplied recordings and malformed supplied fragments do not represent unavailable artifacts.
An absent guard log differs from a supplied empty guard log.
An absent backend output differs from a recorded empty response.
The adapter reports a bounded cause without raw argument content.

Known contradictions take precedence over missing fragments when the available evidence proves the contradiction.
For example, a missing state artifact does not hide a foreign session, digest mismatch, denied observation, or known wrong answer.
A missing digest does not hide an unauthorized state change or a failed output.

The state adapter can discard invalid capture files.
The discovery adapter inspects supplied file bytes only to classify the evidence.
It never repairs the missing state result or converts those bytes into a PASS route.
No expected truth, answer, or source code fills a missing authoritative artifact.

## Tests and migration

The first test reproduces the exact reviewer missing-capture construction through `gradeCase()`.
Before the correction, its BLOCKED assertion fails because the actual result is FAIL.
The new tests use the real clause registry, official normalized traces, and native case verdicts.
The pure CLI test calls only `main(['grade', ...])` over temporary synthetic files.
It does not start a listener or run a model.

All 24 cases retain direct and inner-call positive controls.
Complete recordings without expected calls remain FAIL, including the eight baseline missing-tool cases.
HTTP deny controls, argument redaction, exact state checks, and read lifetime controls remain intact.

The original 2,218 focused controls retain every test.
Three expectations per direct/inner case tighten from BLOCKED to FAIL: malformed digest, different digest, and redacted argument forgery.
That is 144 stronger failure classifications, with no PASS conversion.

The original reviewer scripts and their earlier results remain unchanged.
A separate task-owned probe copy changes only the dropped-discovery-artifact expectation from FAIL to BLOCKED and its output filename.
All 732 comparisons and 60 read assertions remain present.
Exactly 48 dropped-artifact comparisons change classification.
No behavior-failure expectation changes to BLOCKED.

The follow-up changes no static imports or dependency inventory.
The known dependency-closure and mutable-registry findings remain for the independent S2/S4 work.

## Verification

The task evidence contains exact commands, red/green TAP files, CLI results, integrity checks, and cleanup evidence.
The substantive checks are the explicit 79-unit allowlist, 2,218 existing focused controls, new S3 controls, 273 core controls, and 792 reviewer assertions.
The new S3 suite has 2,617 passing tests, including the pure CLI check of 11 exact classifications.
All suites report zero skips.
Compilation still reports 62 cases and 74 items.
All 143 archive hashes, 38 core contracts, and 48 frozen discovery files remain unchanged.

The lead owns review of the cumulative discovery delta at the new signed pin.
These implementation results are not acceptance or runtime readiness evidence.
