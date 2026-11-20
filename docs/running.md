# Running live evals

`evals run` runs a plugin's cases against a real model: one isolated OpenCode run per (case, trial), recorded in the
private store where `evals trace` reads it. It is the only command that spends model time, so everything that can
refuse a batch does so before the first run starts.

> **Every run is confined in a container.** The sandbox below isolates the environment (HOME, the XDG tree, TMPDIR,
> the config and the database), not the filesystem: an agent under test with a shell or a write tool could otherwise
> read and write anything the user running the harness can, by absolute path, and an eval run has done exactly that.
> So every run, the harness's own scripted model included (it can call a shell tool too), runs under
> `--isolation container` by default: one Docker container per trial, on a network whose only way out is an
> allow-listing proxy ([Isolation](#isolation)). `--isolation none` is refused unless `--unsafe-no-isolation` is given
> as well, for a machine that is itself disposable and holds nothing you would mind losing; the recording says so.
> Read [Running live evals safely](#running-live-evals-safely) before the first live batch.

```sh
evals run --plugin history --iteration v1-a --model claude-agent/haiku --auth claude-agent \
  --set tune --trials 3 --parallel 4 --arm ../opencode-history --world ../history-world
evals trace --iteration v1-a --plugin history
evals grade --iteration v1-a --plugin history
evals report base=v0-a v1=v1-a --plugin history --set tune
```

| Flag | Default | What it does |
| --- | --- | --- |
| `--plugin <id>` | required | the pack id; the cases are `cases/<id>/*.json` in this repository and the private holdouts in `$EVALS_STORE/holdouts/<id>/` (`--cases-dir` for exactly one other directory) |
| `--iteration <name>` | required | the recordings go to `$EVALS_STORE/raw/<name>/<plugin>/` |
| `--model <provider>/<model>[#variant]` | required | the model every run uses |
| `--auth <profile>[+profile]` | required (or `EVALS_AUTH`) | where the model credential comes from: below; `+profile` adds the evals profile's vendor credentials, allow-listed |
| `--cases <ids>` | `*` | ids and `prefix*` globs, comma separated |
| `--set <sets>` | `tune` | `tune`, `holdout`, `tools`, `all` (= `tune` and `tools`), or a comma list (see [design.md](design.md#reports-over-arms)). Holdouts are returned only when `holdout` is named: no other set, `all` included, reaches one. `evals report h1=… cb-h1=…` takes `--set holdout` |
| `--trials <k>` | `1` | runs per case; each is `<case>.t<k>`, and one trial never ships |
| `--parallel <n>` | `4` | runs at once; each gets its own server (and, under `container`, its own container and network: at most 8) |
| `--arm <dir>` \| `<file>.json` \| `none` | the plugin's checkout | a built plugin (`dist/`, `skills/`, `package.json`), copied once per batch; a JSON arm file names one and its options; `none` is the no-plugin control |
| `--world <dir\|file.mjs>` | `EVALS_WORLD_<ID>`, else an empty project | what each sandbox starts with: below |
| `--host <version>` | `EVALS_OPENCODE_BIN`, else `opencode` on `PATH` | a tested stock binary (`OPENCODE_BIN_<version>` or `EVALS_STOCK_DIR`) |
| `--options <json>` | none | the plugin's options in the run (or put them in an arm file, not both) |
| `--timeout <s>` | `420` | a run is killed after this |
| `--stale rebuild\|refuse` | `rebuild` | what to do with a stale world |
| `--append` | off | add trials after the ones the iteration already has; without it, a case with recordings is refused |
| `--isolation <backend>` | `container` (or `EVALS_ISOLATION`) | what confines the run's processes: `container`, or `none`, which is refused without `--unsafe-no-isolation` |
| `--scripted` | off | run the harness's own scripted model, `mock/m1` (T1's mock provider and server; needs `bun` or `EVALS_BUN`): with `--auth none`, the one run that is not live, though still confined, since it can call tools |
| `--accept-unknown-token-expiry` | off | with `--auth claude-agent`, run on a sign-in whose expiry is unknown (`expiresAt` null or absent) instead of refusing it ([Credentials](#credentials)) |
| `--unsafe-no-isolation` | off | with `--isolation none`, launch anyway: the agent can reach the whole filesystem. It means nothing with `container`, and is refused there |
| `--dry-run` | off | print the plan, the caps and the isolation; launch and reserve nothing |
| `--tools locked\|local` | `locked` | `locked` removes the shell, file, web and subagent tools, asks every write and installs the guard ([Locked runs](#locked-runs-and-the-safety-gate-g0)); `local` keeps them, for the credential-free arm (cases in set `local`) only |
| `--commit-plan <file>` | none | the commit set only (cases in set `commit`): a JSON file in the private store naming the write actions that become `allow`, each one's target extractor and the aliases it may touch, and the plan registry for plan-committed writes (gws) |
| `--keep` | off | keep the sandboxes (for debugging the runner); with `--auth claude-agent` it is refused unless `--keep-credentials` is given too, because a kept sandbox holds the imported OpenCode credential (a marker; the access token is scrubbed from every kept file) |

## Arms

An arm is what a run measures: a built plugin, the options it runs with, or no plugin at all. An arm file keeps the
two together, so an `ask-changes` arm is a file and not a flag someone forgets:

```json
{ "package": "../opencode-history", "options": { "access": "ask-changes" } }
```

`package` is relative to the file. The options reach the run in its sealed config, and are recorded by digest (an
option can be a secret), with the `access` value beside it. They are a provenance axis of their own, `options`:
two arms that differ only in access compare with `evals policy --axis options`, and an options difference refuses
a comparison on any other axis. A batch from before options were recorded ran with none.

## Locked runs and the safety gate G0

Every run is **locked** unless it says `--tools local`. A trial that holds a vendor credential keeps it in its own `auth.json` and
environment; a model with a shell, a file read, a web fetch or a subagent could read it and call the vendor directly, past every
plugin's `ask-changes`. So the sealed config (`src/run/lockdown.mjs`):

- **removes** `shell`, `read`, `grep`, `glob`, `write`, `edit`, `patch`, `webfetch`, `websearch`, `subagent` and
  `experimental_image_generate` (and the host's `schedule_*`, `worktree_*`, `session_*` and MCP-resource tools), by a blanket
  permission `deny` of each tool's own name: that is what takes a tool out of the list the model is offered. A policy
  `tool.use deny` with resource `<tool>:*` and a `websearch.use` deny are the second lock. (A policy alone removes nothing: it is a
  call-time check on `<tool>:<input>`, found by probe on OpenCode 2.3.2.) Code Mode keeps a `fetch`, which asks the `webfetch`
  permission, so it is denied too; `process`, `Bun` and `globalThis` do not exist there, so no token is readable from it;
- puts an `ask` rule on **every write action of every pack**, and on Tavily's `research` and `crawl` (spending "reads"), which
  `opencode run` rejects. Only the commit set turns its own named actions into `allow`;
- installs every other plugin as a **companion** at `access: ask-changes` with its caps (`companions` in an arm file: a map from a
  plugin id to a built directory, or the path of a file holding one); an arm file cannot raise the access while the run holds any
  credential (`+profile` counts);
- installs **the guard** (`src/run/guard`): a write that resolves to `allow` is turned into a deny (`EVALS-ASSERT access`); a write
  that completes is logged (`EVALS-ASSERT committed`); an ask from a session no run owns is rejected at once (the "global" one:
  `opencode run --server` answers none), and one still pending after 3 s is rejected. `execute.before` fires before the tool asks,
  so outside the commit set the guard does not refuse there: that would stop the ask, and a write graded as "asked and declined"
  would never be asked. In the commit set it does refuse, for a write with no declared target extractor or a target outside the
  allowed aliases, and for a plan commit (gws: only the `planId`) of a plan it did not see made for an in-sandbox target.

`evals p0 [a1|a2|a3|a4|a5|c|g|g8|halt|unknown|consent|tavily|live|p7|gws|env|p1|p2|p3|p4|p5|p13|all] [--companions FILE]` runs the probes the gate rests on, with the scripted model, no credential
and every trial in a container: **a1** shell/file/web/subagent tools refused, no egress, a canary credential in no output;
**a2** all 24 plugins at ask-changes, every write action asks (at access `all` too), the local writes decline end to end;
**a3** a foreign-session ask is rejected within 5 s (and hangs without the guard); **a4** Tavily research and crawl are
confirm-only; **unknown** a tool no pack lists is asked and declined at every access, refused in commit mode, and one that completes halts the wave; **consent** no tool a plugin's own rules ask for is an allow in the sealed config (Slack's private search and file read, X's DM reads asked), the Tavily metered reads the one exception; **tavily** when all five Tavily tools are spend-class, search, extract and map still run and research and crawl are asked; **a5** gws commits ask, and the guard's plan registry; **c** the token-priced round ceiling refuses the second
launch; **g** the guard is deny-by-default at access `all`, and the suite fails without it.

The other probes: **env** a trial's environment is built from an allow-list, never inherited: the launcher's shell holds `OPENCODE_API_KEY`, `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `GH_TOKEN` and 16 more canaries, and the trial sees none of them by name or value (a positive control shows the one `--auth` credential, masked), and the image, video, search, fetch and subagent tools are refused by name with no connection reaching the proxy; **p1** what reaches the model (the request body dumped in the locked and the open arm, saved under `$EVALS_STORE/p0/`);
**p2** `search()` returns the full description and the signature; **p3** what the model sees when an inner call fails; **p4** the
guard's hook reaches inner calls and, in commit mode, refuses an out-of-scope write there while an in-scope one passes to its
rule; **p5** what `auth import` accepts (an oauth credential needs a refresh token, so a trial gets the placeholder `evals-no-refresh`;
import merges); **p13** the Claude Agent surface: a capture server on the trial's loopback (`--capture-server`, an Anthropic-API
stand-in, no model call) shows the request holds only the host's three MCP tools and no Claude Code built-in, and a Bash `tool_use`
it sends is answered "No such tool available: Bash"; **g8** the owner's assets (`container.assets` in `caps.json`: browse's pinned
binary, utilities' speech models, voice's engine) are on the host and mounted read-only in every trial (`evals isolation assets`
checks the host half). The probes that need a credential (P0-6 keeper timing, P0-6b the GitHub token, P0-6c logout, P0-7 egress and
data) and the paid pilot (P0-8) are not here: they run after the owner's sign-ins.

Other run flags: `--preflight data` defers a case whose clauses name a target, a canary or a seed the store lacks, with the missing
name; a rate-limited run (429, with no model work) is tried again after 60, 120 and 240 s and is `infra: rate-limit` after the last,
and three in a row pause the model for 30 minutes; a spending plugin (Tavily, X, Affinity, OpenRouter) runs only under a cap in
`caps.json` `vendors` (`tavily_credits`, `affinity_calls`, `x_usd`, `openrouter_usd`), counted from the ledger and, when the caller
supplies a fetcher, from the vendor's own balance. `scripts/wide-skeletons.mjs --plugin <id>` writes one wide skeleton per reachable
tool, whose prompt is `<<TODO>>` (compile refuses it) so it is written without sight of the tool's description.

## The owner's decisions: the data matrix, GitHub and Jira in fake mode, the sign-in walk

- **Data.** `$EVALS_STORE/data-matrix.json` is `{"real":["claude-agent/*"],"candidate":["claude-agent/*"]}`: real and candidate data go to Claude Haiku and
  Sonnet and to no DeepSeek or other route. `gateCases` reads it that way (test/owner-decisions.test.mjs runs a fixture copy; the repository holds no such file).
- **GitHub and Jira are not signed in, and are measured in fake mode.** Their packs say `accounts: fake` (and `$EVALS_STORE/round.json`,
  `{ "accounts": { "<plugin>": "fake" | "none" | "signed-in" } }`, overrides any plugin's setting without a commit). A fake-mode plugin holds **no credential**:
  `+profile` gives it none and asks the profile for nothing, its hosts are not opened, `evals phase1` expects no sign-in for it, and the egress proxy refuses
  `api.github.com`, `api.githubcopilot.com`, `*.atlassian.net` and the vendors' MCP hosts. The plugin runs **as released**; the harness's own fake MCP server
  (`src/fake/mcp-server.ts`, one per trial, on loopback) stands in for the vendor's:
  - **What the model sees** is the released tool list: `packs/<id>/mcp.json` holds each tool's name, description, input schema and annotations
    (`scripts/mcp-catalog.mjs` builds it). GitHub's 98 tools are 91 exact snapshots from github-mcp-server's `__toolsnaps__` (v2.2.0) and the 7 tools of the hosted server that the open-source one lacks, each with the best text there is
    (`packs/github/mcp-extras.json`, the catalog's `source` says which): `check_dependency_vulnerabilities` is a signed-in host's own listing (exact); `get_copilot_space`, `list_copilot_spaces`,
    `github_support_docs_search` and `create_pull_request_with_copilot` are the README's title and parameters (not the full description, which GitHub does not publish); `issue_artifact_read` and
    `issue_artifact_write` have no public listing and stay `derived` stand-ins (a name, a neutral description, an open schema). **The four README tools and the two stand-ins are out of scoring and tuning**: what a signed-in user sees is longer than the text the fake serves for them. Jira's 46 are a signed-in host's Code Mode listing turned back into JSON Schema
    (`src/fake/ts-signature.mjs`; Array item types are lost in that rendering), and 9 destructive tools the sign-in's scope does not grant are `unserved`, as for a user. The
    plugin's own tools (`events_list`, GitHub's `api`) are registered by the plugin itself. Vendor example addresses are rewritten to `example.org`.
  - **Where it points: nowhere new.** The plugin registers its own server at its **default** vendor URL (GitHub `https://api.githubcopilot.com/mcp/`, Jira
    `https://mcp.atlassian.com/v2/mcp?tools=all`), so it sees no conflict and runs exactly as released: its namespace description, tool filter, status and tools RPC are a
    signed-in user's. (A server of the plugin's own name in the config, such as a loopback override, is a `conflict` to both plugins: they drop that text and the filter.)
    The trial reaches the fake by name resolution, not by configuration: the container's `/etc/hosts` maps the vendor's host to the fake plugin's own loopback address
    (`--add-host`; `127.0.0.2` for GitHub, `127.0.0.3` for Jira; the trial has no DNS), `NO_PROXY` keeps that host off the egress proxy, and the fake answers TLS on `:443` with a
    certificate of a **per-batch CA** (`src/run/fake-ca.mjs`, made with `openssl` in the batch's directory): name-constrained to the fake hosts, its private key deleted as soon as the
    leaves are signed, handed to a trial only as that trial's `NODE_EXTRA_CA_CERTS`, and never added to the machine's trust store or the image. `--isolation none` is refused for a
    fake plugin (only a container can map the name). The batch preflight maps the same names to a loopback address with nothing listening, so it reaches neither the fake nor the vendor.
  - **What it answers** comes from a small synthetic fixture (`src/fake/fixtures/<id>.mjs`: org `fabrikam-labs`, repo `quill-notes`; site `quill-labs.invalid`, project QLN), invented
    names only. Its queries are real enough to grade a query, not only the issues a case names: Jira's JQL (`field = | != | ~ | in | is`, and `created`/`updated` with `>= > <= < =` on `"YYYY-MM-DD"`, `"YYYY-MM-DD HH:mm"`, `-7d`, `now()`; a bare date is that day's midnight) and GitHub's issue and pull request search (`is:`, `state:`, `label:`, `assignee:`, `author:`, `no:`, `created:`/`updated:`/`closed:` as `D`, `>D`, `<=D`, `a..b`, `repo:`/`org:`); a clause it cannot read is an error, never an empty list (parentheses, `NOT`, a dangling `AND`/`OR`; `OR` joins groups of `AND`, and a comma in a `label:` is `OR`). "Now" is fixed (2026-09-17 12:00 UTC). What the fake's semantics do NOT rest on a document: `created = "2026-09-05"` (a bare date) returns the whole day, Atlassian documents only that a bare date means midnight; `-1M`, `-1y` and `startOfWeek()` (Monday-based) are the fake's, the documented relative units are `w d h m`; `ORDER BY` is ignored. Do not grade a case on any of them. A write that ever reached it would answer "Nothing was changed", but writes are still **asked and declined** and graded at the declined call.
  - **Grading**: a read is graded on tool choice and arguments (`call:`, `target:`), plus an outcome item against the fixture, `text:<span> contains @fixture.<plugin>.<fact>`
    (every value of a list; a number stands alone, 4 is not 14; the fact must exist in the fixture, checked at compile time), so an answer made up instead of read fails.
  - **`Data: synthetic`** is the only data a fake-mode plugin's case may declare (compile refuses anything else), so no sign-off is needed and DeepSeek may run them.
  - **The probe**: `evals p0 fake` shows, per plugin, that the model sees the pack's full tool list; that the plugin ran as released (the namespace line of the Code Mode catalog the
    model was given is the text the plugin's own source gives a signed-in user, with the tool count, and the plugin's own status RPC, read in the trial, says `connected` with its
    own server on the default URL, not `conflict`); that every request the fake got carried the vendor's host name; that a read returns the fixture's data; that a write is asked and
    declined and never reaches the fake; that no request reached the egress proxy at all; and that the proxy refuses the vendors' hosts.
  - **`accounts: none`** stays as a generic setting for any other plugin: no credential and no server. Its tools exist only after a sign-in, so call, target and canary clauses on
    them are n/a, and the honest-answer item `<prefix>-NA01` (a heuristic over the answer's words) is **minor**. Such a case is not deferred for a credential, a target or a canary.
- **Slack, X and Google use the apps already configured**: no second Slack app, no second X app, no separate Google client. They are not owner prerequisites; `check-real`
  still runs right after each of their sign-ins, and it is the check that says whether the shared app broke the normal profile.
- **The owner's sign-in walk: `~/evals-232/bin/signin.sh`** (installed by `scripts/profile/install.sh`). It signs the evals profile into the vendors, one at a time, in the plan's
  section 1.2.3 order less GitHub and Jira: OpenRouter, Affinity, Ashby, Plaud, Google (`gws`), Slack, X, ElevenLabs, Wispr Flow, Metaview, Granola, Notion, Linear. Each is the
  normal `opencode auth login <vendor>` flow in the evals profile (`evals-profile.sh`), followed at once by `check-real.sh <vendor>` against the **normal** profile. On any
  failure it stops, names the vendor, and prints one line: `Fix: sign <vendor> back in on your NORMAL profile (opencode auth login <vendor>), then run signin.sh --from <vendor>.`
  OpenRouter and Affinity are new (not in the normal profile): `check-real` proves their evals sign-in alone. It prints no token (a token-shaped run in a tool's output is masked).
  `--list` shows the order and what has passed (state in `$EVALS_STORE/signin-passed`), `--from <vendor>` resumes, `--only <vendor>` does one, `--redo` forgets. When it ends, run `evals phase1`.

## Phase 1: the credentialed phase's first steps, gated

`evals phase1` is the G0 re-check's section D as one executable sequence. Each step runs only if the one before it passed (recorded in
`$EVALS_STORE/phase1.json`, so a stopped run resumes with `--from <step>`), the first failure stops everything after it with the sentence that
says what to do, and a HALT in the store stops it whichever step is next. `evals phase1 --dry-run` prints the order and what each step needs.

| # | Step | What it does | A failure means |
| --- | --- | --- | --- |
| 1 | `preflight` | no HALT; the profile exists on its own service port with no link; `targets.json` is in the store | fix the profile or the store |
| 2 | `check-real` | after each vendor's sign-in (`--vendors a,b`, else the sign-in walk's vendors; never GitHub or Jira): the real profile still works and the tokens differ | sign the real profile back in for that vendor and sign in no more |
| 3 | `keeper` | P0-6: one identity read per signed-in vendor; a due token's expiry must move | the token did not read or refresh |
| 4 | `canaries` | `scripts/seed-canaries.mjs`: plants the round's canaries in the sandbox containers through the evals profile, idempotently, and records them in `canaries.json` (no `canaries/manifest.json`: a visible skip, and `--preflight data` defers the cases that name a canary) | a container that is not a sandbox alias, a plugin the profile is not signed in to, or a call the service refused |
| 5 | `p6c` | P0-6c: `auth logout` of one vendor, only with `--logout <vendor>`; watch the egress log | (skipped unless asked) |
| 6 | `p7` | P0-7: one scripted read per plugin (`live-reads.json`), the real egress hosts written to `egress-hosts.json`, none refused | a host is missing from the plugin's pack `egress`, or the read failed |
| 7 | `live` | `p0 live`: one real write per plugin (`live-writes.json`), guard on, one plugin at a time; declined is the pass | a completed write is a HALT: `evals halt` |
| 8 | `gws` | one real gws plan-and-commit in commit mode (`live-gws.json`) | the plan registry did not behave |
| 9 | `pilot` | P0-8, paid, last: only with `--pilot --confirm-labels` (the lead has read the cases' `Data:` labels and `Seed: plugins=`), a ceiling set, `pilot.json` | stops at a person's step until confirmed |

### Canaries

A canary is an invented fact in a sandbox: a prompt names it with `{{canary:<name>}}`, an item grades `text:any contains @canary.<name>`, and `$EVALS_STORE/canaries.json` holds its
value (a random token of at least 8 characters, so an answer cannot hit it by luck). `node scripts/seed-canaries.mjs [--manifest FILE] [--only a,b] [--dry-run]` plants them;
`evals phase1` runs it after the sign-ins and before any probe or case. `EVALS_PROFILE` names the evals profile; `--dry-run` prints the plan and calls nothing.

The manifest is `canaries/manifest.json` (or `EVALS_CANARIES_MANIFEST`): invented content only, so it may be committed.

```json
{ "schema": "oc-canaries/1", "canaries": [ {
    "name": "linear_issue",
    "plugin": "linear",
    "container": "linear.team",
    "content": "Quillfeather sync stalls {{token}}",
    "value": "content",
    "find":   { "method": "list_issues", "input": { "team": "{{container}}", "query": "{{content}}" }, "items": "issues", "where": "title", "id": "id" },
    "create": { "method": "save_issue",  "input": { "team": "{{container}}", "title": "{{content}}" }, "id": "id" }
} ] }
```

- `container` is a `targets.json` alias (one value). Anything else (an id, a name, an alias the store lacks) is refused before anything is created, and `find.input` and `create.input` must both
  name `{{container}}`: a canary that does not say where it goes is refused.
- `method` is the plugin's tools-RPC method and `input` that tool's input, with `{{container}}`, `{{content}}` and `{{token}}` (six random characters, made once and kept in `canaries.json`).
  `items` is the dotted path of the result's list, `where` the item field that holds the content (`match`: `equals` or `includes`), `id` the dotted path of the id.
- `value` is `content` (the default) or `id`, for a fact the vendor assigns (a Slack `ts`, a file id): the id the service returns is the value, and the content is the fixed text it is found by.
- Idempotent: each canary is **found** first and created only when it is not there; a rerun reuses and never duplicates, and keeps the content and the token. The ids go under `_ids` in
  `canaries.json` (a key that starts `_` is not a canary to the grader).
- Safety: it runs only through the evals profile (`EVALS_PROFILE` is required, is not the real home, and its service port is not the real service's), only for plugins the profile is signed in
  to, and as one session whose rules deny every tool of those plugins except the `find` and `create` methods named. Fake-mode plugins have nothing to seed.

`live-reads.json`, `live-writes.json` and `live-gws.json` live in the private store and hold `@alias` placeholders (resolved from `targets.json` at
run time), never an id: `{ "slack": { "code": "return await tools.slack.slack_send_message({ channel_id: '@slack.sandbox_channel', text: 'x' })" } }`.
The guard-off pass the first review asked for is not needed (with the guard on any failure of the config ask, the plugin's ask or `opencode run`'s
rejection shows as `EVALS-ASSERT access` and halts) and `guard: false` stays refused with a credential.

Also from the re-check (head 5001f74): the `Data:` minimum is derived from the plugin a case uses and every plugin its `Seed: plugins=` names, the
highest wins (granola, wisprflow, plaud and affinity read other people's words: `real`; metaview and ashby: `candidate`); a seed's paths are checked at any
depth (`api/opencode.json`, `sub/AGENTS.md`, any `.claude/`, `.agents/` or `.opencode/` except `.opencode/jobs/` data files); a wide case's blocker may
not rest on an argument path no signature in the pack declares (`args` on a pack tool, or make it a major item); `evals select <iteration>` writes, once, the first-pass
trial of each **wide** case that did not strictly pass (it refuses to overwrite the list; deep cases and later trials are never recorded) and `evals report` judges the baseline on the
others by itself, applying the list to wide cases only (`--no-fresh` for every trial; `--cases-dir` for cases outside the repository); `evals policy` computes no interval, only
`evals report` decides the statistical claim; a URL from `opencode service status` is a running service, so the profile's port is set once.

## The G0 review's changes (PR #8 at d7b6edf)

An independent review of the harness found six things that block the first run that holds a credential, and twelve more. All are in; each blocker has a test that fails if it regresses.

- **A completed write halts the wave.** After every trial the runner reads the guard's log (`src/run/halt.mjs`). Outside commit mode any
  completed write, any write that resolved to `allow` at the permission decision, or an ask the guard could not reject is a halt; in commit
  mode a write that completed with no `execute.before` pass for an in-scope target is. The runner launches nothing more, writes
  `$EVALS_STORE/HALT` (the batch, the trial, the tool, the target) so every other batch of the wave refuses to start, and says what was
  written where. `evals halt` shows it; `evals halt --clear` is the owner's, once read. Probe `halt` runs a write that really completes.
- **The cost cap fails closed.** A model that bills is refused when no ceiling or cap is set (`EVALS_ROUND_CEILING_USD`, `EVALS_ROUND_CAP_USD`,
  `round_cap_usd`), when it has no catalogue price, and when a recorded run of it has no list cost; only the scripted `mock/` model is exempt.
  A run that did model work and reported no tokens is counted at the estimate, marked `usage_missing` and returned as an error. A recording
  that says `"isUsingOverage": true` stops the batch (paid overage is never bought). Until 30 runs of a model and tier are recorded the estimate
  is the larger of their mean and 75th percentile. The X, OpenRouter and Inference caps count from the ledger like Tavily's and Affinity's:
  cumulative across the round, with other batches' reserved runs at their worst case ($0.25 an X call, $0.10 an OpenRouter call).
- **`Data:` is required** on every case (a compile error to omit it), and a plugin that reads HR records (metaview, ashby) must say `candidate`.
  The history, x and charts corpora written before the header are legacy: history is `own`, x is `real`, charts is `synthetic`. `real` and
  `candidate` cases run on no model, DeepSeek or Claude, unless `$EVALS_STORE/data-matrix.json` lists it: `{ "real": ["claude-agent/*"],
  "candidate": ["claude-agent/sonnet"] }`. A case of a plugin with a pack also declares a round set.
- **`"guard": false`** (or a guard mode other than refuse and commit) is refused whenever the trial holds any credential, `+profile` included.
- **The profile starts its own service**: `evals-profile.sh` and `exportProfile` give the profile a port of its own (47950, else the next free
  one), set with `opencode service set port` in the profile only, and never the real service's. `check-real` and the keeper refuse a profile whose
  port is the real one's, or has none. The keeper reads each credential's `expires` before and after its identity read and fails a token that was
  due and did not move. A batch exports the profile once, so a vendor whose tokens last an hour (Atlassian, Google, Notion) needs batches shorter
  than about 50 minutes. `check-real` says that a distinct token is not a distinct grant: the end of the round is `auth logout` in the profile.
- **`evals privacy --scan`** catches the token shapes: `sk-ant-` (API keys and Claude OAuth), `sk-proj-`/`sk-or-`, `xoxb-`/`xoxp-`/`xoxe`/`xapp-`,
  `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`/`github_pat_`, `ya29.` and Google refresh tokens, JWTs, `lin_oauth_`, `ntn_`, `secret_`, Atlassian `ATATT`,
  AWS keys, Tavily and ElevenLabs keys, a `Bearer` token of any length, an OAuth access or refresh token field, and private key blocks. A value that
  is obviously made up (`0123456789`, `abcdefghij`, `dummy`, `canary`, `example`) is not flagged, and a hex digest never is.
- **A plugin that failed to load** (the host's own log) is `infra: plugin`: never graded, and the batch stops.
- **Seeds** may not carry `opencode.json*`, `AGENTS.md`, `CLAUDE.md`, or anything under `.claude/`, `.agents/` or `.opencode/` (but `.opencode/jobs/` data
  files). **`Home files:`** names may not start with a dot, and a link is never followed or recorded. **A prompt may not hold a literal `<placeholder>`** (`<github sandbox repo>`, `<your channel>`): `evals compile` refuses it and names it; write the value, or use `{{target:<plugin>.<name>}}` / `{{canary:<name>}}` for one the store fills. A prompt that really quotes angle brackets (HTML, a shell redirect) lists each quoted token in `- Angle brackets: <h1>, </h1>`; a listed token the prompt does not contain is an error too. Only angle brackets (up to 79 characters, on one line) are checked: `[channel]`, `YOUR_REPO`, `${TARGET}`, `TODO` and `...` pass and are still gaps. The History, X and Charts cases written before this round are exempt **by a frozen list of ids** (`src/case/legacy-cases.json`: 83 + 14 + 15 cases and History's private `ho-` holdouts): a new case of those plugins, and any `Plugin: p0` case, meets every round rule, `Data:` and a round set included. A change to the list is a reviewed change. **A `Seed:` key written twice (`plugins=a plugins=b`) is refused too: the compiler read the first and the runner the last.** **A header is one line:** a header written twice is a compile error that names both lines (the last used to win, and a second `- Seed:` dropped the first's `plugins=` or `egress=`).
- **The commit plan names `@alias`es of `targets.json` only**; a literal, an unknown alias, or `actions` that differ from `writes` fails the run.
  `local: true` is the one write with no target (it touches only the trial's own sandbox).
- **The guard has an allow-list tripwire**: in a locked trial a tool other than `execute`, `skill`, `question`, `todowrite` and the plugins' own is
  refused at `execute.before` and logged (`refused_tools`), whatever it is, so a core tool a later version adds stays out.
- **P0-A2 runs the enforced path**: `+profile` with a dummy credential from a scratch profile and an arm file that names no `access`, so a regression of
  the runner's default shows end to end.
- **Grammar**: a positive `call:`, `first:` or `before:` glob in a wide case, `absent-arg:`, and a canary that the prompt fills and an item grades are
  compile errors; `canaries.json` values must be random tokens of at least 8 characters.
- **Which command decides**: `evals report` decides. Its interval is the case-cluster bootstrap (`src/report/cluster.mjs`: cases are the unit, models
  and trials nested inside), `--selecting <file>` judges the baseline on the trials that did not select a case (wide cases only), and arms labelled `h1` and `cb-h1` get the
  pooled holdout gate (the point estimate must not drop and the lower bound must stay above -5 points; two flipped holdouts hold a plugin). The older
  paired bootstrap is printed beside it. `evals policy` decides ship or hold on comparability and regressions.
- **The live write probe** (`evals p0 live`, with `EVALS_PROFILE` and the owner's `live-writes.json`): one real write call per plugin at `ask-changes`
  against its sandbox, each declined end to end with the guard on. The review's second pass with the guard off conflicts with the refusal above, so that
  half is the credential-free P0-g gold run.
- **Host sources**: `oc-src/2.3.1` sits beside `oc-src/2.3.2` (outside the scratch directory). Both hold `DESCRIPTION_LIMIT = 500` for the text `search()`
  returns (`@opencode/core/dist/chunks/instance-gxs71cxp.js`, `generate-gxs71cxp.js`).

The round's list-price ceiling (`EVALS_ROUND_CEILING_USD`, the phase's; `EVALS_ROUND_CAP_USD` or `round_cap_usd` in `caps.json`, the
hard cap) is checked **before every launch**: what the round has spent at list price (every run's tokens against the frozen catalogue,
through the model map: a subscription bills $0 and is counted anyway), plus the other batches' reserved runs, this batch's runs in
flight and this run, must stay under it. A run with no estimate (`estimate_run_usd[model][tier]` in `caps.json`, replaced by the
measured mean after five runs) cannot be held to the cap and is refused while one is set.

## Isolation

A backend (`src/run/isolation.mjs`) prepares once per batch and enters once per trial: the trial's `wrap` turns each
host command of a run (`opencode serve`, `opencode run`, the credential import, `--version`) into the command that
runs it confined, `ready` checks a server of the trial from wherever its loopback is, and `leave` ends everything
the trial started. `confines` says whether the run's processes are kept off the host filesystem. A run is live unless
it has no credential (`--auth none`) and runs the harness's own scripted model (`--scripted`); live or not is
recorded, but it no longer decides whether a run may go unconfined: every run can execute tools, so `--isolation
none` is refused for every run, before anything is created, reserved or imported (a world module included), unless
`--unsafe-no-isolation` is given; the summary and the batch record then say `unsafe_no_isolation: true`. World
`build` and `prepare` steps are the operator's own scripts and run on the host.

### The container backend

`--isolation container` (`src/run/container.mjs`) gives every trial:

- **its own container**, from the sandbox image (`docker/Dockerfile`: Ubuntu 24.04 pinned by digest, every package
  pinned by version: curl, git, ripgrep, sqlite3, jq, tini, procps; no Node, no OpenCode, no claude, no plugin, no
  credential). It runs as your own
  uid (never root), with a read-only root filesystem, a small tmpfs `/tmp` (256 MB), `--cap-drop ALL`,
  `no-new-privileges`, Docker's default seccomp and AppArmor profiles, its own pid namespace, and pids (512), memory
  (4 GB, no swap) and CPU (2) limits;
- **only its own files**: the trial's sandbox bind-mounted read-write at the same absolute path it has on the host (so
  HOME, the XDG tree, the working directory, the world's rewritten session paths and the sealed config stay valid);
  the build under test and the harness's scripted-model files read-only at theirs; and the host's `opencode`,
  `claude` (for the Claude Agent provider) and `bun` (for the scripted model) read-only under `/opt/evals/bin`, their
  sha256 recorded. Nothing else of the host: no home directory, no other trial, no Docker socket;
- **its own network**, `--internal` with the bridge gateway in Docker's `isolated` mode (Docker 28 or later): the bridge
  has no host address and the container has no route anywhere, so neither the host's services (an OpenCode server on
  loopback, a metadata service, anything on the host's addresses) nor the internet can be reached, and names do not
  resolve. A plain `--internal` network is not enough: its bridge address reaches the host;
- **one way out**: the batch's egress proxy (`docker/egress-proxy.mjs`), joined to every trial network as `egress`
  and set as `HTTPS_PROXY`. It allows `CONNECT` to port 443 of a host name on the allow-list, exactly (no wildcard, no
  IP literal, and only when the name resolves to a public address: never a private, loopback, link-local or
  documentation one, nor an IPv6 form that carries an IPv4 address, such as IPv4-mapped, NAT64, 6to4 or Teredo), and
  refuses everything else: another host, another port, a plain HTTP request. After `200`, nothing goes through the
  tunnel until the client's TLS ClientHello names the same host in its SNI (another name behind the same address, no
  SNI, or nothing within 10 s closes it), and the request itself must arrive within 10 s of the connection, however
slowly it is sent. At most 16 tunnels per trial and 64 in all are open at once. It runs as
  `nobody`, read-only, with no capabilities, on a network of its own, on the harness's own Node mounted read-only (the
  image has none: Ubuntu's is 18.x, past its end of life).
  The default allow-list is `api.anthropic.com`, `platform.claude.com`, `console.anthropic.com` and `claude.ai`;
  only the owner sets it (`caps.json` or `EVALS_EGRESS_ALLOW`, [configuration.md](configuration.md#the-container-backend)),
  never a case, an arm or a world. Every decision is logged by host name only, and the batch record's `egress` lists
  what was allowed and what was refused (at most 200 names, scrubbed like everything else).

Both `opencode serve` and `opencode run`, and under `--scripted` the mock model's server, run inside the trial's
container and talk over its loopback; the runner reaches them with `docker exec`. Every command's environment is passed
by name only (`docker exec -e NAME`, the value in the docker client's own environment): no secret is ever in an argv,
and nothing is set at `docker run`, so `docker inspect` of a trial shows no credential. The docker client itself runs
outside every sandbox, with your own Docker settings, never ones a run could plant in its HOME.

A trial ends with `docker rm -f`, which ends everything in it: killing a `docker exec` client does not stop what it
started inside, so the runner removes the container after every run (success, failure, timeout), on Ctrl-C and
`SIGTERM` (the interrupt handler tears the whole batch down: every trial, the proxy and its network), and after an
uncaught error. A runner killed outright leaves its containers and networks labelled with its pid, and its batch
directory under `EVALS_TMP`: the next batch's start, or `evals isolation sweep`, removes everything whose runner is
gone. A directory goes only if it holds the marker its runner wrote when it created it (`.evals-batch.json`: its own
path, the batch's label, the runner's pid and start time), that runner is dead, and Docker lists none of its
containers; it is removed the way the runner removes a sandbox (contained in `EVALS_TMP`, links not followed). A name
alone never qualifies a directory.

The sandbox lives on disk (`EVALS_TMP`, by default `/var/tmp/evals`), not in a memory-backed `/tmp`. Docker cannot put
a quota on a bind mount without root, so the disk is watched instead: every two seconds the trial's sandbox is walked
(links not followed) and its allocated bytes and entries counted. A trial is removed and recorded as killed when its
sandbox passes 2 GB (`disk`) or 200000 entries (`inodes`), when the filesystem under the sandboxes has less than 2 GB
or 100000 inodes free (`disk-floor`, `inode-floor`), or when the sandbox cannot be measured (`disk-unmeasurable`): a
directory the run made unreadable, or a walk longer than 10 s. While the container runs, the watchdog changes nothing
in the sandbox; it fails closed instead. This is a watchdog, not a quota: between two measurements (two seconds, plus
the walk itself, at most 10 s) a trial can write past its limits at the disk's speed, so the floors are what protect
the machine.

Once a trial's container is confirmed gone (`docker inspect` says there is no such container; an error is not taken
for one), and only then, the runner removes or scrubs its sandbox. A sandbox whose directories the run locked is
repaired through file descriptors, never by path: each entry is opened without following links and its mode changed
through `/proc/self/fd`, so a directory swapped for a link cannot aim the change outside the sandbox, and setuid,
setgid and sticky bits are dropped, never added. A batch whose containers cannot be confirmed gone keeps its
directory untouched and says so (`containers_left` in the batch record).

Startup checks, before any run is reserved: Docker is usable by this user, is version 28 or later, and the image is
built; the binaries exist; the proxy starts; and the version probe runs as a trial of its own, so a container that
cannot start stops the batch before it costs anything. Per trial the container costs about 0.3 s to set up and 0.5 s
to remove (measured here: two scripted trials in parallel in under 5 s, end to end).

`evals isolation build` builds the image (its tag is a digest of `docker/`, so an edit makes a new one; its build
context is that directory alone), `evals isolation check` reports Docker, the image and the settings, and
`evals isolation sweep` removes what dead batches left.

### Running live evals safely

1. **Docker**, version 28 or later, usable by your user without `sudo` (the `docker` group). Note that membership of
   the `docker` group is root-equivalent on the host: the Docker API can read any container's environment, the
   credential included (`docker inspect` of a trial does not show it, because it is passed per command, but the
   daemon holds it, and `/proc/<pid>/environ` of a trial's process shows it to root). Only the owner should have it.
2. **The image**: `evals isolation build`, once (and again after `docker/` changes); `evals isolation check` should
   report it.
3. **A disk for the sandboxes**: `/var/tmp/evals` is made, private to you, on first use. Where `/var/tmp` does not let
   you, create it once: `sudo install -d -m 700 -o "$USER" -g "$USER" /var/tmp/evals`, or set `EVALS_TMP` to a
   directory on disk.
4. **A credential that can only reach Anthropic**: the access token reaches a trial's processes as
   `CLAUDE_CODE_OAUTH_TOKEN` and nothing else of your sign-in ([Credentials](#credentials)); the agent can read it, and
   can send it only to the allow-listed hosts, and only in a TLS session whose SNI names the host it asked for. A
   client that uses Encrypted Client Hello would be refused (its outer SNI is another name).
5. **Start small**: a dry run (`--dry-run` prints the isolation and the allow-list), then a supervised batch of a few
   cases. Its batch record's `egress.refused` names the hosts `claude` or OpenCode tried and could not reach: widen
   the allow-list deliberately, in `caps.json`, only for a host that is needed.
6. **What isolation does not stop**: a run can still spend your plan's model time while it lives, and can send data
   to Anthropic itself (the allow-list cannot tell a model request from an upload to an Anthropic host); it can hide
   an encoded copy of the token in its output, which no scrub of the exact value finds; and it shares the host's
   kernel (a kernel or container-runtime exploit is out of scope). The plugin under test runs inside the container
   with the agent, so it is confined too, but it is trusted to measure itself honestly.

## Before the first run

In this order, and a failure stops the batch with nothing launched:

1. the isolation: a run without filesystem isolation is refused (unless `--unsafe-no-isolation`), and under
   `container` Docker, the image, the binaries and the proxy are checked and a probe container is started;
2. the cases are selected; a named case outside `--set` is an error, not an empty run;
3. a recording that already exists in the iteration is never overwritten (`--append` numbers new trials after it);
4. the build is copied into the batch directory, so a later edit to the checkout cannot reach a running batch;
5. the world is checked, and rebuilt with the build under test when it is stale (below);
6. the credential profile is prepared;
7. the dollar budget: the projected spend must fit the month's cap ([configuration.md](configuration.md#budget));
8. the model routes: one preflight trial, set up as a run's would be (the isolation, the build under test, the
   credential imported, the server started) but sent no prompt, must list the batch's model within
   `EVALS_ROUTE_TIMEOUT_S` (60 s), or the batch is refused;
9. the run caps: the whole batch is reserved in the run ledger, or refused whole.

During the batch, a run is not launched when the world has gone stale since the batch started (a batch that crosses
midnight UTC on a day-bound world) or when the month's billed spend has crossed its cap; its reservation is
released, and the batch record says why.

## The sandbox

Every run has its own directory under `EVALS_TMP` (else `/var/tmp/evals`, on disk): `home/` is `HOME`, `OPENCODE_TEST_HOME` and
the whole XDG tree, so the database, config, cache, logs and any plugin data are the run's own; `tmp/` is `TMPDIR`.
The config is sealed in `OPENCODE_CONFIG_CONTENT` (and written to the sandbox's own config file): the build under
test, its options and the model, nothing else, so the machine's plugins, MCP servers and agents never load. The
environment is built from nothing: `PATH`, the locale, proxy and CA settings if the machine has them, the sandbox's
directories, a password only this run knows, and auto-update, file watching and Claude Code import off. A caller's
`OPENCODE_*` variables and provider keys are not passed unless a profile passes them. A world's `env` is applied
first and may not set the harness's own variables (`HOME`, `PATH`, `TMPDIR`, `XDG_*`, `OPENCODE_*`, `CLAUDE_*`,
`ANTHROPIC_*`, the proxy settings, the scripted model's endpoint, `NODE_OPTIONS`, `LD_PRELOAD` and the like): those
are applied after it, so the sealed config cannot be replaced after the checks that read it, and the names a world
tried are recorded as `world_env_ignored`. Under `--scripted` the harness's provider is listed after the plugin under
test, so a `mock` provider the plugin registers is overridden by the harness's, and it reads its endpoint from a file
beside the batch's own copy of it (read-only in a container), not from the environment the plugin shares.

The host is `opencode serve` on a loopback port (inside the trial's container under `container`), and the run is
`opencode run --server <url> --format json` in the case's working directory. Both are started in their own process
group and stopped with it, and under `container` the trial's container is removed, so a provider's own CLI cannot
outlive its run. The sandbox is deleted after the run.

Links out of the sandbox are removed once, after the world is copied in and before the run starts. A run can make new
ones while it runs; only the container keeps them from reaching anything (inside it, a link to a host path points at
nothing that exists). After a run the runner treats the sandbox as hostile: it never follows a link out of it (a
working directory replaced by a link is not walked for the files record, and a sign-in file is removed only through
no link), and it removes the sandbox without following links, giving itself back access to any directory the run
locked first.

An interrupt (Ctrl-C, `SIGTERM`) or an uncaught error stops the batch the same way: every process group it started
gets `SIGTERM`, then `SIGKILL`, and every trial container, its network and the egress proxy are removed; the run that was interrupted is not recorded; the sandboxes, with the credential
imported into them, are removed (unless `--keep`); the runs that never launched are released from the ledger; the
batch record says `interrupted by SIGINT`; and the runner exits 130 (143 on `SIGTERM`, 1 on an error).

## Credentials

`--auth` is required, so a run never picks a credential up by accident. Nothing is written into the repository or
the store; a credential reaches a sandbox and is deleted with it.

| Profile | What the run gets |
| --- | --- |
| `none` | nothing: a mock model, or a provider that needs no sign-in |
| `env:A,B` | the caller's `A` and `B`, as they are (an API key) |
| `claude-agent` | OpenCode's Claude Agent provider, as the History lab ran it |

`claude-agent`: the credential OpenCode stores as "Claude Agent" (`EVALS_AUTH_CREDENTIAL` names another) is a marker
with no secret in it. It is exported once from the caller's own OpenCode (`opencode auth export`), held in memory,
and piped into each sandbox's `opencode auth import --standalone`. The export is the one command run with the
caller's own environment: it has to read the caller's stored credential from the caller's own OpenCode, and its
output goes straight into the sandbox, never to disk.

The secret is `claude`'s own sign-in, `~/.claude/.credentials.json`: an access token and a long-lived refresh token.
The runner reads it at the batch's start and again immediately before each trial (never through a link, never from a
FIFO, at most 64 KB, and only when it parses as a Claude sign-in) and keeps only the access token and its expiry, in
memory; its content is never logged. Something outside can rotate the sign-in (boxd keeps it fresh), which revokes the
value read earlier: each trial runs on the value current at its launch, and every value the batch has read is scrubbed
from everything it writes. A sign-in that cannot be re-read, or holds no access token, makes that trial `infra: auth`,
and no further trial launches; `evals run` then exits 1.
**Nothing of it is copied into a sandbox, the refresh token is never passed on, and a sandboxed run never writes to
the caller's `~/.claude`.** Each run's processes get the access token alone, as `CLAUDE_CODE_OAUTH_TOKEN`, which
`claude` uses for the whole session and never refreshes or writes. So a batch must not outlive the token: it is
refused when the access token expires within its worst case (the run timeout times the rounds of runs,
`ceil(runs / parallel)`, each round also counting a per-run overhead for the world's prepare step, the container's
setup and teardown, the credential import and the server's start, 120 s by default, `EVALS_RUN_OVERHEAD_S` or
`run_overhead_s` in `caps.json`; plus ten minutes), with the next step: use `claude` normally once so it refreshes,
then retry. The batch record's `horizon` says what was assumed.

A sign-in whose `expiresAt` is null or absent has an unknown expiry: some machines keep `claude`'s sign-in fresh
themselves (boxd injects it, and refreshes it outside every run). Such a batch cannot be checked against its token, so
`--auth claude-agent` refuses it unless `--accept-unknown-token-expiry` is given; then the horizon check is skipped,
the log warns, and the batch record's `horizon` says `expires: "unknown", accepted_by_flag: true` (`--dry-run` shows
the same). A known expiry is checked as above, flag or not. The access token must still be a non-empty string, and the
refresh token is parsed with the file but never kept or passed on.

A provider can fill its model list only after the server answers: the Claude Agent provider caches its catalog in
OpenCode's plugin storage and, in a fresh sandbox, fills it by probing `claude` (about a second; no model call). So
every run waits, after its server is ready, until `opencode models --server` inside the trial lists its model, and
only then sends the prompt. A model that does not route within `EVALS_ROUTE_TIMEOUT_S` (60 s), or a run the host
answers with `provider.no-route` before any model work, is `infra: "provider"`: not graded, released to the reserve,
and the batch launches nothing after it.

A trial whose model call is refused its credential (HTTP 401 or 403 from the provider, an authentication or
permission error, an expired or invalid token, the sign-in prompt), with no model work done, is recorded as an
infrastructure failure, `infra: "auth"` in its summary and trace. It is never graded (`evals grade` marks it
`NOT_RUN`, with the reason), its run goes back to the reserve, and no new trial is launched after it: the batch
record's `stopped` says why. Refresh the sign-in and rerun with `--append`. A run that ends on such a refusal after
the model already worked (the token was revoked mid-run) is `infra: "auth"` too, and not graded; but it spent, so it
is recorded in the ledger with what it billed (marked `infra`) and counts against the run and dollar caps.

Each sandbox has its own empty `~/.claude` (`CLAUDE_CONFIG_DIR`): no `.credentials.json`, no `~/.claude.json`, none of
the caller's settings, hooks, global `CLAUDE.md`, MCP servers or agents; `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1` and
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` are set, and claude's auto-updater is off. Everything `claude` writes
stays in the sandbox and is deleted with it. A world's home that carries links out of the sandbox (a lab sandbox
links `~/.claude` and `~/.local/bin`) has them removed. `CLAUDE_AGENT_SDK_VERSION` must be set and is passed on.

The token is readable by the agent under test, from its environment. The runner scrubs it, by its exact value, from
every recording, summary, files record, batch record and log line before writing them, and from every file of a kept
sandbox (masked with as many `*`, so a database keeps its layout); a key passed with `env:` is scrubbed the same
way, scrubbed before any output is cut (a value straddling a cut would otherwise leave its tail). The container keeps it
from leaving a run except to the allow-listed hosts. Whether the Claude Agent provider's own `claude` inherits the
variable, and which hosts a real turn needs, is to be confirmed by one supervised run.

## Worlds

A plugin whose cases need data brings a world: a directory with a `world.json`, or a module. Without one, each run
starts in an empty project directory.

```json
{
  "home": "gold/home",
  "repos": "repos",
  "cwd": { "api": "lumen-api", "web": "lumen-web" },
  "default_cwd": "api",
  "now": "truth.json#now",
  "fresh": "utc-day",
  "build": "./make-gold.sh",
  "overlay": "$EVALS_STORE/holdouts/history/world",
  "prepare": "./fix-directories.sh",
  "sessions": { "earlier": "ses_…" }
}
```

`home` is copied over each sandbox home (a seeded OpenCode database, a prebuilt index). `repos` holds working
directories, and a case's `Seed: cwd=<key>` picks one through `cwd`; each run works in its own copy. A key, and the
repository it names, is a single name inside `repos` (no `/`, no `..`): anything else is refused, and so is a
repository that is itself a symbolic link or holds one that points out of the world. After the copy, any link left in
the sandbox that points outside it is removed, however deep. Every containment check compares real paths, links
resolved. `now` is the
world's clock, a number of milliseconds or `file#key`. `fresh` says how long a build stays valid: `utc-day` (the
world's day must be today, UTC: History's synthetic history is relative to its build time, so its time-window
questions mean something else tomorrow), `<n>h`, or `always`.

`build` rebuilds the world, from the world directory, with `EVALS_WORLD_ARM` set to the copied build under test: a
plugin's own index must be built by the build being measured, never by a fixed baseline. The runner stamps each build
it ran with that build's digest (`.evals-world.json`); a world built by another build, or by hand, is stale. A stale
world is rebuilt (`--stale rebuild`) or refused (`--stale refuse`); a world with no `build` is refused.

`overlay` is a private add-on (holdout sessions, say) that lives in the store, never beside the world: `$VAR` in it is
the caller's variable, and the build receives it as `EVALS_WORLD_OVERLAY`; its digest is stamped with the build, so a
world built with another overlay is told apart without the overlay being shown. `prepare` runs per sandbox, after the
copy, with `EVALS_SANDBOX_HOME`, `EVALS_RUN_CWD` and `EVALS_REPO_SOURCE` set: a world whose recorded sessions name
directories rewrites them to the run's own there, so a directory-scoped question still means something in a copy.
`sessions` names sessions a case continues with `Seed: continue=<key>`: the run is `opencode run --session <id>` on
the sandbox's own copy of the world.

A case's `Seed:` can also bound the time of day: `utc-hours=9-15` runs the case only from 09:00 to 15:00 UTC (a window
may cross midnight, `22-6`); outside it the run is skipped and its reservation released, and every summary records
the UTC hour its run started.

A module world exports `{ name, status({ arm }), build({ arm, caller, log })?, prepare({ sandbox, case, seed, trial }),
provenance()? }`; `prepare` returns `{ cwd, env? }`.

## What a run records

`$EVALS_STORE/raw/<iteration>/<plugin>/<case>.t<k>.jsonl` is what `opencode run --format json` printed, and
`<case>.t<k>.summary.json` holds the exit (124 on a timeout), the time, the trial, the model, the host version, the
runner and its version, the credential profile's name, the isolation (and under `container`, `isolation_detail`: the
trial's container, its setup and teardown time, any processes the memory limit killed), `killed` when the disk
watchdog stopped it, `world_env_ignored` when a world tried to set a sealed variable, the world's name and clock, the
batch id and the build's provenance per axis. `<case>.t<k>.files.json` lists the files the run added, modified or deleted in its working directory (`.git` aside),
each with its digest and, for a text file of 64 KB or less, its content: `file:` clauses grade them, and no trace
holds them. `batch-<id>.json` is the plan and every run's outcome, with the isolation (image and its id, Docker version, limits,
allow-list, the binaries' sha256), `egress` (the proxy's allowed and refused host names) and `horizon`. The ledger
(`$EVALS_STORE/ledger/runs.jsonl`) has the reservation and one line per run with what it billed.

Not verified end to end by this repository's tests: a live model, the Claude Agent provider, and a real History world.
Those are exercised by a pilot, never by `npm test`. The container backend is: with Docker and the image present, the
tests run a scripted-model trial end to end inside a container and grade it, and check what a trial can read, write
and reach (they skip, with the reason, where Docker or the image is missing, as in CI).
