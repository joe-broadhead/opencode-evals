# Changelog

Keep a Changelog. This project adheres to Semantic Versioning.

## [Unreleased]

EVALS-232: the harness for a round that runs every plugin against live accounts (lane L1).

### Changed

- **The boxd pack re-synced to v0.1.3** from its published release tarball (`SHA256SUMS` verified): the release adds the app-facing `boxd.works.list` source only, so no model tool, parameter or skill changed and no case changed. `registered.json` and `plugin-rules.json` re-recorded over all 24 packs from the verified release builds: only boxd's release block changes.
- **Packs re-synced to the wave's later releases**: x v0.0.7 to v0.0.8, history v0.0.7 to v0.0.8, linear v0.0.6 to v0.0.8 (v0.0.7 changed no declaration), jobs v0.0.3 to v0.0.4 and slack v0.0.6 to v0.0.7, each from its published release tarball (`SHA256SUMS` verified). The releases add app-facing `.list` sources and `jelly.cost` only: no model tool, parameter or skill changed, so no case changed. `registered.json` and `plugin-rules.json` were re-recorded for all 24 packs from builds verified byte for byte against each release tarball; eight earlier companions were lane checkouts that differed from their releases (five carried an older `dist/`: boxd v0.1.1, notion v0.0.4, openrouter v0.0.5, browse and voice v0.0.3), and re-recording from the verified builds changed none of their names or decisions. Two `fail-closed` tests now read the Slack pack's version instead of hard-coding it.
- **Packs re-synced from the plugins' releases** (the sync of #14: `evals pack --sync --release`, then `scripts/registered-tools.mjs` and `scripts/plugin-rules.mjs` against the release's own built tarball, checksum-verified, then `scripts/capture-inputs.mjs`):
  gws v0.0.10 to v0.0.11, wisprflow v0.0.6 to v0.0.7, tavily v0.0.5 to v0.0.6 (all five tools are spend-class: they ask at `ask-changes`; the harness still allows search, extract and map inside the credit cap, and research and crawl
  stay confirm-only; `P0-tavily` now runs against the released build and not a stand-in), metaview v0.0.6 to v0.0.7 (`events_list` leaves the model tools: 69 to 68), github v0.0.6 to v0.0.9, granola v0.0.6 to v0.0.7 (two new writes,
  `update_meeting_title` and `update_summary`: 21 to 23), elevenlabs v0.0.9 to v0.0.10 (eight new tools: 239 to 247), plaud v0.0.7 to v0.0.8, jira v0.0.5 to v0.0.6, affinity v0.0.6 to v0.0.7 (21 new tools: 82 to 103), ashby v0.0.6 to v0.0.7 (six new tools: 16 to 22). Each pack records its
  release `{ version, tag, commit }`. `scripts/live-extra.json` lost the reasons for the tools these releases now classify (ElevenLabs' eight, Granola's two, Affinity's 21, Ashby's six); it keeps only metaview's `events_list`
  (the signed-in host still runs v0.0.6).
- **`evals pack` also fails a sidecar recorded from another build of the same version.** `registered.json` and `plugin-rules.json` must carry the release commit the pack records (a rebuilt or re-tagged release with the same version
  number differs there), and `plugin-rules.json` may not decide an action the pack does not list (a tool the release dropped). What a fresh build registers is compared by `scripts/registered-tools.mjs --check` and
  `scripts/plugin-rules.mjs --check`, which need the builds and Docker, so CI runs the committed-sidecar check only.

### Fixed

- **Canary seeding reads the tools-RPC envelope, so a rerun reuses its canaries** (`scripts/seed-canaries.mjs`). A tools-RPC answer is
  `{ output: { output: <the tool's value>, text } }`; `unwrap` now descends it through `toolValue` in `scripts/profile/profile-lib.mjs`, the one
  definition the identity reads use too (`errorSignal` shares `rpcEnvelope`). Before, `find` read the envelope instead of the list, never matched,
  and every rerun created the canary again (duplicates of the issue and document canaries in the sandbox team; Linear refused the milestone's
  duplicate). A `find` whose `items` path is missing, or is not a list, is now an answer shape the seed refuses rather than falls through to
  create, and the one seeding session is deleted on every path, as the walk's `withCheckSession` does.
- **The harness is never more permissive than the plugin** (review of #14, round 4: the allow written for the pack's reads overrode eight asks the plugins make on purpose for private content, Slack's private search and file read
  and X's six direct-message reads). The sealed config now allows only the reads the plugin's OWN rules allow at the trial's access, taken from the host, not from the pack's read list: `packs/<id>/plugin-rules.json`
  (`scripts/plugin-rules.mjs`: all 24 builds loaded with none of the harness's rules, the probe plugin asking the host about every action of every pack; `evals pack` fails a pack with none, of another release, or that does not decide
  every action). Any read the plugin asks for stays an ask and is declined in a trial; a pack with no recording gets no read allowed. The one exception is Tavily's three metered spending reads (search, extract, map: they run inside the
  round's credit cap, and a case about them stays measurable once Tavily marks all five spend-class), listed with its reason in `PERMISSIVE_EXCEPTIONS`; research and crawl stay confirm-only. `P0-consent` measures every plugin twice
  (its own rules alone, then under the sealed config) and fails any allow the plugin does not make bar that exception, checks the eight reads by name, the confirm-only reads, an unlisted tool in four plugins and that the recording is
  what the host resolves; it fails when the allow is derived from the pack's reads again. `lockdownProblems` names an allow the plugin does not make.
- **The harness is fail-closed for a tool no pack lists** (review of #14, round 3: ElevenLabs' live server lists eight tools v0.0.9's pack lacks, one of which places phone calls, and nothing classified them as writes).
  In every locked trial: (1) the sealed config asks for each plugin's whole namespace (`<id>_*`, `gws.*`), then allows the pack's reads, then asks every write, so a tool the pack does not list is an ask, declined, at any `access` of the
  plugin; (2) the guard records every tool of every pack (`known`) and treats a plugin's tool outside it as a write: left to the ask in `refuse` and `log` mode (execute.before fires before the ask), refused in commit mode with
  `EVALS-ASSERT tool: <name> refused (a tool no pack lists, and the commit set does not name it)`, turned from an allow into a deny at the permission hook, and recorded as `committed` when it completes, which halts the wave like
  any committed write; (3) a commit set may name such an action, and it is then the plan's declared write (extractor, aliases). `P0-unknown` runs it end to end with the fake pack list (`lockPacks`, a probe-only switch no flag
  reaches): asked and declined at `all` and at `ask-changes`, refused in commit mode, completing one halts the wave, control with the tool in the pack; both layers fail it when removed. `lockdownProblems` now evaluates the rules as the
  host does (last match wins, wildcards) and checks the namespace asks come first.
- **A pack is checked against what its release registers and what a host lists** (`src/pack/listing.mjs`): `packs/<id>/registered.json` (the built release loaded in the host with no sign-in, listed by Code Mode's `search`:
  `scripts/registered-tools.mjs`) and `packs/<id>/live.json` (a signed-in host's listing, read-only: `scripts/capture-live.mjs`); `evals pack` prints `release`, `registered` and `listed` per plugin and FAILS a pack that lacks a tool
  either holds, one with no recorded release, or a reason (`scripts/live-extra.json`) that has gone stale. 37 tools the host lists and the pinned packs do not (affinity 21, ashby 6, elevenlabs 8, granola 2: newer builds and the
  vendor's own additions) each carry a reason. Every pack records `release: { version, tag, commit }` (`scripts/record-releases.mjs`; `evals pack --sync --release` records it); a sync adds a tool the release registers and the
  declaration omits as an unclassified write. Every release's registered tools were already in its pack (including `events_list` for metaview, jira and elevenlabs).
- **Tavily stays measurable when all five tools become spend-class.** The plugin's rule block asks for each at `ask-changes`; the harness's rules come after it and the last match wins, so search, extract and map are `allow`
  (`CAPPED_SPEND_READS`, metered by the round's Tavily credit cap) and research and crawl stay confirm-only, whatever class the pack gives them; the guard does not count the three as writes. `P0-tavily` checks it against a build whose
  block is the spend-class one (`EVALS_TAVILY_SPEND_BUILD`, else a stand-in made from the installed build) at both accesses, with a control showing the plugin itself asks for search when the harness's rules are removed.
- **A trial that ends with no summary always says why** (re-check of #13, R5: 1 of 50 `p0 a1` runs lost a trial and its cause). The runner writes a stub summary (`infra: trial_incomplete`) when it begins a trial and replaces it
  with the trial's own; a trial whose job throws gets a failure summary (`infra: trial_error`) with the phase it reached, the error and its stack, what Docker said of the container (state, exit code, OOM kill, the last log lines, its
  processes), the exit code and signal, and is reported by the batch (exit code 1) and by the probe first, as the cause; a run that ended with no exit code (a signal, an OOM kill) is `trial_error` too. The probe also reads a trial with
  no summary file at all: the runner's error, its log lines for the trial, or that it was never launched. **What it found:** `docker exec -i` can lose its end-of-file under load, and the command inside waits for it for ever: `opencode run`
  (idle at 0 % CPU, the mock never asked) and the readiness `curl --config -` (alive past its `--max-time`). `docker exec` now attaches no standard input unless there is input to send (`stdin: true`), and the readiness password rides the
  container shell's own pipe from the exec's environment. An idle scripted client is also replaced once (`client_restarts` in the summary, with the container's processes; a NOTE in the probe output; a second hang is still
  `no_model_request`; first-request deadline 90 s, `EVALS_CLIENT_RESTARTS=0` turns it off). Two batches creating Docker networks at the same moment got overlapping subnets (`networks have overlapping IPv4`): the create is tried again,
  up to eight times. The guard marker counts only at the start of an errored result; `p0 a1`'s file tools use 2.3.2's argument names (`path`, `oldString`); a test pins that only a scripted trial has a stall watch.
- **`refused()` could pass a call that completed** (review of #13). A refusal is now a call that ended in an error and carries the guard's own marker (`EVALS-ASSERT tool: … refused (`) or the host's first words; a completed call never is,
  whatever its output says. `p0 a1` passes only when a write was attempted and refused with none completed; "no call recorded" is an ERROR that says the call was never made; a trial that hung before its first model request is
  reported first, as the cause, by every probe. The runner kills a scripted trial that has made no model request within `EVALS_FIRST_REQUEST_S` (150 s) and records it as infrastructure (`no_model_request`: never graded, its run
  released), instead of waiting out the 420 s timeout.
- **The legacy exemption is a frozen list of case ids** (`src/case/legacy-cases.json`), not a rule about the plugin: a new History, X or Charts case, or a `Plugin: p0` case, meets every round rule. `Holdout:` is `true` or `false`.
- **The fake Jira and GitHub servers read `OR`** (and a comma in `label:`), and refuse parentheses, `NOT` and a dangling `OR` with an error instead of returning nothing.
- **`evals compile` refuses a literal `<placeholder>` in a prompt** (104 lane cases had them); `- Angle brackets: <h1>, </h1>` lists the tokens a prompt really quotes. The History, X and Charts corpora written before the round are exempt.
- **The fake Jira reads `resolved`/`resolutiondate`, `resolution` (`Unresolved`), `statusCategory`, `is EMPTY|NULL`, and Jira's date functions** (`startOfDay/Week/Month/Year()` and `endOf…`, with increments; weeks start on
  Monday; now is fixed), so a "done this week" case can be asked and graded; the fake GitHub reads `merged:` and gives a merged pull request its `closed_at`.
- **`setCounts` returned NaN for the round sets** (`counts.round++` on a key that does not exist); it now counts every `Set:` name as a number and a holdout as a holdout only. The History and
  Charts tests no longer pin their corpora's case counts (a pull request that adds a case broke the harness's own tests); they derive the expectations from the compiled cases.
- **Holdouts are in no selection but their own.** A holdout (`Holdout: true` or a `hold-` id) needs no round set or id prefix (the holdout lane had to give 84 of them `Set: local`, which made them one
  `--set local` away from a tuner), and `--set` of any value, `all` included (now `tune` and `tools`), a round set, a plugin's set or a `--cases` glob never returns one; only a selection naming `holdout` does.
- **The fake Jira and GitHub servers read dates.** JQL `created`/`updated` with `>=`, `>`, `<=`, `<`, `=` (a bare date is that day's midnight, as Jira reads it; `-7d`, `now()`), and GitHub search
  `created:`, `updated:`, `closed:` (`D`, `>D`, `<=D`, `a..b`, whole days), `assignee:` (`@me`), `author:`, `no:`, `is:open|closed|merged|draft|pr`, `label:` (quoted, `-label:`), `repo:`/`org:`; what they cannot
  read is an error, never an empty answer.
- **The seven stand-in GitHub tools** have the best text there is: one exact (a signed-in host's listing), four from the open-source README (title and parameters); two stay stand-ins (no public listing).
- **The closed-pipe fix hid real write errors.** Only a closed reader (EPIPE, ECONNRESET) is tolerated now; a disk-full or other write error says so on stderr once and the command exits non-zero.
- **`target: ... in created` is rebuilt on the guard's log** (review of #14): the guard records a write's input leaves and the new ids its completed result returned that its input did not; a pre-existing id, an update, a
  failed write and a script's invented id no longer count, a create-then-use in one script does, an id is at least 8 characters with a digit, and a blocker may not rest on it. `@alias*` needs a prefix the targets file
  declares, at least 8 characters, ended by a separator, and never matches a path with `..`. A positive glob on an unseeded plugin and a repeated `plugins=` key are compile errors.
- **Three more compile checks** (`src/case/consistency.mjs`, tests in `test/consistency.test.mjs`): (1) every `args.<name>` path in `call:`, `target:` and `absent-arg:` must exist in the tool's input in the pack's recorded parameters
  (`packs/<id>/inputs.json`, built by `scripts/capture-inputs.mjs`; nested through object properties and array items, `length` and a number allowed, a free-form object takes any key); an unknown name is a compile error naming the
  tool and its real parameters. A tool with no recorded parameters is not checked. (2) A case that requires a call (`call:`, `declined:`, `first:`, `before:`, a blocker's `count >= 1`, `call:` with `== value`) and forbids the same call
  (`absent:`, `absent-write:` covering it, `count == 0`, `absent-declined:`, the same `absent-arg:` value) is a compile error naming both items. (3) A warning, never an error, when a value a `call:`/`absent-arg:` `==` checks is in neither the prompt,
  the seeds nor the fake's fixture. A skeleton for a tool that takes no parameters has no `target:` item.
- **Review of #14, round 2**: (1) the data floor lifts only when **every call** is constrained on the argument that selects what the tool returns (`scope` in `reach.json`) to an exact sandbox alias of the tool's own plugin, in
  blocker items outside `evidence_any` and `n/a_when`, with a `count <= N` and a `target:` for calls 1..N; a tool with no scope argument never lifts, `created` and `@alias*` never lift, and mutation tests cover each weak form
  (`test/reach.test.mjs`). (2) `created` accepts only the id a completed write's result gives to the thing it made (`id`, `uuid`, `<noun>_id`, `ts`, reached through envelope keys or the written thing's own key): not a
  parent, an owner, a workspace, a list of ids or a timestamp; numeric ids (GitHub and Linear issue numbers) are too short to count, so `created` cannot be used for them; the safety records of a write are written before
  its `write_result` and a result the guard cannot read cannot stop them. (3) False refusals fixed: an untyped or object parameter is open (`gws.plan` `body`, affinity `search_criteria`), `n/a_when` is a condition and not a
  demand, a bare `write`/`edit`/`read` is OpenCode's own tool in every case and a prototype name (`constructor`) is not a parameter. (4) `reach.json` marks `agents_get_signed_url`, `creative_transcribe_audio`, six more
  ElevenLabs conversation and analytics reads, and `gws events_list` (own).
- **Argument-name coverage is complete** (`packs/<id>/inputs.json`, `scripts/capture-inputs.mjs`, `scripts/own-inputs.json`): every tool of all 24 packs has its recorded parameters, from its plugin's source at the pack's release tag
  (the recorded tool snapshot in its tests, or the tool table in source), the vendor's `mcp.json` (GitHub, Jira), or a signed-in host's Code Mode listing. Eleven tools their vendors do not list to the pinned sign-in (nine of Jira's
  `delete_jira`/`manage_jira` groups, Notion's two plan-gated searches) have no schema and say why. `evals compile` now **refuses** an `args.` clause (`call:`, `target:`, `absent-arg:`) on a tool with no recorded schema, so
  coverage cannot lapse unseen; `evals pack` prints `schemas have/total` per plugin and fails a pack with a tool that has neither a schema nor a reason. A bare `write`/`edit`/`read` is OpenCode's own tool, not gws's. X's dotted
  parameter names (`tweet.fields`) are one argument, to the check and to the grader. The signature parser reads numeric literal types.
- **The data floor is per tool** (packs' `reach.json`, `src/case/reach.mjs`): a case that can call a tool that returns non-sandbox content, in its own plugin (the tools it names) or in any companion it seeds (all marked tools), may
  not be labelled below the tool's floor, unless it scopes the call to a sandbox alias. 
- **`scripts/seed-canaries.mjs`** plants the round's canaries (docs/running.md#canaries) in the sandbox containers through the evals profile only, idempotently (find, then create), records them in `canaries.json`
  (ids under `_ids`), refuses any container that is not a `targets.json` alias, and has `--dry-run`; `evals phase1` runs it as the `canaries` step after the sign-ins.
- **A header written twice is a compile error** (the last used to win: a second `- Seed:` silently dropped the first's `plugins=` and `egress=`).
- **A case can grade its companion plugin's tools.** A deep cross-plugin case may name the tools of a plugin its `Seed: plugins=` lists (`call:`, `declined:`, `target:`, `first:`, `before:`, `absent:`, `count:`), checked against the
  companion's own pack; a plugin that is not seeded is still refused. `target:` takes a prefix alias (`@boxd.prefix*`) and `created` (an id an earlier write of the same trial returned), for writes whose argument has no alias.
- **Fake mode runs the plugins as released.** A loopback `mcp` override was a `conflict` to both plugins (no namespace description, no tool filter, status `conflict`). Each now registers its own
  server at its default URL; the trial maps that host to the fake (`--add-host`, `NO_PROXY`) and the fake answers TLS with a per-batch, name-constrained CA trusted only in the trial
  (`NODE_EXTRA_CA_CERTS`). `p0 fake` asserts the namespace text (from the plugin's source), the status (`connected`, own server) and the vendor host in every request.
- **An `evals` command whose output nobody reads spun at 100% CPU for ever**: EPIPE on stdout was an uncaught error, and the batch's handler logged to the same closed pipe, which raised it again.
  Leaked runners of killed test runs slowed every later probe (`p0 env` and `p3` failed under that load). Output is dropped when no one reads it (`src/stdio.mjs`), the handlers cannot throw into themselves,
  and two docker tests no longer assert machine-wide facts (other batches' sweeps and exec clients).
- **`evals select`** recorded every non-passing trial, which inflated every baseline. It now records only the first-pass trial of each wide case, once, refuses to overwrite `selecting.json`, and
  `evals report` applies the list to wide cases only (deep cases are untouched; `--cases-dir` on both).

### Added

- **Locked runs** (`--tools locked`, the default): the sealed config removes the shell, file, web and subagent tools, puts an `ask`
  on every write action of every pack and on Tavily's research and crawl, installs every other plugin at `ask-changes`
  (`companions` in an arm file) and installs **the guard**. `--tools local` keeps the shell for the credential-free arm, for cases
  in set `local` only. Found on 2.3.2: a `tool.use` policy removes nothing (a blanket permission deny of the tool's own name does),
  Code Mode has a `fetch` (it asks `webfetch`, which is denied), and `execute.before` fires before the ask.
- **`evals p0`**: the seven probes the safety gate G0 rests on (shell/file/web tools, 24 plugins at ask-changes, a foreign-session
  ask, spending reads, gws plans, the cost ceiling, the guard's gold suite), each with the scripted model and no credential.
- **`--auth <source>+profile`**: the evals profile's vendor credentials, cut to an allow-list of fields (the refresh token is a
  placeholder: import insists on one), the access token and its encoded forms scrubbed, expiry checked against the batch.
  `scripts/profile/` holds `check-real.sh`, `keeper.mjs` and `evals-profile.sh`.
- **The round's list-price ceiling** (`EVALS_ROUND_CEILING_USD`, `EVALS_ROUND_CAP_USD`), checked before every launch, with
  `list_usd` and `tier` on every ledger run and `estimate_run_usd` per model and tier.
- **Case format**: the clauses `target:`, `gws-plan:`, `absent-write:`, `committed-write:none`, `guard:clean`, `unknown-tool:none`
  and `text:... contains @canary.*`; tool names with hyphens and camel case; item areas RT, CT, WR, DT, ER; the `Data:` header;
  the `Set:` values `wide`, `route`, `deep`, `commit`, `hooks`, `local` with their id shapes; holdout ids `hold-<plugin>-<n>-<slug>`;
  `{{target:...}}` and `{{canary:...}}` placeholders; `Seed: files=` and `Seed: plugins=a,b`.
- **`evals pack --sync --release <versions>`**: packs from a release tag (`git archive`), hidden tools marked, account templates
  kept apart. Per-pack `egress` for the per-batch allow-list.
- **R7 skeletons** (`scripts/wide-skeletons.mjs`), **R10** `--preflight data`, **R13** rate-limit backoff and pause, **R14** vendor
  budgets (`caps.json` `vendors`), `evals t0 --plugin`, `Home files:` (files a run wrote under named places of its HOME), `container.assets`
  and `evals isolation assets` (G8), a compile-time check that every tool a clause names exists in the plugin's pack, and the probes
  p1 to p5, p13 and g8.
- Cluster-bootstrap statistics, fresh-trial baselines, the pooled holdout gate and the adoption screen (`src/report/cluster.mjs`).

- **Probe `env`** and an environment tripwire: `sandboxEnv` refuses to start a trial holding a credential-shaped variable that `--auth` did not give, a world's env cannot set one, and `experimental_video_generate` joins the locked tools.

- **The G0 review's 18 changes** (docs/running.md#the-g0-reviews-changes-pr-8-at-d7b6edf): the safety halt (`evals halt`), a cost cap that fails closed
  with cumulative vendor caps, a mandatory `Data:` and the owner's data-matrix sign-off, `guard: false` refused with a credential, the profile's own service
  port, privacy-scan token shapes, plugin-load failure as infra, seed and home-file limits, a commit plan tied to `targets.json`, a guard allow-list
  tripwire, P0-A2 on the enforced path, grammar checks, `evals report` on the cluster bootstrap, the live write probe, and 2.3.1 sources.

- **`evals phase1`**: the G0 re-check's section D as one gated sequence (preflight, check-real, keeper, P0-6b, P0-6c, P0-7, `p0 live`, gws plan-and-commit,
  the paid pilot), each step only if the previous one passed, with `--dry-run`, `--from`, and a HALT stopping it. And the re-check's eight changes: `Data:` derived from
  `Seed: plugins=`, seed paths at any depth, the mid-batch HALT re-read tested, an idempotent profile port, wide blockers on undeclared argument paths refused,
  `evals select` and automatic fresh baselines, `@alias` placeholders in the live probes, and the defence-in-depth tests.

- **The owner's decisions**: GitHub and Jira in **fake mode** (`accounts: fake`: no account, no real endpoint; the harness's own fake MCP server serves each plugin's released tool
  list from `packs/<id>/mcp.json` and answers from a synthetic fixture; reads graded with `@fixture.<plugin>.<fact>`, writes asked and declined; `Data: synthetic`; probe `evals p0 fake`: the plugin runs on its default URL, the trial maps the vendor host to the fake over TLS with a per-batch CA),
  `accounts: none` kept for other plugins (honest-answer item minor, call/target/canary clauses n/a), the data matrix gate tested with a fixture, Slack, X and Google on their existing apps, `phase1` without
  GitHub's token step or any sign-in for GitHub or Jira, and `scripts/profile/signin.sh`, the owner's sign-in walk with `check-real` after each vendor.

### Changed

- Every plugin's pack is re-synced to the release in the family's upgrade script (github stays at v0.0.6 until v0.0.8 is tagged).
- A materialised plugin carries what its package.json `files` lists: boxd's `guest/` and gws's `manifest/` were missing, so neither
  loaded in a trial. ElevenLabs takes `sessionCreditCap: 1` (the plugin refuses 0).
- `evals run` writes `host_log` (plugin load failures from the host's own log), `guard`, `server_stderr` and the batch's egress plan.

## [0.1.0] - 2026-11-14

The first Release. Install it with `npm install --save-dev github:joe-broadhead/opencode-evals#v0.1.0`; evals is not on npm.
It contains the deterministic harness (static checks, compiled cases, traces, graders, the policy, the cost ledger
and the privacy gate), the T1 tier against stock OpenCode hosts, live runs confined in a container, and 24 plugin
packs synced to each plugin's latest GitHub Release. The case corpora are History, Charts and X, and there are
live tasks for nine plugins; those stay in the repository and don't ship in the package.

### Added

- **Packs for opencode-inference and opencode-openrouter** (`packs/inference`, `packs/openrouter`), read from their
  v0.0.2 Releases.
- **A release workflow** (`.github/workflows/release.yml`). It tags a master commit that CI passed as
  `v<package.json version>` and creates its GitHub Release, after the owner approves the `release` environment.
  Nothing is built and nothing goes to npm. CONTRIBUTING's "Releasing" section lists the steps.
  It runs only when dispatched on master. A re-run resumes when the tag is already on the approved sha and has no
  Release; every other case with an existing tag is refused.
- **A `files` list in `package.json`.** An install carries `bin/`, `src/`, `packs/`, `cost/`, `docker/` and the
  CHANGELOG, plus the README and the LICENSE. It leaves out `cases/`, `live/`, `test/`, `worlds/`, `fixtures/`, `docs/`
  and `scripts/`.
- **The Charts corpus** (`cases/charts`, `docs/charts.md`): 13 agent tasks, version 1, for creating and revising
  charts (long labels in a narrow panel, explicit and ambiguous aggregation, count versus measure, misspelt fields, a
  brand theme, empty data; light → dark, inline → presentation → inline, add x zoom, add scatter brushing, an
  unsupported pie zoom, a cosmetic change after the source CSV changed), in sets `corpus`, `create` and `revise`, plus
  two `scripted` probes for the harness's scripted model. Its world (`worlds/charts`) is synthetic CSVs and a build
  that saves the revision tasks' charts with the build under test, through its tools RPC on a stock host with no model.
- **Grading adapters** (`src/grade/adapters/`): per-plugin facts derived from a run's own files, read by `state:`
  clauses when no state fixture exists. The Charts adapter reads the saved `.chart.json` artifacts and states their
  recipe, bindings, aggregate, theme, layout, interactions and rows, and each group's value recomputed from the
  captured rows, so a case checks the data a chart holds against numbers worked out from the fixture. The adapters are
  part of the grader hash.
- `packs/charts` synced: `charts.update` (export) is declared.

- `--isolation container`, the default for every `evals run`: one Docker container per trial, from a committed image
  with no secrets (`docker/Dockerfile`, base pinned by digest; `evals isolation build|check|sweep`). The trial sees its
  sandbox (read-write, at its own path), the build under test and the binaries (read-only), and nothing else of the
  host: no home, no other trial, no Docker socket. It runs as the caller's uid with a read-only root, a small tmpfs
  `/tmp`, `--cap-drop ALL`, `no-new-privileges`, and pids, memory and CPU limits; its network is `--internal` with an
  isolated gateway, so it reaches no host address, no metadata service and no OpenCode server; its one way out is the
  batch's egress proxy (`docker/egress-proxy.mjs`), which allows `CONNECT` to port 443 of an owner-set allow-list
  (the four Anthropic hosts by default) and records every refused host name in the batch record. `opencode serve`,
  `opencode run` and the scripted model all run inside; every command's environment goes by name through
  `docker exec`, never in an argv or at `docker run`. A trial ends with `docker rm -f` on every path, Ctrl-C and
  `SIGTERM` tear the batch down, and the next batch sweeps what a killed runner left. A disk watchdog stops a trial
  past its sandbox limit or when the disk runs short. Tests run a scripted trial end to end in a container and check
  what a trial can read, write and reach (skipped, with the reason, without Docker or the image).

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

- The files a run writes: `evals run` records what changed in the working directory (`<case>.t<k>.files.json`,
  private, never traced), and `file:<glob> exists|absent|changed|deleted|matches|not-matches` grades it.
- Order clauses: `first:<tool>` (the first call, skill loads and the `execute` wrapper aside) and `before:<a>,<b>`
  (the first `a` came before the first `b`, or `b` never happened), so "History before git or grep" can be graded.
- Private holdouts: `$EVALS_STORE/holdouts/<plugin>/` joins the repository's cases in `run`, `grade`, `report` and the
  scorecard, always as holdouts (`evals compile --plugin <id> --holdouts` compiles them in the store); an id that is
  also published is refused.
- Worlds: a private `overlay` the build receives, a per-sandbox `prepare` step (to rewrite recorded directories to
  the run's own), and `sessions` a case continues with `Seed: continue=<key>`. `Seed: utc-hours=<a>-<b>` keeps a
  time-of-day case inside its window; every summary records its UTC hour.
- Arms carry plugin options: `evals run --arm <file>.json` (`{ "package": …, "options": { "access": "ask-changes" } }`)
  or `--options`. The options are recorded by digest and are a provenance axis, `options`, so an access-mode arm is
  compared on that axis and refuses a comparison on any other.

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

- **The 21 drifted packs now match each plugin's latest GitHub Release**, not 0.0.0. affinity, ashby, boxd,
  browse, charts, elevenlabs, github, granola, gws, history, jira, linear, metaview, notion, plaud, slack, tavily,
  utilities, voice, wisprflow and x were synced with `evals pack --sync`, each read from its Release tag. Besides
  the versions: ashby lost `search_product_docs` and changed its skill description. elevenlabs gained 47 tools,
  and three tools became reads. granola gained `get_agent_brief`, `create_meeting_note_from_transcript` and
  `sign_out`, and lost `list_meetings`. linear gained `whoami`, slack gained `mark_read`, and utilities lost
  `speech_download`.
- **jobs' pack notes that its `access` setting has no list of choices** (a top-level `notes` entry). jobs v0.0.0
  hasn't had the family settings release. The sync keeps the note.
- **The README installs from a GitHub Release tag** (`github:joe-broadhead/opencode-evals#v<version>`): evals is
  not on npm, and the old `npm install` returned a 404. `package.json` is now in canonical JSON form
  (`JSON.stringify(pkg, null, 2)`) and keeps `"private": true`.
- Every `evals run` is confined by default, the scripted model's included: "not live" is not "confined", since the
  scripted model can call a shell tool. `--isolation none` is refused for any run unless `--unsafe-no-isolation`, which
  now means `--isolation none` only. Sandboxes moved from the memory-backed `/tmp` to `/var/tmp/evals` (`EVALS_TMP`).
- A world's `env` is applied before the harness's own variables and may not set them (`HOME`, `PATH`, `TMPDIR`,
  `XDG_*`, `OPENCODE_*`, `CLAUDE_*`, `ANTHROPIC_*`, the proxy, the scripted endpoint, `NODE_OPTIONS`, `LD_PRELOAD`…);
  the names it tried are recorded as `world_env_ignored`.
- The scripted provider is listed after the plugin under test and reads its endpoint from a file beside the batch's
  own copy of it: a plugin that registered its own `mock` provider, or rewrote `SPIKE_MOCK_URL`, took the scripted
  model over (reproduced on the host; now refused by a test with a hostile plugin).
- The credential's horizon counts a per-run overhead (120 s by default, `EVALS_RUN_OVERHEAD_S`), not only the timeout.
- The built-in tool list holds every tool the tested hosts register, the host tools included (`list_mcp_resources`,
  `read_mcp_resource`, `models`, `session_*`, `worktree_*`, `schedule_*`, and `artifact_*` from 2.2.5), checked against
  a pinned `@opencode/core` registry when one is configured. The grader moved; history and x are re-locked at epoch 3.

- `cases/history/evals.lock` and `cases/x/evals.lock` are re-frozen at epoch 3 for the grader as it now is, and for
  History's case set, whose items now name History's tools `history.<tool>`. Batches graded under an earlier epoch
  are stale (`evals verify --all` lists them) and re-grade for free.


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

### Fixed

- T1 for History: the pack scripted direct calls to `history_sessions` and `history_sql`, which History v0.0.0 offers
  only inside Code Mode, so they never ran (8 failures over the four hosts). They are now scripted through `execute`
  (`tools.history.sessions`, `tools.history.sql`, marked `via: "execute"`), and such a case passes only when its call
  ran inside `execute`. The embedded-SDK runner added an `x_` prefix to every tool (it called `x_pin`: the
  `evals check` blocker) and ignored a case's `options`: it now takes a case's tool id from the plugin under test
  (the case's permission action, else the pack's tool), sets each case up with its own options, and starts a fake
  only for a pack that declares one.

- `evals isolation sweep`, and the sweep at a batch's start, also remove a dead runner's batch directory under
  `EVALS_TMP`: only one holding the marker its runner wrote at creation, naming that directory, whose runner is gone
  and whose containers are gone, removed without following links.

- The live canary's trial failed in 2 s with `provider.no-route` for `claude-agent/haiku`: the Claude Agent provider
  lists its models from a catalog in OpenCode's plugin storage, which a fresh sandbox lacks (phase A's lab base had
  it cached) and fills by probing `claude` about a second after the server answers; the run was sent before that.
  Every run now waits until its model routes on the trial's own server; a preflight trial checks it before anything
  is reserved; and a run that never reaches a model is `infra: "provider"` (not graded, released, the batch stops).

- A Claude sign-in with `expiresAt` null or absent (boxd keeps it fresh itself) was refused as not a sign-in. Its
  expiry is now unknown: `--auth claude-agent` refuses it with a clear message unless `--accept-unknown-token-expiry`,
  which skips the horizon check and records `horizon.expires: "unknown", accepted_by_flag: true` (the dry run shows it).
- A trial whose model call is refused authentication is `infra: "auth"`: not graded (`NOT_RUN`), its run released to
  the reserve, and the batch launches nothing after it. The grader moved; history and x are re-locked at epoch 3.

- The disk watchdog repaired permissions while a trial's container ran, by path: a run swapping a locked directory
  for a link changed a directory outside the sandbox (reproduced). Nothing changes a sandbox while its container
  runs now; an unmeasurable sandbox ends the trial (`disk-unmeasurable`), and the repair after the container is gone
  works through file descriptors and never sets setuid, setgid or sticky bits. The watchdog also counts entries
  (`inodes`), keeps a free-inode floor, and bounds a measurement at 10 s.
- The egress proxy refuses a tunnel whose ClientHello SNI is not the CONNECT host, refuses IPv6 forms carrying an
  IPv4 address (mapped, compatible, NAT64, 6to4, Teredo), and caps open tunnels per trial and in all.
- A sandbox is removed or scrubbed only once its container is confirmed gone.
- The image pins every package and carries no Node; the proxy runs on the harness's own.

- A summary's stderr was cut to its last 4000 characters before the token was scrubbed, so a token straddling the cut
  left its tail behind; every cut now scrubs first.
- Containment followed links with `existsSync`, so a dangling link counted as inside its root wherever it pointed; it
  now follows the link to its target, and a loop is nowhere.
- The runner no longer walks a working directory that a run replaced with a link out of the sandbox, removes a sign-in
  file only through no link, and removes a sandbox whose directories a run locked.
- New tests guard the dollar check inside the ledger's lock (eight processes racing for a cap), link cutting outside a
  world's home, and the batch record's scrub as a whole.

- The bundle tests left their checkouts and builds in the system temp on every run; they are removed after the tests,
  however they end.

- Containment: paths are compared by their real paths (a link inside a root that leaves it is outside); links out of
  the sandbox are removed anywhere in it, not only near the top of its home; a world repository that is a link, or
  holds one out of the world, is refused; and breaking a stale ledger lock takes a second lock and removes only the
  very file judged stale, so a third waiter can no longer slip in while a lock is briefly absent.

- A path under a redacted string counted as "not passed", so `args.query.length != 1` held on a value nobody could
  see. A negative clause on such a path is now unverifiable; a positive one still fails.

- `BUILTIN_TOOLS` is now exactly the tested hosts' own tools (read from `@opencode/core` 2.2.3 to 2.2.6, and Code
  Mode's `execute`): `bash`, `task`, `list`, `todoread`, `apply_patch` and `search` are not tools in 2.2.x, and a bare
  `read` or `search` could pick a file read or another plugin's search. The 52 History cases that named History's
  tools bare now name them `history.<tool>`, and `compile` refuses a bare name that is both a built-in and the case's
  plugin's tool; across the lab's 67 recorded iterations every item grades as before.

- The dollar check ignored other batches' reserved runs that had not billed yet, and projected $0 when nothing was
  priced. Every reservation now records its expected cost per run (billed runs, the catalogue's price for recorded
  tokens, or `EVALS_ASSUMED_RUN_USD` / `assumed_run_usd`), the check sums what is billed and every batch's outstanding
  reservations, and a batch nothing prices is reported as "not enforceable" (log, summary, `evals budget`), held to the
  run caps alone.

- The live check trusted the model's name: a `mock` provider can come from the plugin under test, and `--auth
  claude-agent` with a mock model still reached the credential with no isolation. A run is now not live only with
  `--auth none` and the harness's own scripted model, registered by the harness in the sealed config (`--scripted`);
  and the refusal comes before a world module is imported.

- `evals pack` counted a checkout that is not a family plugin (mem, messaging) as a pack that differs, and did not name
  the packs it counted. It now names them, and lists a non-family checkout as skipped.

- A bare tool name the case's plugin declares was always qualified with the plugin, so `absent:write` in a gws case
  checked only `gws.write` and let a built-in `write` through. OpenCode's own tool names (one constant,
  `BUILTIN_TOOLS`) are never qualified; the plugin's tool of that name is written `<plugin>.<name>`, and `compile`
  warns about a bare one the plugin also declares (41 History cases name `search` or `read` bare; across the lab's 67
  recorded iterations they grade exactly as before).

- The missing-argument rule passed values it could not see: a key inside a nested object, which a trace keeps as
  `{kind: "object", keys}`, read as "not passed", so `args.filter.lang != "en"` held although the call passed `"en"`.
  A key the wrapper lists, or anything under a variable, is now unverifiable; only a key it does not list is missing.

- `evals run` launched live runs with only environment isolation, and an agent under test reached a file outside its
  sandbox by absolute path. A live run now needs a filesystem-isolation backend (`--isolation`, a pluggable
  `src/run/isolation.mjs`); `none` is refused for a live run unless `--unsafe-no-isolation` is given, and the
  `container` backend is not implemented yet, so no live run can be launched safely until it is.

- `evals run` asked the host for its version with the caller's `HOME`; it now asks in a sandbox of its own. The
  credential export is the one command left with the caller's environment, and the docs say why.

- The ledger lock: two waiters could both break a stale lock, and the second could delete the lock the first had just
  taken. A lock is now taken with `link(2)`, carries a holder's token, is broken with `rename(2)` and put back when
  the file moved is not the stale one, and is released only by its holder.

- The dollar budget: the check before a batch now runs inside the ledger's lock with the reservation, with the caller's
  caps; a run is launched only when the projected spend, counting the runs in flight, stays within the cap (the
  batch could overshoot by `--parallel` runs); and a non-numeric `EVALS_BUDGET_*_USD` is an error instead of `NaN`.

- `--auth claude-agent` linked the whole `~/.claude` into each sandbox, so `claude` could load the caller's settings,
  hooks, global `CLAUDE.md` and MCP servers, and wrote `history.jsonl`, `todos/`, `shell-snapshots/` and
  `file-history/` into the caller's own directory. Each sandbox now has its own empty `~/.claude` and no `~/.claude.json`.
  The caller's `.credentials.json` is read once (with `O_NOFOLLOW`, size-capped, shape-checked, never logged), nothing
  of it is copied, the refresh token is never passed on, and each run gets the access token alone as
  `CLAUDE_CODE_OAUTH_TOKEN`; a batch is refused when the token would expire within its worst case. A sandboxed run
  never writes to the caller's `~/.claude`. The token is scrubbed by exact value from every recording, summary, files
  record, batch record, log line and kept sandbox. Links a world's home carries out of the sandbox are removed, and
  `--keep` with `claude-agent` needs `--keep-credentials`.

- `Seed: cwd=../../x` (or an alias to one) copied a directory from outside the world into the sandbox: a seed key and
  the repository it names must be single names inside the world's `repos`.

- `evals run` handled no signal: after Ctrl-C the `opencode serve` groups and any `claude` under them kept running, and
  the batch directory, with the imported credential, stayed in tmp. An interrupt or an uncaught error now kills every
  process group the batch started, removes its sandboxes unless `--keep`, releases the runs that never launched,
  records the batch as interrupted, and exits non-zero. A finished command's group is killed too.

- A case id, an iteration or a plugin id could be a path: a private holdout with id `../../../../ESCAPED` made the
  runner write its recording, create and delete its sandbox, and remove transcripts outside their roots. Every loaded
  case is now validated (a case id is lower-case words joined by dashes, and is its file's name), every name that
  becomes a path segment is checked by every command, and every path the runner writes or deletes must resolve
  inside the root it belongs to.

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
