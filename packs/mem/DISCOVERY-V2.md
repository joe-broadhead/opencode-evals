# Discovery v2: finite offline contracts

`mem-discovery/2` covers the 24 discovery cases. It does not replace the 38 frozen core cases.
The separate discovery oracle uses `oc-mem-discovery-proof/1`.
The core grader, durable oracle, prompts, assertions, and archived source files remain unchanged.

## Evidence limits

These contracts support deterministic offline execution, native capture attachment, and native grading.
They do not establish OpenCode, container, permission-host, catalog, or provider compatibility.
The active case status means that the finite contract exists. It is not runtime approval.

`discovery-offline-lock.json` records an **unrun offline compile lock**.
It is not a final comparison manifest. It contains no release, runtime catalog, or paid-result assertion.
The lock preserves the previous discovery digest and both hashes for each previous case file.

The source schemas come from public declarations at provisional commit `5488730012f893f2e456d5bc6540ab3b4708d9c5`.
The snapshot generator reads pinned Git objects with the existing literal reader. It does not execute source tool implementations.
The four schemas describe `spaces`, `wiki`, `read`, and `code`.
The direct and search conditions retain the full schema and the first 117 description characters.
These conditions are parameters, not observed registration, search ranking, or catalog results.

## Case and identity changes

Only the two exact-read human prompts change. They ask for the Quartz fact instead of the invalid `rec_eval_1` identifier.
The canonical seed uses `rec_01KABCDE1234567890ABCDEFGH` in both conditions.
Scoped recall results expose this identifier. The prompt contains neither the identifier nor a tool-action hint.
The other 22 human prompts retain their previous text.

`discovery-plan.mjs` generates current cases. The legacy renderer remains available to old controls, but its CLI refuses case generation.
The finite fake exposes distinct personal and shared canaries.
Positive controls derive record, wiki, code-graph, skill, and account identifiers from actual scoped fake responses.
No lookup control falls back to an identifier from the plan.

## Closed classification changes

| Surface | New bounded classification | Write restriction |
| --- | --- | --- |
| `mem_wiki` | Source-defined `graph`, `documents`, and `pages` reads | No new wiki writer verb |
| `mem_read` | Canonical record identifier and optional space | Trusted registered-tool policy metadata required |
| `mem_code` | Closed source read verbs and arguments | Trusted registered-tool policy metadata required, no graph writes |
| `mem_spaces skills` | `list`, `get`, `search`, `versions` | No skill writes |
| `mem_spaces sources` | Source inventory | Exact source proof request in the two source cases only |
| `mem_spaces jobs` | Named metadata reads and template inventory | Exact inactive draft in the two job cases only |
| Active permission context | Adds `mem_spaces`, `mem_read`, and `mem_code` | Deny wins, ask remains ask, foreign and expired contexts fail |
| Commit-plan and intent families | Adds `spaces` | Sealed case, trial, turn, session, target, and payload remain required |
| Bounded reply actions | Adds `mem_spaces` | Only `once` or `reject`, with active source and resource matching |

The code read verbs are `get`, `status`, `files`, `search`, `node`, `callers`, `callees`, `impact`, and `explore`.
The job metadata verbs are `templates`, `list`, `get`, `versions`, `runs`, `logs`, `diff`, `items`, and `hosts`.
The fake implements a finite subset of these public wire contracts. It does not promise a complete Memory backend.
Unknown actions, unknown fields, and model-provided `readOnly` flags do not create authority.

## Finite state and grading

The first eight discovery writes use literal per-case intents for remember, page, commitments, and wiki.
The four spaces writes add only the following outcomes:

- Source requests for `gmail` and account `quartz-synthetic`.
- Inactive drafts for template `slack-threads-project`, project `quartz`, and account `quartz-synthetic`.

Disabled, unconfirmed provider metadata exposes the synthetic account name. It does not establish a binding.
Template names expose the account alias through a field that the public formatter retains.
The fake never binds a source, collects data, activates a job, grants access, or establishes human approval.
Job versions and diffs require an actual stored draft. Unknown jobs have no invented version.

Stored skill history uses `/v3/skill/versions`, a canonical skill identifier, limit 50, and offset pagination.
Versions return summaries. They do not promise full historical bodies or wiki versions.
The HTTP codec rejects caller-owned identity, foreign resources, unsupported dispatch, and malformed inputs.
List cursors bind the scope and original query. Store closure rejects subsequent requests without a state change.

The oracle compares typed native calls with the trace and independent scoped backend observations.
It requires the canonical seed, matching guard frame, native turn, body or topology truth, and unchanged unrelated families.
Creation identities come from durable state and matching creation calls, never from the answer.
Metadata, answer prose, no-op receipts, and queued outcomes cannot replace stored body truth.

The controls cover 24 direct positives, 24 inner-call positives, and 11 adversarial variants in both conditions for every case.
Additional controls cover permission outcomes, active receipts, closure, guard frames, cursor queries, and resource scope.
Synthetic permission frames and teardown stand-ins are explicitly offline fixtures.
The source/job answers retain a strict request/draft phrase contract. Runtime paraphrase calibration remains a separate gate.

## Reproduction

With task-owned `HOME`, `TMPDIR`, and `EVALS_STORE`, run the explicit offline allowlist from the handoff.
The current case generation and compiler commands are:

```sh
node packs/mem/discovery-plan.mjs
node bin/evals compile --plugin mem
node bin/evals compile --plugin mem --check
```

The 62-case compiler count is not a runtime pass count.
The baseline source schemas bind 16 discovery cases. The other eight are expected missing-tool behavior failures, not harness exclusions.
Both independent reviews, final artifacts, runtime catalog evidence, credentials, and enforceable budget caps remain separate gates.
