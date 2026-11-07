# opencode-evals — phase 1

Deterministic evals for OpenCode skills, tools and plugins. This is phase 1 of `../EVALS-DESIGN.md` §11:
the analyser, the trace schema, the compiled case set, the graders, the provenance digest, the policy
function, the T0 static checks and the retroactive X scorecard — built from recordings we already had, with
**no live model and no X call**.

```
node bin/evals <command>       # Node 22, no dependencies, no build step
node --test test/*.test.mjs    # 62 tests, no model, no network
```

## What exists

| Path | What it is |
| --- | --- |
| `src/trace/analyse.mjs` | The inner-call analyser, promoted from `review/tools/eval-counts.mjs` with its replay test. Code Mode's `execute` reports `completed` whatever happened inside; this reads the declines, the HTTP failures and the thrown errors out of the code and its output. |
| `src/trace/innerArgs.mjs` | Inner call sites with their literal arguments, a balanced reader for object literals, and a syntactic binding (`const m = await tools.x.f(…)` → `return {m}`) so a result's counts can be attributed to a call. |
| `src/trace/redact.mjs` | The privacy layer: numbers, booleans and timestamps survive; every other string becomes `{len, shape, tokens}`. A query keeps its operators (`since:`, `from:`) and loses its content. |
| `src/trace/normalise.mjs` | Recording → `oc-trace/1`: run header (provenance, tokens, cost with its source, failure class) plus events (`tool_call`, `tool_result`, `skill_load`, `permission`, `answer`). |
| `src/case/` | Markdown → `oc-case/1`. One screen a person can review; strict JSON a runner can trust; every evidence clause parsed at compile time. |
| `src/grade/` | The evidence grammar, the item grader, the verdict rule, and the T-G gold cases. |
| `src/policy/` | `comparable()` and `decide()` — pure functions, unit-tested, no I/O. |
| `src/t0/x.mjs` | 13 static checks for the X plugin. |
| `src/report/scorecard.mjs` | The scorecard, and the item-by-item comparison with a hand grading. |
| `cases/x/` | 14 compiled X cases, 95 items, 86% code-decided, plus `evals.lock`. |
| `traces/nx1…nx7/` | The recorded X runs as `oc-trace/1`, privacy-clean. |
| `results/<iteration>/` | `verdicts.json`, `batch.json`, `scorecard.md` and `scorecard.json`. |
| `results/t0/x.json` | The static check report. |
| `fixtures/recordings/manifest.json` | What the recordings do not carry: model, date, rule set, and an explicit `unrecorded` for every hash that never existed. |

## The commands

```
evals compile [--plugin x] [--check]     markdown cases -> oc-case/1 JSON
evals trace --iteration nx6 [--from DIR] [--out DIR]
evals grade --iteration nx6              grade the iteration's traces
evals scorecard --iteration nx6          render the scorecard, compare with the hand grading
evals policy --a nx5 --b nx6 [--assume declared] [--json]
evals t0 [--root DIR] [--json] [--write]
evals lock [--epoch N]
evals selftest                           run the T-G gold cases
evals verify                             re-derive nx6 and refuse a mismatch
```

`evals verify` is the one to keep: it re-grades from the stored traces, cases and private text and fails if
any number moved. That is the "the tool reproduces its own numbers" requirement, executable.

## The three tiers this phase delivers

- **T0, static** (`evals t0`): 13 checks over the plugin checkout — skill frontmatter and size, the tool
  table against `jelly.tools` and the tools RPC, no denied tool reaching a method, no real handle or
  machine path in model-facing text, the namespace text's prefix tax, and the triggering surface (does a
  should-fire prompt share vocabulary with the description; does a should-not-fire prompt look like X).
  Every check is mutation-tested: `test/t0.test.mjs` breaks a fixture plugin one way per test and requires
  the matching check to go red.
- **T2, replay** (`evals grade`): the recorded runs are re-judged by code, with no model. Changing a rule,
  a threshold or a grader is a re-grade, not a re-run.
- **T-G, the graders' own suite** (`evals selftest`): six gold cases with known verdicts — must-FAIL with a
  named failing item, must-PASS, must-BLOCK on missing text, must-BLOCK on a variable argument, must-be-N/A,
  and an advisory item that must not move a verdict.

T1 (scripted transport) and T4 (live statistics) are phase 2 and 3. Nothing here starts a model.

## What the policy says about our own history

```
$ node bin/evals policy --a nx5 --b nx6
**HOLD** — basis refused
- not comparable: the rule set the cases encode changed: price-before-read vs cap-and-tell-after;
  a: skill is unrecorded; b: skill is unrecorded; description is not recorded on a; …
- the numeric delta below is advisory and cannot gate a release
```

That is the nx3r–nx5 lesson, enforced: the runs do not record which case set they used, and the case set
that encoded "price the read before you make it" is not the case set that encoded "cap the read and state
the actual cost after". `--assume declared` prints the numbers anyway, labelled, and `decide()` will never
ship on them. On the declared basis, nx5 → nx6 is still a **hold**: the handle-miss case gained a forbidden
violation (a guessed cause), which is exactly what the human grader also recorded and the loop shipped over.

## Privacy

The runs read the owner's real X account. No trace in this repository holds post text, a handle, a name, an
id or a link from X's results:

- arguments go through `safeArgs` (structure only),
- results are reduced to counts by a per-tool whitelist (`{posts: 10, users: 9}`),
- the answer is stored as a digest, and only its length and line count,
- the raw recording stays in `../private/raw/` (mode 700) and is named by digest in each trace header.

`test/trace.test.mjs` enumerates every link, handle and long id in a recording's *content* and asserts none
appears in its trace. Text-dependent items read the private recording; without it they are `BLOCKED`, never
passed.

## Deliberate deviations from the design document

- **Plain ESM on Node 22, not TypeScript.** No build step, no transpiler, tests on `node:test`. The module
  layout follows §11; the file extensions do not. The source is 2,975 lines and the tests 843, under the
  design's size ceiling.
- **Price table is empty.** `cost.source` is `missing` for every run rather than a guess, so cost per
  passing case is reported as not computable until the owner supplies rates (`src/trace/pricing.mjs`).
- **A failed major is a finding, not a case failure.** The verdict follows oc-factory: a blocker fails the
  case, an unsettled blocker-or-major blocks it, a minor is a note. Findings are reported and the policy
  treats a *new* major as `ask`, never `ship`.
- **`end_time` is often a variable** (`min(now-10s, next midnight)`), and a recording cannot inspect it.
  Three such items are `BLOCKED` for that reason; phase 2's capture plugin reads the arguments at the
  server boundary and settles them.

## What phase 2 needs

1. **A capture plugin** (`evals-capture`) that writes `oc-trace/1` events for what the run stream cannot:
   the resolved permission decision, the tool list offered to the model with description hashes, and the
   arguments as the MCP server received them.
2. **T1**: the mock provider (with invalid-argument, 429 and truncated-stream directives), the existing
   fake MCP, the isolated stock binaries 2.2.3–2.2.5, and `with-slot`.
3. **A price table**, and the ledger keyed on `(plugin, skills, descriptions, namespace, tools, rules,
   cases, model, host, grader)` — the schema is already in `batch.json`.
4. **The nine plugins**: the same pack, with T0 per plugin and four holdouts written by a lane that never
   tunes.
5. **Calibration**: ~120 hand labels to move the first judge items off advisory (D2 requires κ ≥ 0.6).
