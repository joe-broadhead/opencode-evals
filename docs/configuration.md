# Configuration

## The store

Everything a run produces lives in the **private store**, outside this repository:

```
$EVALS_STORE/
  raw/<iteration>/<plugin>/<case>.jsonl   a recording, exactly as the runner wrote it
  traces/<iteration>/<plugin>/*.trace.jsonl   oc-trace/1, structure only
  t1/<plugin>/<version>/                  a T1 run's logs, capture events and fake-MCP call log
  results/<iteration>/                    verdicts.json, batch.json, scorecard.md
  results/t1/                             the coverage table
  labels/<plugin>.jsonl                   the owner's hand labels
  holdouts/<plugin>/                      four cases per plugin the tuning lane never sees
```

Default: `EVALS_STORE`, else `../private/store` relative to this repository. Nothing in the store is
committed, and nothing in the repository may reference a machine path: `evals privacy --scan` enforces it.

## Environment

| Variable | Default | What it does |
| --- | --- | --- |
| `EVALS_STORE` | `../private/store` | the private store |
| `EVALS_PLUGIN_ROOT` | unset | a directory holding `opencode-<id>` checkouts; unset means no checkout, and the committed pack snapshot is used |
| `EVALS_REPO_<ID>` | unset | one plugin`s checkout, when they are not side by side |
| `EVALS_SDK_DIR` | unset | a checkout whose `node_modules` holds `@opencode/sdk` and `@opencode/plugin` |
| `OPENCODE_BIN_2_2_3`, `_2_2_4`, `_2_2_5` | unset | a stock binary per tested version |
| `EVALS_STOCK_DIR` | unset | a directory with `<version>/node_modules/@opencode/cli-*/bin/opencode` |
| `EVALS_X_FAKE` | unset | the path to the X plugin's own host-test fake, for the shaper case |
| `EVALS_WITH_SLOT` | unset | the family's `with-slot.sh` |
| `EVALS_BUDGET_MODEL_USD` | `25` | the monthly model cap (D4) |
| `EVALS_BUDGET_VENDOR_USD` | `10` | the monthly vendor cap (D4) |
| `EVALS_TMP` | the system temp | where a T1 run's scratch tree is made |

## Packs

`packs/<id>/pack.json` has two halves. The **derived** half comes from the plugin's own `package.json`
`jelly` section (`tools` with their permission action and effect, `skills`, `pluginId`, counts) and is
refreshed with `evals pack --sync`. The **declared** half is written by hand and reviewed: the tools RPC
id, the options the plugin needs in a test host, the fake, and the T1 cases.

A pack with no `fake` has no MCP server in a test host, so its MCP-dependent checks are not attempted — the
coverage table says so rather than pretending.

## Cases

A case is a markdown file in `cases/<plugin>/`, compiled to `cases/<plugin>/<id>.json` and frozen into
`evals.lock`. The format is in `docs/design.md`, and `cases/x/small-bounded-search.md` is the worked example.

A case may not be edited inside a comparison: `evals.lock` holds the case-set and grader digests, and
`evals verify` fails when either moved.

## Cost

Two wallets, never merged.

**Models.** Every model call records two numbers: what the provider billed (`billed`, from the message
record's own `cost`), and what the catalogue would charge (`list`, the split token counters against
OpenCode's models.dev data). The classification is one function:

| Situation | Source | Amount |
| --- | --- | --- |
| the provider billed more than zero | `billed` | its number |
| it billed zero or nothing, tokens were used, the catalogue prices the model | `list-price` | tokens × catalogue |
| the catalogue prices the model at zero | `free` | $0 |
| nothing can price the model | `missing` | — (never counted as $0) |

No model price is typed into this repository. The catalogue is read from `EVALS_MODELS_CATALOG`, else
`$XDG_CACHE_HOME/opencode/models.json` (where OpenCode caches models.dev), and its digest and fetch time are
recorded with every trace. A provider alias that is not a catalogue provider (our eval model is one) stays
`missing` unless a mapping names the catalogue id it stands for:

```json
{ "claude-agent/opus": "opencode/claude-opus-4-8" }
```

`EVALS_MODEL_MAP` points at that file. It is a mapping, never a price: the rate still comes from the catalogue.

**Vendors.** `src/cost/prices.json`, each rate with a `source` and an `as_of`, from the plugin's own
published table (the X rates are its skill file's). Vendor spend is reported beside the model spend, with
its own source, and is charged to its own cap.

## Budget

The runner checks the month's spend before a batch: `evals budget` prints it, and
`assertWithinBudget` refuses a run that would cross either cap. A run whose price is unknown is allowed and
counted as `unknown_cost_runs`, because refusing to run on a missing price would hide the work that finds it.
