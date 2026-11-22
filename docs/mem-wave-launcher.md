# Opt-in Memory wave controls

## Status: execution blocked

This change supplies local controls, not permission to run an eval.
`qualifyWave()` always returns `execution_qualified: false` until reviewed recorder integration replaces that gate.
No manifest field overrides the gate.
The executable refuses before it starts Docker, OpenCode, or a provider.

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
- The parent sends TERM, then KILL after ten seconds, to its exact owned group.
- The parent records late cleanup after suspension. It cannot guarantee a deadline while the machine sleeps.
- Local termination does not guarantee provider cancellation or a maximum bill.
- Unresolved costs stop the wave. Known costs remain visible, with unknown totals represented as null.
- All unstarted tuples remain in the report. A stop never reduces the declared sample.

The context singleton is `<docker_config>/.oc-mem-wave.lock`.
All invocations for this qualified context must use the same canonical Docker configuration directory.
Each control directory also has `wave.lock` and a permanent `wave.json` record.
The launcher never breaks a lock or restarts a used control directory.
Different Docker configuration directories are not one singleton domain.

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
Pinned files cannot contain symlinks in their paths.
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
Known costs, unresolved trial IDs, and overshoot remain separate.
A missing ledger receipt is unknown cost, not zero cost.

Own-only container cleanup uses successful creation IDs, never labels or dead-PID guesses.
The journal records pending creation before Docker starts.
A missing creation reply blocks verified cleanup, even after removal of all known IDs.
Cleanup preserves foreign resources, shared images, and the VM.
The runtime directory is disposable only after verified resource cleanup and worker-group exit.

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
