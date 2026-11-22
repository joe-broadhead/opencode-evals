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
- Data: synthetic | seeded | own | real | candidate                      (optional: what the case reads, below)
- Controls: no-skill (expect fail: <ITEM>); old-version (expect pass)    (optional)
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000           (optional)
- Seed: cwd=api time=day plugins=slack,linear files=jobs-nightly         (optional: pairs split on spaces; a comma stays in its value)
- Holdout: true                                                          (optional)
- Checkable: sessionID, query, sql, command                              (optional: below)
- Set: wide | route | deep | commit | hooks | local, or the plugin's own (core, smoke)   (optional, a comma list)
- Status: active | retired | deferred                                    (optional; default active)

## Prompt
<what the user types; `{{target:<alias>}}` and `{{canary:<name>}}` are filled at run time from the private store>

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
| `absent-arg:<tool> args.<key> <op> <value>` | no call of the tool passed an argument that compares (`absent-arg:history.read args.full == true`); positive ops only; a value the trace keeps only as a shape, or a variable, makes it unverifiable unless a call is seen to match |
| `count:<tool> <op> <n>` | the number of calls compares |
| `counts:<tool>#<n>.<key> <op> <n>` | a count read from that call's result compares |
| `text:<span> matches\|not-matches /re/` | the answer's `any`, `first-line`, `first-paragraph` or `last-line` matches |
| `text:<span> count /re/ <op> <n>` | the number of matches compares |
| `first:<tool>` | the first call, skill loads and Code Mode's `execute` wrapper aside, is that tool |
| `before:<a>,<b>` | the first `a` came before the first `b`, or `b` never happened (`before:history.*,bash`) |
| `skill:<name>`, `absent-skill:<name>` | the skill was, or was not, loaded |
| `declined:<tool>`, `absent-declined:<tool>` | a call was, or was not, declined by a permission |
| `budget:<name> <op> <n>` | `outer_calls` (every tool call the model made: skill loads, Code Mode's `execute`, direct tools), `inner_calls` (every call the code inside an `execute` made), `billed_calls`, `tokens`, `wall_ms`, `turns`, `cost_usd` |
| `cost:matches-appended [tolerance <n>]` | the answer's cost line matches the plugin's appended one |
| `state:<path> ==\|!= <value>` | the final state, from the case's oracle file |
| `target:<tool>#<n> args.<key> in <where>[,<where>...]` | every value of the call's argument (a list included) is in one of the places: `@<alias>` (one of its values in `$EVALS_STORE/targets.json`), `@<alias>*` (starts with one of them: only for an alias the targets file declares a prefix (a name ending `.prefix` or `_prefix`, or listed in `prefixes`), at least 8 characters, ended by a separator, so `evals-232-` and not `e`; a value with a `..` path segment is never within it; a grading check on a name the owner keeps unique, **not a confinement**: the guard's commit plan takes exact aliases only), or `created` (**advisory: a blocker may not rest on it**; the value is an id the trial's own completed **write** returned and did not receive: the guard logs each write's input leaves and the id its result gives to what it made (an `id` field of the written thing, not a parent, owner or workspace it names), so a read's result, an update's echo, a failed write and a script's invention add none; a create-then-use inside one script counts; an id is at least 8 characters with a digit). Unverifiable without the recording, without the guard's log, or without a named alias |
| `gws-plan:#<n> op == <operation>` | the n-th `gws_plan` call asked for this operation (`!=` too) |
| `gws-plan:#<n> target in @<alias>[,@<alias>]` | what that plan would touch is inside the alias: a mail's `To`, `Cc` and `Bcc` (decoded from the Gmail `raw`), else the file, calendar, sheet, document or list ids it names; a plan whose target cannot be read is unverifiable |
| `absent-write:<plugin>` | no call, declined or not, of any write tool of the plugin (the packs' `class: write`) |
| `committed-write:none` | no write completed: the guard's record when it ran, and a direct write call the trace shows `ok` |
| `guard:clean` | the guard ran and logged no refused write, no `EVALS-ASSERT access` and no committed write; unverifiable when it did not run |
| `unknown-tool:none` | no call named a tool that does not exist (Code Mode's `Unknown tool …`, the host's `No tool named …`) |
| `text:<span> contains @canary.<name>` | the answer states the seeded fact in `$EVALS_STORE/canaries.json` (every value of a list; case-insensitive) |
| `file:<glob> exists\|absent\|changed\|deleted` | a file the run wrote in its working directory (`*` within a directory, `**` across) |
| `file:<glob> matches\|not-matches /re/` | the text of the files it wrote (64 KB at most each) |

An argument that was not passed satisfies `!=`, `not-matches` and `excludes` (it equals nothing and matches nothing)
and fails every other operator, `present` included. "Not passed" means the trace shows it absent: a nested object is
kept as its list of keys, so a key it lists (`args.filter.lang`) was passed with a value the trace does not carry,
and a clause on it is unverifiable, never satisfied; so is anything under a variable. A path under a string reduced to
its shape names nothing that was passed: a positive clause on it fails, and a negative one is unverifiable. On a list (several query phrasings), `matches` and `contains`
hold when one element does, `not-matches` and `excludes` when none does. `contains` and `excludes` ignore case.

A case whose clauses were written from numbers the world derives (a count, a cost, a session id) declares them:
`Truth: sql.avgCostByAgent[agent=build].avg_usd == 1.08; ids.stripe-v2 == ses_…`. A path is dotted keys, a list index
(`.0`) or a list element picked by a field (`[agent=build]`). The world names its truth file (world.json `"truth"`);
`evals run` checks every selected case's claims after the world is current and before anything is reserved, and
refuses the batch on a claim that no longer holds, so a world change cannot silently move a case's answer.
`evals truth --plugin <id> --world <dir>` prints the check on its own.

A trace reduces every free-text argument to a shape, so a session id, a query, an SQL statement or a shell command
cannot be compared from it. A case that needs to compare one declares its key: `Checkable: sessionID, query`. For
those keys, and only for them, the grader reads the value from the private recording at grade time (call by call, in
the trace's order); the trace still holds only the shape. Without the recording, such a clause is unverifiable.

**Conventions** (settled for EVALS-232; `evals compile` enforces them):

- *Item ids* are `<PREFIX>-<AREA><nn>`; the areas are `TR` skill, `RT` routing, `OC` outcome, `PR` arguments or process, `CT`
  citation, `WR` write, `DT` date window, `ER` error recovery, `EF` efficiency, `RL` reliability, `SF` safety, `RB` robustness.
- *Case ids* say what a case is for, and the `Set:` header must agree: `wide` is `tools-<tool>` (a paraphrase twin
  `tools-<tool>-p`); `route` is `route-<slug>` (`route-no-<n>` should-not-call, `route-<topic>-<n>` overlap routing); `deep`
  is `deep-<slug>` (`deep-x-<slug>` cross-plugin); `commit` is `commit-<slug>`; `hooks` is `hook-<slug>`; `local` (the
  credential-free arm: shell and file tools on) takes any id and is combined with another set (`Set: route, local`). Any
  other lower-case set name is the plugin's own. `tune`, `holdout`, `tools` and `all` are `--set` families and cannot be
  declared.
- *Fail closed for a tool no pack lists.* The sealed config's permissions are, in order: the locked core tools denied; each plugin's namespace (`<id>_*`, `gws.*`) as an `ask`; the reads the plugin's OWN rules allow at the trial's access (`plugin-rules.json`, recorded from the host; the harness is never more permissive than the plugin: a read it asks consent for, such as Slack's private search or X's direct-message reads, stays an ask) and the metered spending reads (`CAPPED_SPEND_READS`, the one listed exception) as `allow`; every write and confirm-only read as `ask` (the commit set's own named actions `allow`). The host lets the last matching rule win, so a tool a plugin registers that its pack does not list matches
  only the namespace ask: asked, and declined by `opencode run`, whatever `access` the plugin runs at. The guard (`known` in its policy) treats such a tool as a write: left to the ask in refuse and log mode, refused at
  `execute.before` in commit mode unless the commit set names it, and a completion is recorded as `committed` and halts the wave. Packs are checked against `registered.json` and `live.json` (`evals pack`).
- *Companions.* A case may name the tools of a plugin its `Seed: plugins=` lists (a deep case that summarises an interview and posts the action items to Slack names Slack's send), in `call:`, `declined:`,
  `target:`, `first:`, `before:`, `absent:` and `count:`; each is checked against that plugin's own pack, and a plugin the case does not seed stays refused (only `route` may name any sibling).
- *What compile checks about arguments and consistency.* `args.<name>` in `call:`, `target:` and `absent-arg:` must be a parameter the tool takes, from the pack's `inputs.json` (parameter names only, captured by `scripts/capture-inputs.mjs` from a signed-in
  (parameter names only; every tool of every pack has one, from its plugin's source at the release tag, the vendor's schemas or a signed-in host's listing, except eleven tools the vendors do not list to the pinned sign-in, which say why; `evals pack` prints the coverage and compile refuses an argument clause on a tool with no schema). A case that requires a call and forbids it is refused
  (`call:`/`declined:`/`first:`/`before:`/a blocker's `count >= 1` against `absent:`/`absent-write:`/`count == 0`). A checked value the prompt, seeds and fixture never mention is a warning (`warning:` on stderr).
- *The data floor is over tools.* Each pack's `reach.json` (built by `scripts/reach-marks.mjs`) marks the tools that can return content that is not in a sandbox (workspace-wide searches and lists, user directories,
  transcripts and conversations, signed URLs) with the least `Data:` a case that can call one may declare; `evals compile` refuses a lower label. A case can call the tools its clauses name in its own plugin
  (`call:`, `first:`, `before:`, `count:`, `target:`) **and every marked tool of each plugin in `Seed: plugins=`** that holds a sign-in (a companion is installed with it; a fake-mode plugin holds none). A tool's floor lifts only
  when **every call** to it is constrained, on the argument that selects what it returns, to a sandbox alias. The mark names that argument (`scope` in `reach.json`: the channel id, the page id, the agent id; a tool with no such
  argument, or marked `unscopable`, never lifts). The case needs, in **blocker** items and outside `evidence_any` and `n/a_when`, a `count:<tool> <= N` (or `== N`) and a `target:<tool>#n args.<scope> in @<alias>` for every
  call n of 1 to N; the aliases are exact (no `@alias*`, no `created`), belong to the tool's own plugin, and exist in the store's `targets.json` when it is at hand (`evals compile` reads it; without a store only the plugin
  is checked). A weaker clause (a minor item, one alternative, a condition, call #1 of two, another argument, a loose alias) does not lift the floor. `gws read` is `own` the same way: `count:gws.read <= N` and
  `call:gws.read#n args.operation == drive.… | calendar.…` for every n; anything less is `real` (Gmail). A fake-mode case that seeds a plugin with a sign-in takes that plugin's floor instead of `synthetic`. It sits on top of the plugin-level minimum
  (granola, plaud, metaview, ...). What it does not see: a tool the case neither names nor seeds, which the model calls on its own plugin. So the label of a case is the writer's word for the plugin's own unnamed tools (the floor covers the tools a case names and every marked tool of a companion); a run of such a case below `real` is the writer's responsibility, and the case reviews are where an unnamed marked tool is caught.
- *Holdouts* are `Holdout: true` with the id `hold-<plugin>-<n>-<slug>`, written into `$EVALS_STORE/holdouts/<plugin>/` only. A holdout needs **no** round set and none of their id prefixes (a `hold-` id
  or `Holdout: true` is exempt from both rules), and it is in **no selection but its own**: `--set tune`, `tools`, `all`, a round set (`local`, `wide`, `deep`, ...) or a plugin's own set never returns one, whatever
  `Set:` it lists, and a `--cases hold-*` glob cannot reach it. Only a selection that names `holdout` (`--set holdout`, the plan's flag for `h0` and `h1`; `--set tune,holdout` for both) returns holdouts.
  So a holdout given `Set: local` is not one `--set local` away from a tuner. `all` is `tune` and `tools`.
- A case in one of this round's sets is in no family: `--set tune` and `--set all` never select it, so a default run cannot
  start a `commit` case (which really writes) or a `local` one (which needs the credential-free arm). Name the set.
- `Data:` says what the case reads. `synthetic`, `seeded` (made by the owner for the round) and `own` (the owner's own data,
  no third party) may run on any provider; `real` (a third party's words) and `candidate` (interviews, HR records) never run
  on an `opencode/*` model, and need the owner's sign-off for Claude. The runner skips them for `opencode/*`.
- `Seed: files=<name>[,<name>]` copies `fixtures/seeds/<name>/` (tracked) or `$EVALS_STORE/seeds/<name>/` (private) into the
  trial's project before it starts. A seed is a directory of plain files, no links; a name is one path segment.
- A tool name in a clause is `[A-Za-z0-9_.*-]+`: hyphens (`notion-search`) and camel case (`getJiraIssue`) are fine, and
  case matters.

A tool is a name, a glob (`x_*`), a namespace (`history.*`) or a qualified name (`history.read`). A plugin tool reaches
a run two ways, inside Code Mode's `execute` (ns `history`, tool `read`) or as a direct tool (`history_read`); a
namespace or a qualified name selects both. A bare name the case's own plugin declares is that plugin's tool
(`call:pin#1` is `history.pin`), except OpenCode's own tool names, which are never qualified. On every tested host
(2.2.3 to 2.2.6) they are the tools `@opencode/core` registers, `edit`, `experimental_image_generate`, `glob`, `grep`,
`patch`, `question`, `read`, `shell`, `skill`, `subagent`, `todowrite`, `webfetch`, `websearch` and `write`, and Code
Mode's `execute` (`BUILTIN_TOOLS` in `src/grade/select.mjs`); there is no `bash`, `task`, `list`, `todoread` or
`apply_patch`, and `search` is a function inside Code Mode, not a tool. A bare built-in name means every tool of that
name, the built-in included, so `absent:write` in a gws case still sees a built-in `write`; the plugin's tool alone is
written with its prefix, `history.read`, and `evals compile` refuses a case that names one bare while its plugin
declares a tool of that name.

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
result text, the rules, the plugin's options, the case set, the model and the host. A runner that records its own provenance is trusted;
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

`--set tune|holdout|tools|all` selects cases by their own metadata, the same sets the runner uses (`all` is `tune` and `tools`, never holdouts): `holdout` is a case
with `Holdout: true` or a `hold-` id, selected only by naming it, `tools` an id starting `tools-`, `tune` the rest. A plugin defines its own sets with a
`Set:` header (`--set core`, `--set smoke`); a case with `Status: retired` or `deferred` is in no set. A run of a `Seed: time=day` case recorded on
another UTC day than its world's is dropped, and the report says how many.

## Running

The opt-in [whole-trial containment path](owned-containment.md) moves the runner into its workload container.
It separates provisional execution from parent-only data finalization. Native completion and launcher integration remain unqualified.

`evals run` launches one sandboxed OpenCode run per (case, trial) and writes the recordings the trace step reads. Every
run is confined in its own Docker container, on a network whose only way out is a proxy allowing HTTPS to the model
provider's hosts, because a run's agent can execute tools and the sandbox alone isolates the environment, not the
filesystem: [running.md](running.md) has the isolation, the sandbox, the credential profiles, worlds and their
freshness, and the checks made before a batch starts.

## The store

Everything a run produces lives outside the repository: [configuration.md](configuration.md#the-store).
