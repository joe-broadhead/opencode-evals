# Memory setup: offline only

This is an incomplete source pack, not a published-release or runtime snapshot.
`setup.mjs` uses `EVALS_REPO_MEM`, checks tracked source cleanliness, and captures
the actual dependency-free tool declarations without calling them. It records
18 declared tools, 16 plain-host registrations, and the baseline's absent access
option. No access option or release tag is invented. The two read-only twins are
marked unlisted. Final schema ownership belongs to the combined candidate.

## Reproduce this phase

Run from the pinned harness checkout. Set `EVALS_REPO_MEM` to the approved clean
baseline or final candidate source. Set `TMPDIR`, `EVALS_TMP`, and `EVALS_STORE`
to private task-owned directories before checks. None of these steps calls a model.

```sh
node packs/mem/setup.mjs
node packs/mem/inventory.mjs
node packs/mem/cases.mjs
node bin/evals compile --plugin mem
node --test --test-concurrency=1 test/mem-*.test.mjs
node bin/evals lock --plugin mem
node bin/evals compile --plugin mem --check
```

There are no dependencies, lockfile, install scripts or build scripts at this
harness pin. An npm install is unnecessary. Keep the upstream guards unchanged.
`evals pack mem` intentionally fails until release/runtime-registration/rules
sidecars exist. The nine structural snapshot checks pass independently; they do
not satisfy that runtime gate. Do not fill these sidecars with source observations.

## Coverage and gaps

The 24 discovery requests comprise 12 pairs. Both paraphrases use the same oracle.
Every compiled case is explicitly deferred. Twelve cases have deterministic
fixture/trace controls for the existing grader. The other twelve have a deliberately
missing `mem.final_schema_bound` fact: they BLOCK rather than pass with a guessed tool.
The fixture is a finite synthetic backend model, not the real records store.
`fixture.call()` persists `capture.json`; `memState` reads it independently of
the receipt. The fixture never opens a listener or calls a source or provider.
An HTTP transport from the real plugin to these fixtures is **not implemented**.

| Family / operations | Offline coverage | Remaining gap |
| --- | --- | --- |
| Memory save; exact current read | save pair | exact read pair awaits final schema |
| Memory recall/browse/filter/pagination | one-page partial sample pair | filters, same-args cursor model repair, scopes, revoked access, 401/503 and layered failures |
| Correct/confirm/retire/restore/forget/history/suppression | fixture retire/restore unit slice | full core and lifecycle port; human-only suppression lift |
| Pages write/list/read/append/replace/move/folder/delete/links/history/export | write pair | paginated listing, version/conflict/shared restrictions, archive member digest oracle |
| Commitments add/update/complete/cancel/reopen/snooze/delete/move | add pair | lifecycle and cross-space copy/move |
| Wiki create/list/search/raw read/write/append/delete/status/documents/pages/graph | raw read/write pairs | creation, processing/queue HTTP contracts, complete inventory; graph pair awaits schema |
| Wiki versions/revert; binary upload/PDF/local ingest | must-fail unsupported-completion control | natural refusal cases and exact unsupported contract; no invented endpoint |
| Code search/status/files/node/callers/callees/impact/explore | caller pair deferred | final direct code-graph schemas and fixture authorization; indexing/sync/delete remain human links |
| Stored skills list/get/search/versions | versions pair deferred | final schemas; writes require human proof, not agent completion |
| Persona/profile/summaries; copy/audience/readers/lineage | explicit gap | final read schemas and synthetic fixtures; no profile-keeper probes |
| Spaces current/bind/list/members/access/health/create/rename/archive/leave/handover | explicit gap | request vs completed-state oracles; no identity/proof widening |
| Sharing list/grant/revoke/transfer/copy/move/candidates | explicit gap | grants, copies, partial cleanup and mixed-space fixtures |
| Source list/request/cancel/unbind/import/consent | request pair deferred | fake request state and console-link truth; no real source binding or collection |
| Collect; review list/accept/edit/reject; held writes | explicit gap | fake collector/proposals only, started vs completed and held vs stored |
| Jobs list/get/versions/runs/logs/draft/pause/run/resume/archive; templates/diff/items/hosts | draft pair deferred | fake durable inactive/due/finished states; activate/delete/consent are human links |
| Aliases, ingest/cursor, raw source RPC, internal/operator methods | excluded from success | regression refusal coverage pending; never promote them to public user operations |
| Frozen release core | all ids/prompts/assertion types and source hash inventoried | **zero core cases ported**; retain this as a blocker, not n/a or omitted coverage |
| Explicit permissions default allow/deny/ask approved/declined | upstream guards untouched | Memory-specific synthetic commit extractors and action-level rules; direct and inner-call integration |
| Real catalog, first117 chars, hidden search, typed signatures, catalog pressure | source snapshot only | real OpenCode 2.2.6 contained scripted-model probe, no mock-ranking evidence |

The controls exercise the real `compileCase`, `runView`, `gradeCase` and adapter
seams. Direct and inner-call trace controls are **not** an OpenCode session or
evidence of search. The strict phrase-based answer controls need a reviewed answer
contract before a paid wave; a natural truthful paraphrase can currently fail.

## Next contained slice

`worlds/mem/index.mjs` refuses execution. Upstream worlds prepare on the host.
Add a Memory-specific process inside `trial.wrap` after `isolation.enter`, with
readiness through `trial.ready`, private per-trial synthetic state, and capture
before teardown. Confirm cleanup through container removal. Never start the
gateway in host `world.prepare`, mount real HOME, or use an unconfined fallback.

Then stage a built dependency-free Memory arm: upstream `materialiseArm` currently
requires `dist/` and excludes `src/`, while Memory runs `index.js -> src/index.js`.
A reviewed narrow packaging adapter must retain those source imports and exact
tarball hash; a fabricated empty dist would not be an actual plugin test.
The synthetic write plan must retain the guard and enforce reserved aliases on
both direct and inner calls. `remember` lacks a space argument; do not apply an
unscoped `local:true` waiver without reviewed container-only routing guarantees.

## Paid gate (not executed)

Freeze `opencode/deepseek-v4.1-flash#low`, paid, in both arms. Primary docs:
https://opencode.ai/docs/zen lists DeepSeek V4.1 Flash at the OpenCode chat
endpoint; https://opencode.ai/docs/cli/providers documents environment connections.
`OPENCODE_API_KEY` is the documented Console key name; this process has no value.
No credential database was inspected. Runtime env activation and #low routing
still need a contained no-prompt preflight with the stock matching binary.

Only documented provider host `opencode.ai:443` is proposed. The harness defaults
to Anthropic-only hosts. Lead approval is required before setting an egress policy;
do not widen it from runtime requests. No setting has been changed.
Docker client 29.7.2 is present but the daemon is unavailable. No VM/daemon was
started, no image built, no Linux binary downloaded. Existing host OpenCode is
2.2.6; its macOS binary is not a Linux container executable.

Lead's later budget is $10 list price, 60 minutes, concurrency 1, three runs per
baseline/candidate per direct/search condition. No paid execution is authorized
in this phase. Before launch, freeze final tarballs, cases/scorer, fixture/oracle,
official Linux/runtime/image/catalog hashes; obtain enforceable per-request/token
caps and an implementation-axis comparability review. Schema + permission changes
are not skill-only. Never force-ignore provenance. No final price/catalog/requests
or observed eval scores are available here.
