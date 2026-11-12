# Configuration

## The store

Everything a run produces lives in the **private store**, outside this repository:

```
$EVALS_STORE/
  raw/<iteration>/<plugin>/<case>.t<k>.jsonl   trial k of a case, exactly as the runner wrote it, with .summary.json
                                               (<case>.jsonl without a suffix: one trial, an older recording)
  traces/<iteration>/<plugin>/*.trace.jsonl   oc-trace/1, structure only (a store with traces/<iteration>/*.trace.jsonl is still read)
  t1/<plugin>/<version>/                  a T1 run's logs, capture events and fake-MCP call log
  results/<iteration>/                    verdicts.json, batch.json, scorecard.md
  results/t1/                             the coverage table
  ledger/runs.jsonl                       every live run, reserved before it starts: what the run caps count
  caps.json                               the run caps, when not the defaults (optional)
  labels/<plugin>.jsonl                   the owner's hand labels
  holdouts/<plugin>/                      private holdout cases (<id>.md, compiled in place by `evals compile --plugin <id>
                                          --holdouts`): run, graded and reported with the repository's cases, as holdouts
```

Default: `EVALS_STORE`, else `../private/store` relative to this repository. Nothing in the store is
committed, and nothing in the repository may reference a machine path: `evals privacy --scan` enforces it.

## Environment

| Variable | Default | What it does |
| --- | --- | --- |
| `EVALS_STORE` | `../private/store` | the private store |
| `EVALS_RAW` | `$EVALS_STORE/raw` | the recordings, when they live outside the store; `grade --raw DIR` overrides it for one run |
| `EVALS_PLUGIN_ROOT` | unset | a directory holding `opencode-<id>` checkouts; unset means no checkout, and the committed pack snapshot is used |
| `EVALS_REPO_<ID>` | unset | one plugin`s checkout, when they are not side by side |
| `EVALS_SDK_DIR` | unset | a checkout whose `node_modules` holds `@opencode/sdk` and `@opencode/plugin` |
| `OPENCODE_BIN_2_2_3`, `_2_2_4`, `_2_2_5`, `_2_2_6` | unset | a stock binary per tested version |
| `EVALS_STOCK_DIR` | unset | a directory with `<version>/node_modules/@opencode/cli-<platform>-<arch>/bin/opencode`, one `npm install @opencode/cli@<version>` per version; on Linux the glibc build is preferred to its `-baseline` build, and the `-musl` pair is used on musl |
| `EVALS_X_FAKE` | unset | the path to the X plugin's own host-test fake, for the shaper case |
| `EVALS_WITH_SLOT` | unset | the family's `with-slot.sh` |
| `EVALS_BUDGET_MODEL_USD` | `25` | the monthly model cap (D4) |
| `EVALS_BUDGET_VENDOR_USD` | `10` | the monthly vendor cap (D4) |
| `EVALS_MAX_RUNS_PER_PLUGIN` | `800` | live runs of one plugin in a calendar month (UTC) |
| `EVALS_MAX_RUNS_TOTAL` | `13000` | live runs of every plugin in a calendar month |
| `EVALS_MAX_RUNS_PER_PLUGIN_ITERATION`, `EVALS_MAX_RUNS_PER_ITERATION` | the monthly caps | live runs of one plugin, and of every plugin, in one iteration |
| `EVALS_ASSUMED_RUN_USD` | unset | the cost of one live run to assume when nothing else prices it; without it, an unpriced batch is held to the run caps alone |
| `EVALS_CAPS` | `$EVALS_STORE/caps.json` | a JSON file with `per_plugin_month`, `total_month`, `per_plugin_iteration`, `total_iteration`; the environment wins over it |
| `EVALS_MODEL_MAP` | `cost/model-map.json` | the alias-to-catalogue mapping |
| `EVALS_MODELS_CATALOG` | `$XDG_CACHE_HOME/opencode/models.json` | OpenCode's models.dev cache, the only source of a model price |
| `EVALS_TMP` | `/var/tmp/evals` for `evals run`, the system temp for T1 | where a live run's sandboxes (on disk, not a memory-backed `/tmp`) and a T1 run's scratch tree are made |
| `EVALS_OPENCODE_BIN` | `opencode` on `PATH` | the host `evals run` uses when `--host` names no stock version |
| `EVALS_AUTH` | unset | `evals run`'s credential profile when `--auth` is not given ([running.md](running.md#credentials)) |
| `EVALS_AUTH_CREDENTIAL` | `Claude Agent` | the stored OpenCode credential the `claude-agent` profile exports |
| `CLAUDE_AGENT_SDK_VERSION` | unset | required by the `claude-agent` profile, and passed to its runs |
| `EVALS_ISOLATION` | `container` | `evals run`'s isolation backend when `--isolation` is not given; `none` is refused for every run without `--unsafe-no-isolation` ([running.md](running.md#isolation)) |
| `EVALS_EGRESS_ALLOW` | the four Anthropic hosts | the egress proxy's allow-list, comma separated host names (below) |
| `EVALS_CONTAINER_MEMORY_MB`, `_CPUS`, `_PIDS`, `_TMPFS_MB`, `_DISK_MB`, `_MAX_PARALLEL` | 4096, 2, 512, 256, 2048, 8 | a trial container's limits (below) |
| `EVALS_DISK_FLOOR_MB` | 2048 | a trial is stopped when the filesystem under the sandboxes has less free |
| `EVALS_CONTAINER_IMAGE` | `opencode-evals-sandbox:<digest of docker/>` | the sandbox image, when not the one `evals isolation build` makes |
| `EVALS_DOCKER` | `docker` on `PATH` | the docker client |
| `EVALS_CLAUDE_BIN` | `claude` on `PATH` | the `claude` mounted into a trial for the Claude Agent provider |
| `EVALS_RUN_OVERHEAD_S` | `120` | what one run costs beyond its timeout, for the credential's horizon ([running.md](running.md#credentials)) |
| `EVALS_OPENCODE_CORE` | unset | a pinned `@opencode/core` whose tool registry a test compares the built-in tool list with |
| `EVALS_WORLD_<ID>` | unset | a plugin's world, a directory with `world.json` or a module ([running.md](running.md#worlds)) |

## The container backend

`evals run --isolation container`, the default, runs each trial in its own Docker container behind an egress proxy
([running.md](running.md#the-container-backend)). Its settings are the owner's: the store's `caps.json` (or the file
`EVALS_CAPS` names) and the environment, which wins. A case, an arm or a world cannot change them.

```json
{
  "container": {
    "egress_allow": ["api.anthropic.com", "platform.claude.com", "console.anthropic.com", "claude.ai"],
    "memory_mb": 4096, "cpus": 2, "pids": 512, "tmpfs_mb": 256,
    "disk_mb": 2048, "disk_floor_mb": 2048, "max_parallel": 8,
    "image": "opencode-evals-sandbox:<tag>"
  },
  "run_overhead_s": 120
}
```

`egress_allow` lists host names, exactly: no wildcard, no address; the proxy allows `CONNECT` to port 443 of these and
nothing else. `max_parallel` bounds `--parallel`, since each trial takes one of Docker's network address pools.
`disk_mb` is the per-trial sandbox limit and `disk_floor_mb` the free space below which a trial is stopped; both are
enforced by a watchdog, not a quota. The image is built from `docker/` with `evals isolation build`.

## Packs

`packs/<id>/pack.json` has two halves. The **derived** half comes from the plugin's own `package.json`
`jelly` section (`tools` with their permission action and effect, `skills`, `pluginId`, the `access` option and its
default, counts) and is refreshed with `evals pack --sync`. The effects are the default access's: at `all`, every
tool, a write included, is `allow`; `ask-changes` and `read-only` are the plugin's options, not the pack's.

Which plugins have packs is not a list in the code: `evals pack` covers every committed snapshot and every checkout
configuration points at (each `opencode-<id>` under `EVALS_PLUGIN_ROOT` whose `jelly` declares tools, and each
`EVALS_REPO_<ID>`). A new checkout is reported as having no snapshot, and `--sync` creates one; a checkout that breaks
the family's invariants (no plugin id, two tools sharing a permission action) is named and left without a pack. The **declared** half is written by hand and reviewed: the tools RPC
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
`claude-agent/haiku` maps to `anthropic/claude-haiku-5-5`, the id the claude CLI's own model catalogue gives its
`haiku` alias for a first-party sign-in; each alias is checked for drift against its own family's newest release.

**Vendors.** `src/cost/prices.json`, each rate with a `source` and an `as_of`, from the plugin's own
published table (the X rates are its skill file's). Vendor spend is reported beside the model spend, with
its own source, and is charged to its own cap.

## Budget

Two limits, both checked before a batch starts.

**Run caps.** Every live run is reserved in `$EVALS_STORE/ledger/runs.jsonl` before anything launches: a batch that
would take a plugin past `EVALS_MAX_RUNS_PER_PLUGIN` (800) runs this month, all plugins past `EVALS_MAX_RUNS_TOTAL`
(13000), or an iteration past its own cap, is refused whole, and nothing runs. The check and the reservation happen
under one lock file, so two runners cannot both take the last runs, and the ledger outlives the process, so the
caps hold across invocations. A run counts whatever it cost: a subscription run bills $0 and only the run cap can
stop it. A reservation counts until its unused runs are released; a batch that crashed keeps its runs counted.

**Dollars.** Every reservation records what each of its runs is expected to cost, and how that is known: the month's
mean billed cost of the model's priced runs; else the catalogue's list price (through the mapping) for the model's
mean recorded tokens; else an assumption the owner configured, `EVALS_ASSUMED_RUN_USD` or `assumed_run_usd` in
`caps.json` (a number, or a map by model). Before a batch, inside the ledger's lock, what the month has billed plus
every batch's reserved runs that have not billed yet plus this batch must stay within the cap. During a batch, each run
is launched only if the same sum, with this batch's runs in flight, stays within it, so a batch stops before it
crosses the cap. When nothing prices a batch's runs, the dollar cap is **not enforceable** for it: the run caps alone
apply, and the runner's log, each run's summary (`dollar_cap`) and `evals budget` say so; it is never taken as $0. A
cap that is not a number is an error. A run whose price is unknown still counts against the run caps.

`evals budget` prints both: the dollars against their caps, and the runs reserved this month, per plugin.
