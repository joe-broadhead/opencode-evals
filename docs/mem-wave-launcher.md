# Opt-in Memory wave controls

## Status: execution blocked

This change supplies local controls, not permission to run an eval.
`qualifyWave()` always returns `execution_qualified: false`: the pure manifest validator
never sets that field. The owned run configuration alone can report it, by binding an
owner-supplied native qualification record to the live profile at dispatch
([native qualification binding](#native-qualification-binding)).
No manifest field or environment value overrides either gate.
The executable refuses before it starts Docker, OpenCode, or a provider.
Input refusal returns a report value without creating or reading a control report.
It grants no cleanup authority and starts no identity-check subprocess.

The production parent selects the [owned containment composition](owned-containment.md#launcher-composition-l-c).
The default adapter still supplies no owned capability — `processAdapter().owned` remains
the frozen `{snapshot:null, spawn:null}` — and every run without a matched binding refuses
at that gate exactly as before. On a matched binding alone the run script now composes the
owner-side capability below; the two facts together (live-matched record and verifiable
staging) are what admit an owned trial.
Injected offline tests exercise that actual parent path without a host trial worker.
Every owned result remains incomplete and denies a successor. Native completion, observer reconciliation, final acceptance, and runtime qualification remain separate gates.

## Native qualification binding

The owned path accepts one owner-supplied native qualification record, referenced by the
optional manifest pin `native_qualification` as `{path, sha256}`: a pinned JSON file outside
the compared arm packages, never a boolean. The pin's record schema is exactly
`oc-mem-native-qualification/1` with these fields:

| Field | Requirement |
| --- | --- |
| `os_profile` | Exactly `platform` (darwin), `arch` (arm64 or x64), `version`, `build` and `sdk` |
| `node` | Canonical absolute parent Node `path`, `version`, `sha256`, mode `0755` |
| `helper.source_blob` | The qualified C source's git blob id |
| `helper.build_manifest_sha256` | SHA-256 of the retained build evidence |
| `helper.binary` | Canonical deployed `path`, exact `sha256`, `size`, mode `0555` |
| `budgets` | Exactly warm-up 1000ms, lookup 100ms, cleanup 100ms |
| `evidence` | Canonical absolute qualification report `path` plus its `sha256` |
| `qualified_scope` | The qualification's explicit scope statement |

`qualifyWave()` validates the pin and the record's structure at admission. It still never
reports `execution_qualified`. At dispatch the run configuration
(`src/run/native-qualification.mjs`) validates the record against the LIVE profile:
deployed helper bytes, hash, size and mode with its canonical 0700 directory, the parent
Node's realpath, version, mode and bytes, the live OS profile (`sw_vers`, `xcrun`), the
harness tree's helper source blob, the pinned budgets, and the referenced evidence file.
Every value must match exactly.

A match constructs the reviewed `createDarwinIdentityReader` with the record's pins and
awaits its construction warm-up. That reader becomes the owned Docker process transport's
`identityOwner` for the run, and the run journal records the validation outcome with the
matched profile. A mismatch or a missing record refuses native dispatch with nothing
native constructed. A failed warm-up refuses after its single refused-operand warm-up
exec: nothing native is dispatched or remains admitted. Either way `execution_qualified`
stays false and the existing refusal path is unchanged. There is no fallback, no partial
match, no environment override, and no credential beyond `OPENCODE_API_KEY`.

The report's `execution_qualified` is true only when a matched binding actually admitted the
run's native dispatch; a refused admission reports false with its stop reason, and the
`native_qualification` journal field records the binding outcome for every run that reaches
the owned composition; an admission refusal before that point returns the unchanged refusal
report without journaling.
Qualification is bound per run: each dispatch revalidates the live profile and constructs a
fresh reader; nothing is cached across runs.

## Owner-side owned capability

When — and only when — the binding reports a match, the run script composes
`src/run/wave-owned-capability.mjs` into the owned seam, replacing the frozen adapter
default for that run. Composed only from reviewed modules, it supplies exactly two
capabilities:

- `spawn` — the real Docker-CLI spawn primitive. The existing wave-contained composition
  feeds it verbatim: `createOwnedDockerProcess` enforces the closed command grammar, the
  fixed `colima-mem-evals-20261122` context, and the OPENCODE_API_KEY-only credential
  shape, then binds every spawned client to the matched reader (`identityOwner`). The
  primitive itself asserts the fixed context prefix and creates, switches or mutates no
  Docker context or configuration: the wave's own `docker_config` directory, prepared by
  the dispatch task, is the only configuration the transport ever passes.
- `snapshot` — an owner attestation for the staged tuple. The owner hands the staged
  facts through the manifest's `staging` pin (`{ work, inputs, binaries, image,
  architecture, imageEnv, user, allow }`, canonical absolute paths). The attestation
  re-hashes the selected arm's staged tarball against its manifest pin, re-hashes the
  staged work/inputs/binaries trees through the reviewed staging validator, and requires
  the handed image identity to equal the manifest's pinned runtime image. It returns the
  attestation tuple in the staging validator's exact shape — `manifest_sha256`,
  `harness_sha`, `trial_id`, `image`, `work`, `inputs`, `binaries`, `architecture`,
  `inputs_sha256`, `binaries_sha256`, `imageEnv`, `user`, `allow` — and nothing else: no
  success authority and no trial-outcome claim. A missing, tampered or unverifiable fact
  refuses admission with a closed `snapshot-unverified:<fact>` reason; there is never a
  partial or invented attestation.

A matched binding with a missing or broken staging pin still refuses: the capability
exists, its attestation fails closed per fact, and no trial dispatches. Without a matched
binding no capability is composed at all, no environment or manifest boolean substitutes
for the binding, and the frozen `{snapshot:null, spawn:null}` default is unchanged.

## Legacy worker controls

The worker and group controls in the remaining sections describe the preserved legacy adapter path, not the owned containment path.

Native process-group signaling is also unavailable.
Node supplies numeric POSIX group IDs, not an incarnation-bound group handle.
`kill(0)` and a separate process inspection cannot prove continuity through ID reuse.
The production adapter sends no group signals and blocks live supervision.
Injected identity-bound handles exercise the supervisor in offline tests only.
These tests do not establish a native implementation or race-free POSIX signaling.
An available adapter function does not authorize worker activation.
Each worker must acquire a handle with callable `probe` and `signal` methods before the parent releases start IPC.
Missing, throwing, or malformed handles leave the started child unresolved and retain the lock.
The adapter also refuses direct activation without that handle. It never substitutes numeric signaling or leader exit for group absence.

The native 2.2.6 capability probe does not qualify the recorder handshake.
Cancellation can lack native-after and CLI-terminal evidence.
A watchdog exit never certifies recorder completeness.
The final accepted plan, release artifact, exact low-variant evidence, and both condition dossiers remain external prerequisites.

## Controls

- The target is $10 of estimated same-store list-price admission, not a billing maximum.
- One detached worker owns the CLI children. Each CLI runs one trial with `--parallel 1` and `--harness-retries 0`.
- Every trial uses the same store, exact model, Docker context, and wave deadline.
- The model is `opencode/deepseek-v4.1-flash#low`. Aliases and fallbacks do not qualify.
- The context is `colima-mem-evals-20261122`. The launcher does not change the default context or start a VM.
- The total local budget is 3,600 seconds. Work stops at 3,480 seconds, with 120 seconds for teardown.
- Wall time and monotonic time constrain the deadline. Clock reversal never restores elapsed parent time.
- With an identity-bound adapter, the parent requests TERM, then KILL after ten seconds, for the same group incarnation.
- The parent records late cleanup after suspension. It cannot guarantee a deadline while the machine sleeps.
- Local termination does not guarantee provider cancellation or a maximum bill.
- Unresolved costs stop the wave. Known costs remain visible, with unknown totals represented as null.
- All unstarted tuples remain in the report. A stop never reduces the declared sample.

The context singleton is `<docker_config>/.oc-mem-wave.lock`.
All invocations for this qualified context must use the same canonical Docker configuration directory.
Each control directory also has `wave.lock` and a permanent `wave.json` record.
The launcher never breaks a lock or restarts a used control directory.
Different Docker configuration directories are not one singleton domain.
Qualification consumes the original deadline but precedes scope allocation.
Pre-existing reserved control files, resource directories, symlinks, and traversal paths are refused without cleanup calls.

## Reviewed manifest inputs

The manifest schema is `oc-mem-wave/1`.
It contains the following fields:

| Field | Required value or content |
|---|---|
| `id` | Lowercase letters, digits, and hyphens, at most 40 characters |
| `model` | `opencode/deepseek-v4.1-flash#low` |
| `target_usd`, `total_ms`, `cleanup_ms` | `10`, `3600000`, `120000` |
| `harness_sha` | Exact clean integrated harness commit |
| `control`, `store`, `cases_dir`, `docker_config` | Absolute paths |
| `docker_context` | `colima-mem-evals-20261122` |
| `trial_timeout_s` | Integer from 1 through 3480 |
| `plan` | Pin for the complete accepted applicability plan |
| `trials` | Every applicable case × baseline/candidate × direct/search × repetitions 1, 2, 3 |
| `caps`, `catalog`, `model_qualification` | Pins for reviewed local JSON files |
| `runtime` | Version `2.2.6`, image digest, and `opencode`, `node`, `launcher_node`, `docker` binary pins |
| `inputs` | `fixture`, `schema`, and `discovery` file pins |
| `arms` | `baseline` and `candidate`, each with staged `directory`, `archive` pin, and `conditions` pin |

A file pin is `{ "path": "/absolute/regular/file", "sha256": "64 lowercase hex characters" }`.
Pinned files require canonical paths without symlinks or traversal components.
Runtime binary pins also require executable permission.
The Linux runtime binaries and host launcher Node are separate pins.
The staged arms must pass the existing `memoryArtifact()` verification.

The plan schema is `oc-mem-wave-plan/1`.
Each `cases` entry supplies `id`, nonempty `conditions`, compiled `file` pin, and selected `set`.
`completeTrials()` expands the entire plan without sampling.
Qualification derives the estimate tier from the compiled case sets, not a declared plan tier.
The accepted plan remains the authority for applicability. The launcher does not invent acceptance.

The condition dossier schema is `oc-mem-conditions/1`.
It binds `runtime_sha256`, `archive_sha256`, the exact `model`, and `memory_tool_ids`.
It requires `status: "qualified"` and `mapping: "execute-permission-v1"`.
Both `observations.direct` and `observations.search` contain `config`, `catalog`, and `request` pins.
These attachments contain observed effective permissions, registered tool IDs, and OpenAI-shaped request tools.
Labels alone do not qualify a condition. Other wire formats need a reviewed decoder.

The model dossier schema is `oc-mem-model-qualification/1`.
It binds the runtime, catalog, exact model, dated source, observed selection, and observed provider request.
`selection` and `request` are pins. `variant_path` and `variant_value` describe the reviewed low-variant wire mapping.
No provider field or alias is guessed by the launcher.

Current documentation describes the execute permission mapping at <https://opencode.ai/docs/tools>.
It is not proof of pinned 2.2.6 behavior.
Direct adds `{action: "execute", resource: "*", effect: "deny"}`.
Search adds the corresponding `allow` permission.
Both still require the observed condition dossiers.

## Future invocation, after reviewed integration

1. Obtain approval for the complete plan, artifact pins, runtime evidence, and recorder handshake.
2. Keep the accepted inputs immutable for the entire wave.
3. Use a clean integrated harness commit.
4. Supply `OPENCODE_API_KEY` through the approved environment mechanism.
5. Do not put the key in commands, files, logs, or manifest attachments.
6. Run the command with the qualified host Node:

```sh
node scripts/run-mem-wave.mjs --manifest /absolute/reviewed-wave.json
```

The current build refuses this invocation because recorder integration is absent.
There is no force flag or qualification bypass.
The CLI suppresses child output and exception text. The runner retains its existing credential redaction.

## Reports and cleanup

The control directory retains `manifest.json`, `wave.json`, `worker.json`, `progress.json`, `report.json`, and per-trial resource journals.
`report.json` distinguishes completed, incomplete, and unrun tuples.
Known receipt sums, unresolved trial IDs, and overshoot remain separate.
A missing ledger receipt is unknown cost, not zero cost.
`settleSingleAttempt()` records each observed cost/token receipt and its known lower bounds.
Missing token fields remain null, not zero. Other complete receipts still contribute to the lower bound.
Direct `--harness-retries 0` runs use the same conservative accounting.

The pinned 2.2.6 CLI checks native prompt outcomes internally but emits no prompt-terminal JSON record.
A final `step_finish`, a `stop` reason, or exit zero does not establish the missing recorder seal.
The current producer therefore always records `attempt_complete: false` and null billed/list totals.
It never accepts a caller-supplied success marker as terminal proof.
Timeouts, errors, interrupted requests, and otherwise complete CLI streams retain unresolved attempt totals.

A future completion decision requires a trusted native terminal outcome bound to the admitted prompt and a qualified recorder seal.
That seal must account for outstanding requests and late receipts, not merely observed tool returns.
This integration is absent. Synthetic complete-ledger fixtures isolate other controls in tests and do not qualify live accounting.

Own-only container cleanup uses successful creation IDs, never labels or dead-PID guesses.
The parent exclusively creates a fresh resource directory and retains an in-memory ownership capability.
Every accepted journal binds a random invocation ID, the immutable manifest digest, and the exact trial ID.
Journal existence, a copied capability object, or a caller-selected path grants no deletion authority.
Cleanup verifies directory identity and canonical receipt paths before reading bound receipts.
Invalid receipts remain untouched. Separately proved own receipts still receive cleanup.
Null, array, and scalar journals cannot authorize commands.
Malformed resource entries remain unresolved while valid entries in a bound journal still receive cleanup.
Malformed siblings never turn final cleanup into success or release the singleton.
The journal records pending creation before Docker starts.
A missing creation reply blocks verified cleanup, even after removal of all known IDs.
Cleanup preserves foreign resources, shared images, and the VM.
The runtime directory is disposable only after verified resource cleanup and worker-group exit.
The parent also verifies the runtime directory identity before removal.
Each attempted trial records its start before CLI creation. A missing journal then blocks verified cleanup.
The next trial requires bound cleanup evidence with `verified_gone: true`, no pending creates, and no uncertainty.
`containers_left`, missing cleanup evidence, or an unverified journal stops admission despite successful CLI, summary, and billing records.
Final cleanup alone cannot satisfy this per-trial requirement.

Per-trial admission and final cleanup share one scope and receipt validator.
Only the parent-created capability retains the original directory device/inode and permitted trial IDs.
Copied owner fields, a copied capability, or a replacement directory cannot establish that authority.
Same-process callers retain the scope through the original trial-array object. A deserialized worker has no such capability.

The worker requests verification over its existing parent IPC channel after each trial and before the next start.
The parent verifies the trial artifacts and cleanup receipt against its original scope.
The worker accepts only an affirmative response for the requested trial ID.
Missing IPC, disconnection, mismatched responses, and verification errors stop admission.
The parent watchdog still bounds a stalled worker or IPC request. This protocol adds no native supervision capability.

The serialized-worker entrypoint retains channel-loss state for its entire lifetime, including the initial start gate.
Its final synchronous pre-trial check includes both current channel health and persistent loss, for the first trial and every successor.
A later connected value cannot clear that stop condition. The worker does not reconnect or retry.
Startup listeners end with the start gate. Lifetime listeners end on every return or error.
Standalone same-process `runTrials()` does not require IPC. Its caller must supply applicable stop conditions.

Directory continuity is verified at the parent verification step, not atomically through response transit and workload dispatch.
A concurrent directory replacement after affirmative verification can precede the next dispatch.
Subsequent verification and final cleanup reject the replacement and retain unresolved evidence.
The protocol does not provide race-free filesystem authority against concurrent same-UID writers.

If cleanup is uncertain, preserve the locks and evidence.
Examine `resources/*.json`, `worker.json`, and `cleanup-clients.json` before recovery.
Verify each exact resource and process identity before a manual stop or removal.
Do not use broad PID scans, label sweeps, or automatic lock takeover.
The lead owns retained reports until independent review no longer needs them.

## Integration seam, not an observer implementation

`runJobBody()` in `src/run/runner.mjs` owns the narrow prompt seam.
Its `memoryClient` creates or continues a native session before `withMemoryActivation()` calls `exec(["run", ...])`.
A trusted ready/open operation belongs after session identity exists and before that native prompt call.
A trusted seal belongs after the prompt result, before fixture evaluation and teardown.
Failures, cancellation, and absent native terminal evidence must leave that scope incomplete.
The ordinary `runClient` branch also calls the CLI and needs equivalent integration where applicable.
No observer, codec, guard, or handshake implementation is part of this change.

Later integration must union the CLI flags with the independently reviewed discovery loader.
It must not replace that loader with this branch's older CLI file.

## Offline checks

The new tests use fake Docker, process, provider-result, and clock adapters.
They use isolated HOME, TMPDIR, and EVALS_STORE directories.
They do not run a VM, native OpenCode, a listener, or a paid model.
The fixtures in `wave-manifest.test.mjs` are invented test evidence, never accepted qualification artifacts.
The full `run.test.mjs` suite is not part of this offline check because it starts loopback listeners.

The terminal distinction follows pinned source `dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06`,
`packages/cli/src/run/noninteractive.ts`: native outcome checks at lines 309–337 and CLI JSON rendering at lines 356–505.
The supplied native probe retained these source excerpts. It did not supply a durable recorder completeness certificate.
