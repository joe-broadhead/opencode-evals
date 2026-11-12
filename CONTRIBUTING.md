# Contributing

## Setup

Requires Node 22. The tool has no runtime dependencies.

```sh
npm test                     # 70-odd deterministic tests: no model, no network
node bin/evals compile --all # compile every case set (--check writes nothing and fails on a change)
node bin/evals selftest      # the gold cases that test the graders
```

The tiers that need more than Node are configured, never assumed:

| Variable | What it points at |
| --- | --- |
| `EVALS_PLUGIN_ROOT` | the directory holding the plugin checkouts; without it the tool uses the committed pack snapshots |
| `EVALS_SDK_DIR` | a checkout whose `node_modules` holds `@opencode/sdk` and `@opencode/plugin` |
| `OPENCODE_BIN_2_2_6` (and `_2_2_3`, `_2_2_4`, `_2_2_5`) | a stock OpenCode binary per tested version |
| `EVALS_X_FAKE` | the X plugin's own host-test fake, for the shaper case |
| `EVALS_REPO_<ID>` | one plugin`s checkout, e.g. `EVALS_REPO_X` |
| `EVALS_STORE` | the private store: traces, verdicts, scorecards, labels |
| `EVALS_WITH_SLOT` | the family's `with-slot.sh`, so nine plugins do not start nine servers |
| `EVALS_BUDGET_MODEL_USD`, `EVALS_BUDGET_VENDOR_USD` | the monthly dollar caps |
| `EVALS_MAX_RUNS_PER_PLUGIN`, `EVALS_MAX_RUNS_TOTAL` | the monthly run caps (800, 13000) |
| `EVALS_OPENCODE_BIN`, `EVALS_AUTH`, `EVALS_WORLD_<ID>` | the host, credential profile and world `evals run` uses ([running.md](docs/running.md)) |

## What to run before a commit

```sh
node bin/evals check --plugin x    # T0, T-G and the T1 checks that are configured
node --test test/*.test.mjs
node bin/evals privacy --scan      # must be clean: this repository is public
```

`evals check` exits non-zero on a blocker. A plugin's own `npm run check` can call it as a final stage;
see `docs/ci.md`.

## Rules

- Deterministic by default. A test that needs a model, a vendor API or a network is not a test here.
- A clause that cannot be settled is `BLOCKED`, never a pass and never a guess.
- A price without a source and a date is missing, not invented.
- Nothing private in the tree or the history: `evals privacy --scan` fails the build on a machine path, an
  email address, a real post link, a credential, or any path that belongs to the private store.
- Every number must be recomputable from the stored inputs: `evals verify`.

## Tests

`node --test test/*.test.mjs`. The analyser has a replay test over a recorded run, ported from the bug that
made every earlier call count wrong; the graders have gold cases with known verdicts; the policy has
hand-built batch pairs; the privacy gate has fixtures that must fail.

## Releasing

A `v<version>` tag on `master`. The release workflow refuses a tag that differs from `package.json`.
