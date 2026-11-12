# opencode-evals

Deterministic evals for OpenCode skills, tools and plugins: one case format, one trace schema, code-decided
verdicts, and a ledger that refuses to compare two runs that are not comparable.

**Unofficial; not affiliated with OpenCode or Anomaly.**

## Requirements

- Node 22.
- For the static, case, grading, policy and label tiers: nothing else.
- For the T1 tier: an OpenCode stock binary per version you test (2.2.3 to 2.2.6), and `bun` for the fake
  MCP server. Both are configured, not assumed: see [Configuration](#configure).
- macOS or Linux.

## Install

```sh
npm install --save-dev @joe-broadhead/opencode-evals
```

Or run it from a checkout: `node bin/evals <command>`.

## Use

```sh
evals compile --plugin history     # markdown cases -> oc-case/1 JSON (--all for every plugin, --check to write nothing)
evals run --plugin history --iteration v1-a --model claude-agent/haiku --auth claude-agent --trials 3
                                   # one sandboxed live run per case and trial, under the run caps
evals trace --iteration v1-a --plugin history   # recordings -> oc-trace/1
evals grade --iteration nx6        # grade a recorded iteration from the private store
evals scorecard --iteration nx6    # one page, with the comparison against a hand grading
evals policy --a nx5 --b nx6       # ship, hold or ask, with the reasons
evals report base=b-t1,b-t2 new=n-t1,n-t2 --set tune   # strict pass, pass^k, paired bootstrap per arm
evals t0  --plugin x               # static checks on a plugin checkout
evals t1  --plugin x               # what the plugin makes possible, with no model
evals check --plugin x             # T0 + the gold cases + T1: the CI gate
evals verify                       # re-derive a batch and refuse if a number moved
evals verify --all                 # list every graded iteration the grader or the cases have moved past
evals label --plugin x             # the hand-label kit for the advisory items
evals privacy --scan               # the pre-publish gate over the tree and the history
evals budget                       # month to date against the caps
```

`node --test test/*.test.mjs` runs the suite: no model, no network, no vendor API.

## The tiers

| Tier | What it proves | Runs |
| --- | --- | --- |
| T0 | the declaration is consistent: skills parse, descriptions fit, the tool table, the skills and the tools RPC agree, no denied tool is exposed, no handle or machine path in model-facing text | every commit |
| T1 | what the plugin makes possible: it loads, its default rules guard the agents it claims, a write asks and is refused, a denied tool is refused before dispatch, the tools RPC describes what it claims, a shaper runs | every commit, no model |
| T2 | the recordings, re-judged by changed code: a rule, a threshold or a grader edit costs seconds | every grader change |
| T3 | a live smoke test: something is badly broken, or a forbidden action happened | per pull request |
| T4 | distributions: `pass^k`, cost per passing case, latency percentiles, triggering precision and recall | per release |

The gold cases (T-G) test the graders themselves: a suite that passes everything is measured against
cases that must fail.

## Permissions

The tool reads plugin checkouts and the private store, and writes results, labels and traces. It starts an
OpenCode host from a binary you point it at, and a mock model on loopback. It does not sign in to anything,
does not call a vendor's API, and holds no credentials. The one exception is `evals run`, which runs a real model:
it passes the credential you name with `--auth` into each run's sandbox, and deletes it with the sandbox
([docs/running.md](docs/running.md)).

Nothing private is committed: the store — recordings, traces, verdicts, scorecards, labels, holdouts — lives
outside the repository. A trace reduces a session's content to structure; `evals privacy --scan` checks the
tree and the whole git history before anything is shared.

## Configure

Options, environment variables, the store layout and the cost rules: [docs/configuration.md](docs/configuration.md).
Live runs, their sandbox, credentials, worlds and caps: [docs/running.md](docs/running.md).
CI, the gate and how a plugin's own `npm run check` calls it: [docs/ci.md](docs/ci.md).

## Organisation rollout

1. Add `evals check --plugin <id>` as the last stage of a plugin's `npm run check`.
2. Give every plugin a pack: `packs/<id>/pack.json`, derived from its own `jelly` declaration.
3. Keep four holdouts per plugin outside the repository, written by whoever does not tune the skill.
4. Run the release sweep (`evals run`: T3, then T4 at k=3) under the monthly caps, and attach the scorecard to the release.

## Troubleshooting

| What you see | What it means |
| --- | --- |
| `no @opencode/sdk at …` | set `EVALS_SDK_DIR` to a checkout whose `node_modules` holds the SDK and the plugin API |
| `no stock binary for 2.2.6` | set `OPENCODE_BIN_2_2_6`, or `EVALS_STOCK_DIR` to a directory with one folder per version holding an `npm install @opencode/cli@<version>` |
| `describe answered 400` | the plugin registers no tools RPC without a sign-in or its options; the check reports `unsupported` |
| `BLOCKED` items | the evidence could not settle the item — a variable argument, a missing recording, a dependency not configured |
| `not comparable` | the case set, the rules, the model or the grader differ: the tool names the fields |
| `cost.source: missing` | no price entry; add one with a source and a date rather than a guess |
| `run cap: … would reach …` | the batch does not fit this month's run caps; nothing ran. `evals budget` shows what is reserved |
| `world … is stale` | the world's day has passed or another build indexed it; give it a `build`, or rebuild it |
| `already have recordings` | the iteration has those cases; use a new `--iteration`, or `--append` for more trials |

## Uninstall

```sh
npm uninstall @joe-broadhead/opencode-evals
```

The private store is yours to delete: it is outside the repository.

## Links

- [Configuration](docs/configuration.md) · [Running](docs/running.md) · [CI](docs/ci.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)
- [Design: how the tiers, cases, traces and policy fit together](docs/design.md)

MIT. Copyright (c) 2026 Joe Broadhead.
