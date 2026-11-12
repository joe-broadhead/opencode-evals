# Running live evals

`evals run` runs a plugin's cases against a real model: one isolated OpenCode run per (case, trial), recorded in the
private store where `evals trace` reads it. It is the only command that spends model time, so everything that can
refuse a batch does so before the first run starts.

```sh
evals run --plugin history --iteration v1-a --model claude-agent/haiku --auth claude-agent \
  --set tune --trials 3 --parallel 4 --arm ../opencode-history --world ../history-world
evals trace --iteration v1-a --plugin history
evals grade --iteration v1-a --plugin history
evals report base=v0-a v1=v1-a --plugin history --set tune
```

| Flag | Default | What it does |
| --- | --- | --- |
| `--plugin <id>` | required | the pack id; the cases are `cases/<id>/*.json` in this repository (`--cases-dir` for another set) |
| `--iteration <name>` | required | the recordings go to `$EVALS_STORE/raw/<name>/<plugin>/` |
| `--model <provider>/<model>[#variant]` | required | the model every run uses |
| `--auth <profile>` | required (or `EVALS_AUTH`) | where the model credential comes from: below |
| `--cases <ids>` | `*` | ids and `prefix*` globs, comma separated |
| `--set <sets>` | `tune` | `tune`, `holdout`, `tools`, `all`, or a comma list (see [design.md](design.md#reports-over-arms)) |
| `--trials <k>` | `1` | runs per case; each is `<case>.t<k>`, and one trial never ships |
| `--parallel <n>` | `4` | runs at once; each gets its own server on a free port |
| `--arm <dir>` \| `<file>.json` \| `none` | the plugin's checkout | a built plugin (`dist/`, `skills/`, `package.json`), copied once per batch; a JSON arm file names one and its options; `none` is the no-plugin control |
| `--world <dir\|file.mjs>` | `EVALS_WORLD_<ID>`, else an empty project | what each sandbox starts with: below |
| `--host <version>` | `EVALS_OPENCODE_BIN`, else `opencode` on `PATH` | a tested stock binary (`OPENCODE_BIN_<version>` or `EVALS_STOCK_DIR`) |
| `--options <json>` | none | the plugin's options in the run (or put them in an arm file, not both) |
| `--timeout <s>` | `420` | a run is killed after this |
| `--stale rebuild\|refuse` | `rebuild` | what to do with a stale world |
| `--append` | off | add trials after the ones the iteration already has; without it, a case with recordings is refused |
| `--dry-run` | off | print the plan and the caps; launch and reserve nothing |
| `--keep` | off | keep the sandboxes (for debugging the runner; they hold the imported credential) |

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

## Before the first run

In this order, and a failure stops the batch with nothing launched:

1. the cases are selected; a named case outside `--set` is an error, not an empty run;
2. a recording that already exists in the iteration is never overwritten (`--append` numbers new trials after it);
3. the build is copied into the batch directory, so a later edit to the checkout cannot reach a running batch;
4. the world is checked, and rebuilt with the build under test when it is stale (below);
5. the credential profile is prepared;
6. the dollar budget: the projected spend must fit the month's cap ([configuration.md](configuration.md#budget));
7. the run caps: the whole batch is reserved in the run ledger, or refused whole.

During the batch, a run is not launched when the world has gone stale since the batch started (a batch that crosses
midnight UTC on a day-bound world) or when the month's billed spend has crossed its cap; its reservation is
released, and the batch record says why.

## The sandbox

Every run has its own directory under `EVALS_TMP` (else the system temp): `home/` is `HOME`, `OPENCODE_TEST_HOME` and
the whole XDG tree, so the database, config, cache, logs and any plugin data are the run's own; `tmp/` is `TMPDIR`.
The config is sealed in `OPENCODE_CONFIG_CONTENT` (and written to the sandbox's own config file): the build under
test, its options and the model, nothing else, so the machine's plugins, MCP servers and agents never load. The
environment is built from nothing: `PATH`, the locale, proxy and CA settings if the machine has them, the sandbox's
directories, a password only this run knows, and auto-update, file watching and Claude Code import off. A caller's
`OPENCODE_*` variables and provider keys are not passed unless a profile passes them.

The host is `opencode serve` on a free loopback port, and the run is `opencode run --server <url> --format json` in
the case's working directory. Both are started in their own process group and stopped with it, so a provider's own
CLI cannot outlive its run. The sandbox is deleted after the run.

## Credentials

`--auth` is required, so a run never picks a credential up by accident. Nothing is written into the repository or
the store; a credential reaches a sandbox and is deleted with it.

| Profile | What the run gets |
| --- | --- |
| `none` | nothing: a mock model, or a provider that needs no sign-in |
| `env:A,B` | the caller's `A` and `B`, as they are (an API key) |
| `claude-agent` | OpenCode's Claude Agent provider, as the History lab ran it |

`claude-agent`: the credential OpenCode stores as "Claude Agent" (`EVALS_AUTH_CREDENTIAL` names another) is exported
once from the caller's own OpenCode (`opencode auth export`), held in memory, and piped into each sandbox's `opencode
auth import --standalone`. The provider spawns `claude`, which reads its own sign-in: `~/.claude` and `~/.local/bin`
are linked into the sandbox home (shared, never copied), and the sandbox's `~/.claude.json` holds only the
onboarding flags and the account id fields. `CLAUDE_AGENT_SDK_VERSION` must be set and is passed on. `claude` keeps
a transcript per working directory in `~/.claude/projects/`; after each run, the directory for that run's sandbox
path is removed, and nothing else.

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
  "build": "./make-gold.sh"
}
```

`home` is copied over each sandbox home (a seeded OpenCode database, a prebuilt index). `repos` holds working
directories, and a case's `Seed: cwd=<key>` picks one through `cwd`; each run works in its own copy. `now` is the
world's clock, a number of milliseconds or `file#key`. `fresh` says how long a build stays valid: `utc-day` (the
world's day must be today, UTC: History's synthetic history is relative to its build time, so its time-window
questions mean something else tomorrow), `<n>h`, or `always`.

`build` rebuilds the world, from the world directory, with `EVALS_WORLD_ARM` set to the copied build under test: a
plugin's own index must be built by the build being measured, never by a fixed baseline. The runner stamps each build
it ran with that build's digest (`.evals-world.json`); a world built by another build, or by hand, is stale. A stale
world is rebuilt (`--stale rebuild`) or refused (`--stale refuse`); a world with no `build` is refused.

A module world exports `{ name, status({ arm }), build({ arm, caller, log })?, prepare({ sandbox, case, seed, trial }),
provenance()? }`; `prepare` returns `{ cwd, env? }`.

## What a run records

`$EVALS_STORE/raw/<iteration>/<plugin>/<case>.t<k>.jsonl` is what `opencode run --format json` printed, and
`<case>.t<k>.summary.json` holds the exit (124 on a timeout), the time, the trial, the model, the host version, the
runner and its version, the credential profile's name, the world's name and clock, the batch id and the build's
provenance per axis. `batch-<id>.json` is the plan and every run's outcome. The ledger
(`$EVALS_STORE/ledger/runs.jsonl`) has the reservation and one line per run with what it billed.

Not verified end to end by this repository's tests, which use a stand-in binary: a live model, the Claude Agent
provider, and a real History world. Those are exercised by a pilot, never by `npm test`.
