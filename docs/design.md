# Design

How the pieces fit: a case says what must be observable, a run records what happened, a trace keeps the structure
of that recording and nothing private, the grader decides each item in code, and the policy compares two batches
only when they differ in the one axis under test.

```
cases/<plugin>/<id>.md ──compile──▶ <id>.json (oc-case/1)
                                         │
evals run ──▶ $EVALS_STORE/raw/<it>/<plugin>/<id>.t<k>.jsonl + .summary.json
                                         │
evals trace ──▶ $EVALS_STORE/traces/<it>/<plugin>/<id>[.t<k>].trace.jsonl (oc-trace/1)
                                         │
evals grade ──▶ $EVALS_STORE/results/<it>/verdicts.json, batch.json
                                         │
evals policy --a <it> --b <it> ──▶ ship | hold | ask, with the reasons
```

## Cases

One markdown file per case, one screen long, compiled to strict JSON (`evals compile`). A clause that does not parse
is a compile error, so a broken case never reaches a run. `cases/x/small-bounded-search.md` is the worked example.

```
# <id>
- Plugin: <pack id>
- Skill under test: <skill>
- Tier: T3
- Source: <where the case came from>
- Decision tested: <one sentence>
- Data check: <what the world must hold for the case to mean anything>   (optional)
- Controls: no-skill (expect fail: <ITEM>); old-version (expect pass)    (optional)
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000           (optional)
- Seed: cwd=api time=day                                                 (optional, read by the runner's world)
- Holdout: true                                                          (optional)
- Checkable: sessionID, query, sql, command                              (optional: below)
- Set: core, smoke                                                       (optional: the plugin's own run sets)
- Status: active | retired | deferred                                    (optional; default active)

## Prompt
<what the user types>

## Items
- [<ID>] blocker|major|minor · <what must be observable>
  evidence: <clause>             every clause must hold
  evidence_any: <clause> ;; <clause>   at least one must hold
  n/a_when: <clause>             the item does not apply when this holds
  grader: judge                  advisory: settled by a person or a judge, never by code

## Forbidden
- [<ID>] blocker · <an action that must not happen>   (same syntax; a failure is a forbidden violation)

## Oracle
- <state path> == <value>

## Notes
- <ID>: why a hand grade may differ
```

The clauses, each one observable in a trace:

| Clause | Holds when |
| --- | --- |
| `call:<tool>#<n>` | the n-th call of the tool happened |
| `call:<tool>#<n> args.<key> <op> <value>` | its argument compares; ops `==`, `!=`, `<`, `<=`, `>`, `>=`, `matches`, `not-matches`, `contains`, `excludes`, `present` |
| `absent:<tool>[#<n>]` | the tool (or its n-th call) did not happen |
| `count:<tool> <op> <n>` | the number of calls compares |
| `counts:<tool>#<n>.<key> <op> <n>` | a count read from that call's result compares |
| `text:<span> matches\|not-matches /re/` | the answer's `any`, `first-line`, `first-paragraph` or `last-line` matches |
| `text:<span> count /re/ <op> <n>` | the number of matches compares |
| `skill:<name>`, `absent-skill:<name>` | the skill was, or was not, loaded |
| `declined:<tool>`, `absent-declined:<tool>` | a call was, or was not, declined by a permission |
| `budget:<name> <op> <n>` | `outer_calls` (every tool call the model made: skill loads, Code Mode's `execute`, direct tools), `inner_calls` (every call the code inside an `execute` made), `billed_calls`, `tokens`, `wall_ms`, `turns`, `cost_usd` |
| `cost:matches-appended [tolerance <n>]` | the answer's cost line matches the plugin's appended one |
| `state:<path> ==\|!= <value>` | the final state, from the case's oracle file |

An argument that was not passed satisfies `!=`, `not-matches` and `excludes` (it equals nothing and matches nothing)
and fails every other operator, `present` included. On a list (several query phrasings), `matches` and `contains`
hold when one element does, `not-matches` and `excludes` when none does. `contains` and `excludes` ignore case.

A trace reduces every free-text argument to a shape, so a session id, a query, an SQL statement or a shell command
cannot be compared from it. A case that needs to compare one declares its key: `Checkable: sessionID, query`. For
those keys, and only for them, the grader reads the value from the private recording at grade time (call by call, in
the trace's order); the trace still holds only the shape. Without the recording, such a clause is unverifiable.

A tool is a name, a glob (`x_*`), a namespace (`history.*`) or a qualified name (`history.read`). A plugin tool reaches
a run two ways, inside Code Mode's `execute` (ns `history`, tool `read`) or as a direct tool (`history_read`); a
namespace or a qualified name selects both. A bare name the case's own plugin declares is that plugin's tool, so
`call:read#1` in a History case is History's `read` and never the built-in file `read`; a bare name the plugin does
not declare (`edit`, `write`, `bash`) is the built-in.

## Traces

`oc-trace/1` is one header line and one line per event: tool calls with their arguments at the MCP boundary, Code
Mode's inner calls read from the code, skill loads, permission declines, model calls with split token counters and
cost, and the answer as a digest. Content is reduced to structure: no text, handle, id or link reaches a trace, and
the recording stays in the private store, named by digest. A plugin's `vocab` lists the values of its own grammar
(enum values, tool names) that a trace may keep verbatim.

A run that did no work is classed (`infra`, `timeout`, `provider`) before anything is scored, so an outage is never
a zero.

## Grading

Each clause is `ok`, `fail` or `unverifiable`. An item passes when all its clauses hold, fails when one fails, and is
`BLOCKED` when one cannot be settled: a variable argument, a missing recording, a dependency not configured. A
blocked item is never a pass and never a guess. `n/a_when` makes an item `N/A`; a `judge` item is advisory.

A case is `FAIL` when a blocker fails, `BLOCKED` when a blocker or a major is unsettled, and `PASS` otherwise; failed
majors and minors are reported as findings. `PASS` therefore says only that no blocker failed; **strict pass** is
the bar a user feels: every blocker and every major item passed (or was N/A or advisory).

A case can be run k times in one iteration: trial k is `<id>.t<k>` in the recordings, the traces and `verdicts.json`,
and every trial is kept. A case's batch entry is the aggregate: `PASS` only when every trial passed (`pass^k`), `FAIL`
when any trial failed. `batch.json` carries `trials` (min and max per case), `strict` (the strict rate over runs) and
`pass_k` (the share of cases whose every trial passed, by verdict and strictly). A recording without a `.t<k>` suffix
is one trial, graded as it always was.

The gold cases (`evals selftest`) test the graders: synthetic traces whose verdicts are known, including ones that
must fail, must block and must be N/A.

## Batches and the policy

`batch.json` holds the coverage, the per-case verdicts, the trials, the cost (billed and list price, never merged),
and the provenance of every axis: the plugin build, the skill, the tool descriptions, the namespace, the
result text, the rules, the case set, the model and the host. A runner that records its own provenance is trusted;
a value nobody recorded is `unrecorded`.

`comparable()` allows a comparison only when every axis but the one under test is recorded and equal; otherwise it
names the fields and refuses. `decide()` is a pure function of the two batches:

- **hold** on a regression: a passing case that no longer passes, a new forbidden violation, a new blocker failure,
  or cost per passing case worse than the noise floor;
- **ask** on thin coverage, unsettled items, a new major finding, a declared rather than verified basis, or fewer
  than two trials per case on either side;
- **ship** otherwise.

A batch records the grader digest and the case-set digest it was graded with. When either has moved, the scorecard
opens with a **Stale** note and `evals verify` fails; `evals verify --all` lists every stale iteration in the store,
without re-grading, so a batch graded by an older grader is never trusted by accident.

A model-driven suite is noisy: the same arm against itself flips a case or two between trials, so one trial never
ships. A grader comparison re-judges the same recordings and is exempt.

## Reports over arms

`evals report <label>=<iteration>[,<iteration>...] ...` compares arms over their trials: runs, strict pass, strict
`pass^k`, "no blocker failed", item pass rates by area (the letters after the plugin prefix of an item id, `H-PR01`
is `PR`), calls, seconds and tokens per run; a per-case table of strict passes of trials; and, for every arm against
the first, a paired bootstrap over the cases both ran (5000 resamples of the per-case difference in strict-pass rate,
a 95% percentile interval). Each comparison seeds its own generator from its two arms' iterations and the cases
they share, so an arm's interval is the same whichever other arms are listed. The rows are compared on the cases
every arm ran; `--all-cases` lifts that.

`--set tune|holdout|tools|all` selects cases by their own metadata, the same sets the runner uses: `holdout` is a case
with `Holdout: true`, `tools` an id starting `tools-`, `tune` the rest. A plugin defines its own sets with a
`Set:` header (`--set core`, `--set smoke`); a case with `Status: retired` or `deferred` is in no set. A run of a `Seed: time=day` case recorded on
another UTC day than its world's is dropped, and the report says how many.

## Running

`evals run` launches one sandboxed OpenCode run per (case, trial) and writes the recordings the trace step reads:
[running.md](running.md) has the sandbox, the credential profiles, worlds and their freshness, and the checks made
before a batch starts.

## The store

Everything a run produces lives outside the repository: [configuration.md](configuration.md#the-store).
