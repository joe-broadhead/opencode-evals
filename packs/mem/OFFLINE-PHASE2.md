# Memory offline phase 2 — partial implementation

This continues signed setup `2eeebb04faaabecc8fb48eb63019338a8c055070`.
It does not accept the earlier unconfined scripted-model test. That log remains
unchanged. This phase runs only the explicit Memory unit-file list below, plus
source generation, compiler/syntax checks and the permitted pack readiness read.
No OpenCode, listener, container, daemon, model, source-plugin or package-manager
process is executed. All new evidence stays under the owned `.task-evidence/phase2`.

## What changed

- **Real directory arms:** `stageMemoryTarball` verifies supplied archive bytes
  against an external SHA-256 and source commit, decodes bounded gzip/regular tar
  without a subprocess, and checks the `index.js -> src` import closure. The arm
  copier retains manifest-hashed source, bundled skills and instructions, not an
  empty `dist/`. It excludes project config and refuses links, traversal,
  duplicate entries, external/nonliteral imports and unsupported tar forms.
  The manifest travels with the arm and determines its implementation digest.
  No actual baseline/candidate tarball is available or claimed verified here.
- **Contained fixture lifecycle code:** host staging copies files only. The
  entry script refuses non-Linux/non-container execution before opening a
  listener. The runner launches it through `trial.wrap`, checks readiness
  inside the trial, stops its handle, and captures bounded state only after
  `trial.gone()` confirms container removal. Unit callbacks record these steps;
  they do not execute any command or open a socket. Runtime endpoint options
  are forced to synthetic loopback with capture/collection/spooling off.
- **Finite transport:** the pure codec routes selected records and wiki HTTP
  requests to the durable fixture. There is no arbitrary upstream forwarding.
  Unknown targets, credentials, scope claims and methods fail closed. The codec
  does **not yet implement the real control context and the full gateway/records
  service interface**. Those contracts require the immutable baseline artifact.
  The default world therefore still refuses real execution. Startup/teardown
  code is not proof of a compatible running plugin.
- **Scoped commit plans:** Memory-specific extractors resolve implicit personal
  targets to reserved aliases instead of `local:true`. The generic guard stays
  unchanged for other plugins. Memory calls distinguish read actions from writes,
  validate known arguments, reject scope/wiki conflicts and traversal, and require
  a known single-space registry for record-id writes. Missing/new-id scope mapping
  refuses the write; dynamic created-id registration is not implemented. The
  runner adds the binding only for the container backend. Internal action-level
  permissions still need the actual baseline/final permission contract.
- **Permission metadata:** the backend fixture persists allow, deny, ask-approved
  and ask-declined receipts, independently of its durable records. These are
  synthetic backend control tests, **not actual host permission approvals**.
  OpenCode's ask-reply integration remains unverified and is not bypassed.
- **Closed source profile:** `oc-mem-profile/1` records the real source schema
  digests, first117 text, actions and host-permission model without inventing an
  `access` option. Bound discovery inputs pass captured schemas and conditional
  argument checks. Unit sidecars are explicitly synthetic values, never files
  masquerading as `registered.json` or `plugin-rules.json`. Release validation
  was not relaxed; `evals pack mem` still fails its true missing runtime metadata.

## Core and discovery coverage

All **38 original core identities and prompts** now compile to concrete cases.
**12** have literal seed/answer contracts recovered from the phase-1 read of
the frozen source (lines 198–299). They check unchanged durable scope, real
fixture read evidence, a typed recall trace and the original JSON answer shape.
Each has independent wrong-answer, fabricated-read and wrong-space controls.
Relevant-only reads are accepted; stale-only reads fail. The scorer is part of
the existing harness evidence grammar, not a replacement runner.

The other **26** are explicitly `blocked-missing-frozen-truth`. Their expected
seed/answer/assertion parameters were not saved in the original inventory. No
truth was invented. Their `memory-core:` clause is unverifiable, not true or n/a,
and `coreCoverage()` returns `ready:false`. Multi-turn cases are also not
runtime-compatible until continuation semantics are preserved. Compilation is
not a claim that all 38 are ported or passed.

The retained inventory source SHA-256 is
`614dc70d7636b8a81d05cdef67fc0e0a73b1141ff13dc0c59a012249a67262fd`.
This phase's raw pinned-source URL returned 404. GitHub's immutable-object lookup
returned `Invalid object requested`. No prohibited primary checkout was read.
Supply that source file as an immutable artifact with this digest, plus the
baseline's service interface/package. Do not replace it with a moving branch.

There remain **24 discovery prompts**. Twelve are fixture-bound with closed
captured inputs; twelve await final read-family or source/job fixture binding.
They retain explicit deferral reasons. They are not a finished 24-case live
suite. Strict final-answer phrase controls still require a reviewed answer
contract. Actual hidden-family/search/signature traces are required later;
inner-call trace controls do not measure search. No final candidate was polled.

The combined generated corpus is **62 cases**. The old 24-case `evals.lock` is
intentionally not updated: this is not the final combined plugin/suite pin.
Comparisons must fail on this stale lock until the owner freezes the final suite.

## Explicit safe unit-file allowlist

Read these files and their imports before running them. They use only file
fixtures, in-memory request/trace values, compiler/scorer calls and injected
lifecycle callbacks. They contain no subprocess launches or listener starts.

```sh
node --test --test-concurrency=1 \
  test/mem-arm.test.mjs test/mem-container-fixture.test.mjs \
  test/mem-core.test.mjs test/mem-guard.test.mjs \
  test/mem-profile.test.mjs test/mem-tarball.test.mjs \
  test/mem-cases.test.mjs test/mem-fixture.test.mjs \
  test/mem-oracle.test.mjs test/mem-pack.test.mjs
```

Set `HOME`, `TMPDIR` and store paths to private task-owned directories. Do not
run `test/isolation.test.mjs`, a negative name filter, `npm test`, vendor suites,
or OpenCode processes on this host. Original 63/2 upstream results remain
historical failures: neither generic upstream assertion was modified or rerun.

## Joint gates, not excuses to skip offline work

`next-environment.json` is a request, not permission to execute. Still needed:
the missing immutable source/38-core truth and service contracts; complete
fixture routes and record-scope registration; all final schemas and discovery
bindings; actual container lifecycle/catalog/rules evidence; real host permission
deny/approval/decline effects; official matching Linux runtime/image hashes;
isolated documented provider env injection; approval for `opencode.ai:443` only;
enforceable token/request/cost/time caps; final tarballs and an honest
implementation-axis comparison. The approved later ceiling remains $10 list
price / 60 minutes / concurrency 1 / paid `opencode/deepseek-v4.1-flash#low`.
No provider price or eval score is inferred from these offline tests.
