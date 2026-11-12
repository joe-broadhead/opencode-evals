# The History pack and cases

`packs/history/pack.json` is derived from the plugin's `jelly` declaration (`evals pack history --sync`) plus a
declared half: the RPC ids, `vocab` (the values of History's own grammar) and five T1 cases, one host per `access`
value: at the default `all`, `pin {action: list}`, `sessions` and `sql` run with no prompt; at `ask-changes` the pin
is asked and declined; at `read-only` it is refused.

`cases/history/*.md` are 83 cases, every item decided by code: 63 active and 20 retired (`Status: retired`: redundant
or saturated, kept for the record, never selected). Each active case names its sets in a `Set:` header:

| Set | Cases | What it is for |
| --- | --- | --- |
| `core` | 45 | the paired statistic: lookups, decisions, exact text, scope (other projects, archived, subagents, pagination), counts and costs, local days, the questions that must *not* use History, not-found, write-only-when-asked, injection, secrets |
| `safety` | 17 | the core cases a release may not regress on (must-not-use, not-found, pins, injection, secrets, deletion) |
| `screen` | 20 | the core cases the v0.0.0 baseline did not pass in all three phase A trials: where a lever can show |
| `guard` | 8 | saturated aggregates and lookups, run once per arm as regression cover |
| `smoke` | 8 | the `tools-*` cases: one natural request per tool or parameter family |
| `f7` | 5 | the pin cases, run under the `ask-changes` and `read-only` arms |
| `new` | 15 | the cases added for v0.0.0 |
| `extra` | 2 | scope `directory` (`Seed: subdir=`) and continuing a world session (`Seed: continue=`) |

The holdouts are not in the repository: they live in the private store, `$EVALS_STORE/holdouts/history/`, with the
world overlay they need, and are holdouts whatever their header says.

Session ids in the cases are hash-derived from names, so they are only meaningful against the synthetic history the
cases were written for (six projects, 207 sessions, planted facts with known session and seq); the cases carry no
real session text. A case whose clauses use numbers the history derives (spend, counts, a tree's cost, the session
ids of a world change) declares them in `Truth:`, and `evals run` refuses a world whose `truth.json` says otherwise.
A clause that turned out wrong is fixed for every arm and every recording is re-graded; the recordings are what make
that free.

## Reading the policy output

`evals policy` refuses to ship on a single trial of a model-driven suite: the same arm compared with itself across two
trials returned HOLD each time (one or two cases flip). Compare several trials per arm, paired over cases.
