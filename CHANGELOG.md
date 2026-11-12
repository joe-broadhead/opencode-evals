# Changelog

Keep a Changelog. This project adheres to Semantic Versioning.

## [Unreleased]

### Added

- `docs/design.md`, which the README and `docs/configuration.md` linked to and nobody had written: the pipeline,
  the case format and its clauses, traces, grading and the policy. A test now fails on a doc link to a missing file
  or heading.

- Trials are first class: `<case>.t<k>` in the recordings, traces and verdicts, every trial kept. A case's batch
  entry passes only when every trial passed (`pass^k`), and `batch.json` reports `trials`, `strict` (every blocker
  and major item passed, the bar `PASS` does not set) and `pass_k`. `evals policy` prints both.

### Changed

- `evals policy` never ships on fewer than two trials per case (`LIMITS.minTrials`); it asks, and says why. A batch
  graded before trials were recorded counts as one trial.

- T1 covers OpenCode 2.2.6 (`OPENCODE_BIN_2_2_6`), the plugins' fourth tested host, and finds a stock binary on
  Linux: `EVALS_STOCK_DIR` resolves the `@opencode/cli-<platform>-<arch>` package npm installed for this machine
  (glibc before `-baseline`, the `-musl` pair on musl) instead of only `cli-darwin-arm64`.

### Fixed

- `outer_calls` meant two things: the trace head counted every call the model made, while a grade budget left out
  Code Mode's `execute` itself and counted it as an inner call instead. Both now count the same: outer is every call
  the model made (a skill load included), inner is every call made by the code inside an `execute`. Budgets graded
  before this change can move by the number of `execute` calls, and the grader digest moves with them.

- `trace` wrote `traces/<iteration>/` while the docs said `traces/<iteration>/<plugin>/`: it now writes per plugin,
  reads `raw/<iteration>/<plugin>/` when `--from` is not given, and every reader falls back to the old layout.
- A trace header named `review/tools/run-evals.mjs` as its runner whatever made the recording; it now carries the
  runner and version the recording's summary names (`unrecorded` when it names none), and its raw reference names the
  plugin instead of `x`.

- `grade` read recordings from `../private/raw`, beside the repository, while the docs and the runner put them in
  `$EVALS_STORE/raw`. Every command now resolves the store in one place (`src/store.mjs`); `EVALS_RAW` and
  `grade --raw DIR` still point elsewhere, and `grade --cases DIR` and `--traces DIR` do what the usage line said.

## [0.1.0] - Unreleased

### Added

- A pack and 66 cases for the History plugin (`packs/history`, `cases/history`): lookups, listings, aggregates, safety
  and "never happened" questions, a holdout of ten, and nine tool-forced cases that make every tool and parameter
  family necessary once. Every item is code-decided. See `docs/history.md`.
- `pack.vocab`: a plugin declares the values that belong to its own grammar (enum values, tool names) and the trace
  keeps them verbatim instead of reducing them to a shape, so `args.scope == all` can be asserted.
- `Seed:` in a case header (for example `cwd=api time=day`) is carried into the compiled case, for a runner.
- The tool selector accepts `ns.name` for an inner Code Mode call (`history.search`).
- A trace written by a runner that records its own provenance (`summary.provenance`: the plugin build, skill,
  descriptions, result text and rules, each by hash) is trusted over the hand-kept manifest, and the batch exposes every
  axis, so `evals policy --axis skill` and `--axis description` compare two arms that differ in exactly one.

### Changed

- `trace`, `grade`, `verify` and `lock` take `--plugin`; they assumed `x`.
- A call whose whole argument object is a variable (`events_list(args)`) is unverifiable, not "key missing".
- The host version is `recorded` when a trace carries it.
- T1 links the SDK checkout's `node_modules` into the plugin's temp directory, so a bundle that leaves
  `@opencode/plugin` external (as History's does) loads.

- `oc-trace/1`: a normalised trace of a run — permissions, tool calls with their arguments at the MCP
  boundary, Code Mode inner calls, skill loads, split token counters, cost with its source, timings, and a
  failure class. Content is reduced to structure: no text, handle, id or link.
- The inner-call analyser: Code Mode's `execute` reports `completed` whatever happened inside it, so
  declines, upstream failures and thrown errors are read from the code and its result.
- `oc-case/1`: evidence-bound checklist items, compiled from a one-screen markdown file. Every clause is
  parsed at compile time; a clause that cannot be settled makes its item `BLOCKED`, never a pass.
- Graders that decide in code, judge only where code cannot, and four verdicts: `PASS`, `FAIL`,
  `BLOCKED`, and per-item `N/A`.
- Gold cases that test the graders: must-fail with a named failing item, must-pass, must-block, must-be-N/A.
- `comparable()` and `decide()`: promotion as a pure function, and a refusal to compare two runs whose case
  set, rules, model or harness digest differ.
- A capture plugin that records the resolved permission decision, the tool list and the MCP boundary, and
  changes nothing: a scripted session with it and without it is the same session.
- T1: an embedded OpenCode host proves what a plugin makes possible with no model — that it loads, that its
  default rules guard the agents it claims, that a write asks and is refused, that a denied tool is refused
  before dispatch — plus the tools RPC and a stock-binary run for the shaper case.
- Packs for nine plugins, derived from each plugin's own declaration, with T0 static checks and live
  checklists.
- The cost rule: every model call records what the provider billed and what OpenCode's own models.dev
  catalogue would charge; billed wins, a subscription falls back to list price, a catalogue zero is free, and
  an unknown model is `missing` rather than zero. No model price is typed into the repository.
- A vendor price table with a source and a date for every rate, reported beside the model spend, and a cost
  per passing case that is reported as missing rather than guessed.
- A monthly budget cap, enforced in the runner and printed on every scorecard.
- A hand-label kit for calibrating judges: one screen per advisory item, one key per label.
- `evals privacy`: a pre-publish gate over the working tree and the whole git history.
