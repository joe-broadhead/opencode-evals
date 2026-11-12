# Changelog

Keep a Changelog. This project adheres to Semantic Versioning.

## [Unreleased]

### Added

- `evals run`: the live runner, ported from the History lab into the harness and made plugin-generic. One sandbox per
  (case, trial), isolated like T1 (its own HOME, XDG tree, TMPDIR and database, a sealed `OPENCODE_CONFIG_CONTENT`, an
  environment built from nothing), its own `opencode serve` on a free port, and its own recording
  (`raw/<it>/<plugin>/<case>.t<k>.jsonl` + `.summary.json`): trials no longer overwrite each other or share a sandbox,
  and two runners no longer need hand-picked ports. Cases come from this repository's `cases/<plugin>` and the sets
  are the case metadata's. An existing recording is never overwritten (`--append` adds trials). The credential source
  is a required `--auth` profile (`none`, `env:<VARS>`, `claude-agent`); `claude-agent` pipes the stored "Claude
  Agent" credential into each sandbox and removes the `claude` transcripts each run leaves. A world (`--world`, a
  directory with `world.json` or a module) seeds each sandbox; a stale world, or one built by another build, is rebuilt
  with the build under test or refused. The dollar budget and the run caps are checked, and the whole batch
  reserved, before anything launches. Summaries record the runner, its version, the host, the world and the build's
  provenance. See `docs/running.md`.

- `docs/design.md`, which the README and `docs/configuration.md` linked to and nobody had written: the pipeline,
  the case format and its clauses, traces, grading and the policy. A test now fails on a doc link to a missing file
  or heading.

- Trials are first class: `<case>.t<k>` in the recordings, traces and verdicts, every trial kept. A case's batch
  entry passes only when every trial passed (`pass^k`), and `batch.json` reports `trials`, `strict` (every blocker
  and major item passed, the bar `PASS` does not set) and `pass_k`. `evals policy` prints both.

- `evals report`: arms compared over trials, ported from the History lab's report script — strict pass, strict
  `pass^k`, item rates by area, calls, time and tokens, a per-case table, and a paired bootstrap over cases against
  the first arm. Each comparison has its own random stream, seeded from its arms and cases: the lab script shared
  one, so an arm's interval moved when another arm was listed.
- Case sets from case metadata (`src/case/sets.mjs`): `tune`, `holdout` (`Holdout: true`) and `tools` (`tools-*`),
  shared by the runner and the report. History is 47, 10 and 9; the lab runner's `--set tune` took 56.

- Run caps and a run ledger (`src/cost/ledger.mjs`, `$EVALS_STORE/ledger/runs.jsonl`): a batch reserves its runs
  under a lock before anything launches, and is refused whole when it would take a plugin past 800 runs in a month,
  every plugin past 13000, or an iteration past its own cap (`EVALS_MAX_RUNS_*`, or `caps.json` in the store). Every
  run counts, priced or not, so a subscription eval, which the dollar cap cannot see, is capped too.
- `evals budget` prints the runs reserved this month per plugin; the month's dollars include the ledger's runs, and
  `projectedSpend` prices a planned batch from the month's priced runs.
- `cost/model-map.json` maps `claude-agent/haiku` to `anthropic/claude-haiku-5-5`.

- `evals verify --all` lists every graded iteration whose grader or case set has moved since it was graded, and the
  scorecard and `evals verify` say so too: a batch graded by an older grader no longer goes stale silently.

- Packs for twelve more plugins (boxd, browse, charts, elevenlabs, github, gws, jobs, plaud, slack, tavily,
  utilities, voice): 22 in all.

- Case headers `Checkable:` (argument keys the grader compares from the private recording, never stored in a
  trace: session ids, queries, SQL, shell commands), `Set:` (a plugin's own run sets, such as `core`, `guard`,
  `smoke`) and `Status:` (`retired` and `deferred` cases are in no set).
- `contains` is implemented (it parsed, and always failed); on a list argument, `matches` and `contains` hold when
  one element does.

- Arms carry plugin options: `evals run --arm <file>.json` (`{ "package": …, "options": { "access": "ask-changes" } }`)
  or `--options`. The options are recorded by digest and are a provenance axis, `options`, so an access-mode arm is
  compared on that axis and refuses a comparison on any other.

### Changed

- `evals compile` needs `--plugin <id>` or `--all`: without them it compiled `x` and rewrote its JSON, and
  `compile --help` did the same. `--help` (and `-h`) on any command prints the usage and runs nothing; an unknown
  command is an error. `compile --check` writes nothing and exits non-zero when a committed JSON is stale; CI runs
  `compile --all --check`. The x case JSON is recompiled: it lacked the `seed` field the compiler emits.

- An argument that was not passed now satisfies `!=`, `not-matches` and `excludes` instead of failing them.

- The tool selector: `history.*` also selects the direct `history_*` tools (`history_pin`, or every tool when Code
  Mode is off), `history.read` also selects a direct `history_read` and never the built-in `read`, and a bare name the
  case's plugin declares is qualified with its namespace when graded, so `call:read#1` in a History case no longer
  matches the built-in file `read`.

- `evals pack` derives its plugin list from configuration instead of a list of ten in the code: every committed
  snapshot, and every plugin checkout under `EVALS_PLUGIN_ROOT` or named by `EVALS_REPO_<ID>`. `evals t1` and
  `evals t0-all` use the same list. A pack records the plugin's `access` option and its default.
- Every pack was regenerated: each plugin now declares its tools `allow` at its default access, `all`, so 207 tools
  that were `ask` (135) or `deny` (72) are `allow`, and two tools' `readOnly` flags changed. Tools added: x, granola, linear and
  wisprflow `events_list`, jira `getContentFormatGuide`, ashby `list_interviews`, and nine notion tools; removed:
  ashby `get_upcoming_interviews`, notion `notion-update-enabled-skills`. History's pack is at its v0.0.0 checkout.
- T1's describe check judges a method against the tool's declared effect: a write that resolves `allow` at access
  `all` is the declaration, not a defect; a tool declared `ask` or `deny` that resolves `allow` still fails.
- Pack drift prints a changed version or id old -> new, like the tool changes; it printed new -> old.

- The scorecard is titled by the plugin (its pack name), not "X plugin"; it lists the runs an iteration made, one row
  per trial, and counts the declared cases it did not run instead of listing each as `NOT_RUN`. It reports strict pass
  and, with trials, strict `pass^k`; its alias-mapping line names the run's own model.

- Mapping drift is checked per alias against its own family: a newer Opus no longer marks a Haiku alias stale.

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
