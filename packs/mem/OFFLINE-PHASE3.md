# Memory offline phase 3

This increment uses accepted Memory commit `586dc46a133cada64c584b0506eb3aebbd906b24`.
The user authorized reads of its tracked synthetic contracts from local Git.
The primary checkout remained read-only. No remote authentication lookup occurred.

## Frozen artifacts

`worlds/mem/baseline-586/manifest.json` records every archived path and SHA-256.
It also records the accepted source commit and its role as synthetic contracts.
The archive contains the actual records store, shared modules, service interface, and tracked stub.
It is not a baseline release tarball.

The core source SHA-256 matches the required value:
`614dc70d7636b8a81d05cdef67fc0e0a73b1141ff13dc0c59a012249a67262fd`.
`freeze-core.mjs` imports only this audited, declarative source.
It serializes the original seeds, prompts, regex parameters, assertions, and fresh-session boundaries.
Seed scope fields remain parameterized until the native fixture binds them.

The experimental `ac333` archive remains a separate evidence artifact.
Its SHA-256 is `4fde31d5dac5d0bb059448c49ebe6e28f277d949fc2fd6fa7d0048bc50a00708`.
Its abbreviated source reference is not a full source pin.
The increment does not label this archive as the baseline or final candidate.
It retains verified archive bytes but does not claim a materialized, executable arm.

## Core ports

All **38 core contracts** have literal native ports. No core identity lacks truth.
The evidence adapter implements every assertion type that these contracts use.
The adapter reuses only pure answer-language helpers from the immutable scoring contract.
It never calls `scoreAssertions`, `parseRun`, or the legacy runner.

Gold controls exercise the native compiler and grader.
They include wrong answers, absent calls, fabricated outputs, wrong scope, and malformed session continuation.
Write controls reject no-op, queued, denied, partial, and unsupported outcomes.
The durable oracle reads actual state separately from tool output.
Whole-answer rules inspect nested evidence for privacy leaks and guesses.

The native continuation adapter sends each original prompt separately through the existing runner client.
It preserves the session within a case and creates a fresh session at the frozen boundary.
It shares one trial deadline across turns and retains provider errors.
It records native tool output only when attribution is possible.
Unattributable multi-call output cannot satisfy an evidence assertion.

Compilation and gold controls do not establish runtime compatibility or a live eval pass.
All runtime cases remain deferred.

## Fixture and permissions

Host preparation only stages files.
The contained entry selects the actual baseline stub and control contracts for core cases.
The staged derivative removes only the stub listener-autostart tail and exports lifecycle methods.
The original archived server remains unchanged and is never imported on the host.

The gateway routes only to the contained stub and control modules.
The control module derives records identity from public space and session fields.
The gateway discards caller-supplied `x-records-*` identity.
Local mode permits only its fixed local scope.
Records state and wiki state produce scope maps for actual created IDs.

HTTP success alone does not produce a stored receipt.
The receipt adapter compares the response with independent durable readback.
It handles the actual wiki `files` array and records forget `ids` array.
An empty forget, incomplete file write, or queued response fails durable success.

The guard refreshes created-ID scope from the contained authority, not from model output.
The host responder uses documented `permission.reply` decisions: `once` or `reject`.
Approval requires an active scoped call, matching source, session, action, and resources.
Explicit deny remains deny. Foreign asks receive rejection.
Generic plugin policies retain the upstream responder.

Offline tests call the real records store and adapter without listeners.
They verify private reads, wrong-space absence, invalid role rejection, source request state, and inactive job drafts.
A hook stand-in verifies reply construction but does not represent a real OpenCode permission prompt.
The default world remains closed until a separate runtime assignment.
Per-case write-plan authorization still needs integration before a live write wave.

## Discovery map

All **24 prompts** appear in `discovery.mjs`.
The map defines 22 backend contracts from the baseline routes.
The two remaining semantic gaps are `deep-mem-skills` and `deep-mem-skills-p`.
The baseline stub supports skill list/get/create/update/delete, but not stored-skill version history.
The map leaves these cases unsupported instead of inventing an endpoint.

The accepted source catalog binds 12 prompts to closed inputs.
The other bindings remain parameterized by immutable arm and final captured catalog.
Candidate arms cannot inherit baseline bindings implicitly.
The final combined candidate and its closed read schemas are not yet available.
Code-graph and wiki-graph route mappings still require contained execution proof.
This is not a completed 24-case runtime discovery suite.

## Remaining gates

The release validator still requires genuine release metadata and actual runtime sidecars.
No `registered.json`, `plugin-rules.json`, runtime score, or final suite lock is fabricated.
The old lock remains intentionally stale.

The next phase requires an actual baseline tarball and final combined candidate pins.
It also requires Linux runtime hashes, contained lifecycle proof, real permission tests, and the final discovery bindings.
The fixture requires Linux Node.js with `node:sqlite`, not an assumed Bun substitute.

Later provider egress is authorized only for `opencode.ai:443`.
The target remains `opencode/deepseek-v4.1-flash#low`, with no fallback.
The later limits remain $10 list price, 60 minutes, and concurrency one.
This offline increment starts no Docker, OpenCode, listener, model, or provider process.
It reads no live Memory data or authentication database.
