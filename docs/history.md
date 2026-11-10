# The History pack and cases

`packs/history/pack.json` is derived from the plugin's `jelly` declaration (`evals pack history --sync`) plus a
declared half: the RPC ids and `vocab`, the values of History's own grammar.

`cases/history/*.md` are 66 cases, every item decided by code:

- 47 **tune** cases: how/why lookups, decisions that were superseded, exact text, other-project and archived and
  subagent sessions, file history, time windows, cost and count aggregates, a hidden instruction in a past session,
  a masked secret, a false premise, a topic that was never discussed, and three questions that must *not* use History.
- 10 **holdout** cases (`Holdout: true`): new questions over the same history, written before any tuning.
- 9 **tools-*** cases: one natural request per tool or parameter family (`recall`, `events_list`, `pin` list,
  `brief` children, `read` kinds and paging, `files` ops, `sessions` agent, `sql` aggregates).

Session ids in the cases are hash-derived from names, so they are only meaningful against the synthetic history the
cases were written for (six projects, 203 sessions, planted facts with known session and seq); the cases carry no
real session text. A runner has to build that history, run each case's `## Prompt` in the repository named by its
`Seed: cwd=…`, and record `opencode run --format json` as `raw/<iteration>/history/<case>.jsonl` with a
`<case>.summary.json` (`exit`, `durationMs`, `model`, `started_at`, `opencode`, and `provenance`).

Numbers that depend on the history (`spend`, tool counts) were generated from its ground truth, never typed.
A clause that turned out wrong was fixed for every arm and every recording was re-graded; the recordings are what
make that free.

## Reading the policy output

`evals policy` refuses to ship on a single trial of a model-driven suite: the same arm compared with itself across two
trials returned HOLD each time (one or two cases flip). Compare several trials per arm, paired over cases.
