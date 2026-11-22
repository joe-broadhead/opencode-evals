# Native transcript compatibility

**Status: offline logical-client extension. Independent review and native qualification remain required.**

This document extends [the original verifier contract](native-completion.md).
It replaces that document's three-type transcript restriction and oldest-new-message rule.
It does not change the six-read interface, transport, launcher, runner, authority, containment, or frozen evaluation arms.
The [verifier](../src/run/native-completion.mjs) always returns `accepted:false`, `phase:"PROVISIONAL"`, and `wire.status:"unqualified"`.

## Source and classification

The source pin is OpenCode 2.2.6, `dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06`.
The source union contains eleven discriminants, not three.
The [schema](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/schema/src/session-message.ts#L31-L345)
defines each record and its subvariants.
Tests contain source-shaped values, not native captures.

| Native discriminant | Settled historical baseline | New record during this turn | Source reason |
| --- | --- | --- | --- |
| `user` | Retained | Only the exact sole delivered user | Projector inserts `input.id` unchanged. |
| `assistant` | Retained | Retained after the exact user, never an outcome | Assistant steps do not close the turn. |
| `idle` | Retained | Only the first chronological idle after the exact user supplies an outcome | The marker closes the busy period. |
| `agent-switched` | Retained | Non-outcome annotation, before or after the user | Selection publishes state without an execution wake. |
| `model-switched` | Retained | Non-outcome annotation, before or after the user | Selection publishes state without an execution wake. |
| `system` | Retained | Non-outcome annotation, before or after the user | The record contains a frozen instruction-update notice, not another admitted prompt. |
| `synthetic` | Retained | Conflict, including `resume:false` input | Synthetic input has separate durable admission. |
| `skill` | Retained | Conflict | Skill activation can resume execution. The record does not prove `resume:false`. |
| `shell` | Retained, except `running` | Conflict in every status | This record represents separate shell execution. |
| `compaction` | Retained, except `running` | Conflict in every status and reason | Compaction can admit work and replace model context. |
| `location-switched` | Retained | Conflict | A move changes the bound session location. |

The annotation classification concerns prompt identity and completion only.
Agent, model, and instruction changes can affect model behavior.
These records do not prove authorization, caller provenance, or frozen workload equivalence.
The exclusive serial writer and fixed scope remain trusted launcher preconditions.

The source establishes these distinctions:

- [CLI 210–224](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/cli/src/run/noninteractive.ts#L210-L224): agent/model switches precede prompt submission.
- [Session operations 99–118](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/session.ts#L99-L118): selections publish state changes without an execution wake.
- [Updater 96–190](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/message-updater.ts#L96-L190): switches, moves, instruction notices, synthetic records, and skill records retain distinct types.
- [Session operations 192–327](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/session.ts#L192-L327): shell execution, skill resume, compaction admission, and synthetic admission are not inert metadata.
- [Projector 1008–1035](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/projector.ts#L1008-L1035): delivery inserts user or synthetic input with the exact inbox ID.

## Recognition and bounds

This extension recognizes the full top-level union, but not every native execution regime.
It validates the logical fields necessary for classification and outcome selection.
It is not a complete native wire-schema validator.

| Record | Required logical fields beyond its distinct bounded ID/type |
| --- | --- |
| Existing `user` and `assistant` seam | No new body requirement. Original minimal logical fixtures remain compatible. |
| `idle` | Outcome is exactly `succeeded`, `failed`, or `interrupted`. |
| Every added discriminant | Finite `time.created`. Optional `metadata` is an object. |
| `agent-switched` | Bounded agent ID and optional bounded previous agent ID. |
| `model-switched` | Model reference with bounded `id`, `providerID`, and optional `variant`. The optional previous reference has the same shape. |
| `system`, `synthetic` | String `text` and optional string `description`. |
| `location-switched` | Location reference with bounded directory and optional workspace ID. Optional project ID, subpath, and previous location retain their declared shapes. |
| `skill` | Bounded skill ID and name, plus string `text`. |
| `shell` | Shell ID, string command, declared status, optional finite completion time/exit, and the declared output shape. |
| `compaction` | Status `running`, `completed`, or `failed`. Reason `auto` or `manual`. Running/completed require a summary. Failed requires error type/message. |

Optional compaction model/native fields require a model reference/object when present.
Shell status is exactly `running`, `exited`, `timeout`, or `killed`.
Shell output contains string `output`, finite `cursor`/`size`, and boolean `truncated`.
Unknown types and malformed required fields fail closed.
The original logical seam does not validate all user attachments, assistant content, usage, error details, or opaque metadata.
Native wire validation remains a separate adapter obligation.

IDs retain the existing 512-character limit.
Strings and opaque payloads consume the existing aggregate evidence budget of at most 4 MiB.
Pages retain the existing 200-record limit and bounded page count.
There is no additional dependency or general validation framework.
The consumer does not sort, filter, relabel, reconstruct, or mutate native records.
It retains every page, including the native empty sentinel, with original fields and exact record order.
Raw CLI bytes retain the original intrinsic-length and digest checks.

## Exact prompt and first idle

The delivered inbox ID must identify the sole new `user`, outside the baseline.
Only validated agent/model/system annotations can precede this user in the new segment.
An assistant or idle before the user does not become an annotation.
Equal text, timestamps, synthetic IDs, and terminal events do not supply prompt identity.

The baseline must remain the exact historical suffix.
This extension strengthens the former ID/type comparison to full retained-record equality.
Object field order does not affect equality.
Shortening, reordering, changed compaction windows, and in-place record changes invalidate admission.
New synthetic input, skill activation, shell execution, compaction, or location moves invalidate admission and outcome association.
This rule applies before the user, within the turn, and after its first idle.

Only the first chronological idle after the exact user supplies the outcome.
Annotations can intervene, but cannot close the turn or permit selection of a later idle.
The [idle schema](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/schema/src/session-message.ts#L291-L302)
explicitly includes steered prompts in one busy period.
This is why additional input remains a conflict.

Each complete validated page extends one contiguous descending segment.
A later older-page error preserves an independently observed failed/interrupted first idle for the exact user.
Partial history never promotes success or certifies admission.
Unknown/malformed records do not extend the validated segment.
Confirmed conflicting work on an older page revokes a prior partial association.
Historical baseline idles never substitute for this turn's idle.

Pagination uses storage sequence order, not ID or time order.
The native handler supplies a next cursor on every nonempty page, including the last nonempty page.
An empty page ends history and has no next cursor.
An empty page with a next cursor is malformed, not a gap across which records can join.
Duplicate IDs, repeated cursors, missing anchors, and page limits remain fail-closed controls.
Sources: [store 99–135](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/store.ts#L99-L135)
and [handler 35–61](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/server/src/handlers/message.ts#L35-L61).

## Unsupported regimes and qualification

Running historical shell/compaction records block launch, even with empty status snapshots.
New synthetic input remains unsupported even with `resume:false` or familiar metadata.
New skill/shell/compaction/move records remain unsupported even after successful settlement.
Native shell exit encodings `"Infinity"`, `"-Infinity"`, and `"NaN"` remain outside the finite-number subset.
Media-URI attachments and full nested wire-schema validation remain outside this logical extension.

Compaction can change context without deleting every historical row.
The [schema](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/schema/src/session-message.ts#L248-L289)
defines `native.messages` as a replacement window.
The [updater](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/message-updater.ts#L421-L481)
can update an existing compaction record in place.
The [revert projector](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/projector.ts#L1131-L1161)
can delete a suffix of history.
None of these operations permits baseline replacement or shortening here.

Shutdown interruption can lack an idle.
The [updater](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/message-updater.ts#L149-L153)
preserves turn continuity for shutdown.
The verifier retains the terminal event independently, without a stored-outcome substitute or event-to-message conversion.
Missing idle remains unknown, even after successful wait or empty final status.

All original native qualification requirements remain visible and unchanged:

- Native binary/source identity, endpoint binding, isolation, and descendant inventory
- Actual CLI delivery/user identity and native success/failure/interruption controls
- Native pagination, missing-idle, and competing-input controls
- Ingress ordering, loss, local close-fence races, and transport teardown
- Native job/inbox/active transitions and cancellation settlement
- Parent-owned process cleanup, accounting, observer evidence, and acceptance.

No offline test closes these gaps or relaxes a permission or qualification gate.
The frozen evaluation matrix remains unchanged, including unsupported rows.
This extension does not establish atomic pagination or a remote-drain fence.

## Offline checks

The [focused tests](../test/native-completion-transcript.test.mjs) use only a finite injected logical client.
They cover every recognized discriminant, annotations at page edges, conflicting work, malformed fields, full-baseline equality, and partial negative extraction.
The original verifier and boundary tests remain unchanged.

Run the focused checks in an empty environment with owned storage:

```sh
env -i HOME="$OWN_HOME" TMPDIR="$OWN_TMP" EVALS_STORE="$OWN_STORE" PATH=/usr/bin:/bin \
  "$PINNED_NODE" --test --test-concurrency=1 test/native-completion.test.mjs \
  test/native-completion-boundaries.test.mjs test/native-completion-transcript.test.mjs test/docs.test.mjs
```

Do not run the full repository suite under a no-listener authorization.
