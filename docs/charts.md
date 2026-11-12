# The Charts corpus

`cases/charts/*.md` is a fixed, versioned task corpus for agents using the Charts plugin: initial creation and
revision of a saved chart, graded from what the run actually saved. It measures **agent behaviour**; the plugin's own
deterministic and browser suites (in its repository) measure the renderer. A pass here is evidence about an agent's
calls on these tasks, never about the renderer, and a passing renderer suite is no evidence about agents.

## Sets

| Set | Cases | What it is for |
| --- | --- | --- |
| `corpus` | 13 | every task below, for live runs |
| `create` | 7 | a new chart from data: long labels in a narrow panel, explicit aggregation, ambiguous aggregation, count versus measure, misspelt field names, a brand theme, empty data |
| `revise` | 6 | a chart saved in the world: light → dark, inline → presentation → inline, add x zoom, add scatter brushing, unsupported pie zoom, a cosmetic change after the source CSV changed |
| `scripted` | 2 | harness probes for the scripted model (`mock/m1`): one document call that saves a chart, one the plugin refuses |

The corpus is version 1 (the `Source:` header of each case says "charts task corpus v1"), and `cases/charts/evals.lock`
freezes the case set and the grader; `evals report` and `evals policy` refuse to compare runs across a different lock.

## The world

`worlds/charts/` holds synthetic data (`fixtures/data/*.csv`, no third-party data) and a build. `node build.mjs`,
run by `evals run` when the world is stale (built by a different build of the plugin), makes one working directory per
seed under `repos/`:

- `data`: the CSVs only, for the creation tasks;
- `saved-bar`, `saved-line`, `saved-scatter`, `saved-pie`: the CSVs and a chart saved by **the build under test**,
  through its tools RPC on a stock OpenCode host with no model (`charts_quick` with a recipe document), so the saved
  `.chart.json` is the one that build writes and reads;
- `saved-bar-changed`: the saved bar chart, then `data/sales.csv` replaced with different numbers (North Online
  becomes 1000 a month), for the cosmetic-change-after-a-data-change task.

The build needs a stock binary (`OPENCODE_BIN_<version>` or `EVALS_STOCK_DIR`) and `bun`, as T1 does. It writes
`truth.json` (the saved charts' paths and revisions); `repos/` and `truth.json` are build outputs and are not committed.

## Grading

Every item is decided by code. Besides the shared grammar (calls and their arguments, the answer text, the files the
run wrote), the Charts **grading adapter** (`src/grade/adapters/charts.mjs`) turns the run's saved `.chart.json`
artifacts into facts for `state:` clauses: the recipe, bindings, aggregate, theme and its mode, layout target and
outer size, interaction settings, the captured row count, whether every generation captured the same rows, and each
group's value, **recomputed from the captured rows** with the aggregate the document names. The expected numbers in
the cases are worked out by hand from the fixtures (North's Q1 revenue is 510), so a case checks the data the chart
holds, not the plugin's compiler. A fact the adapter cannot recompute (a document with a `data.transform`, a recipe of
one mark per row) is absent, and a clause on it is unverifiable, never guessed.

What each task grades, independently:

- **Data and meaning**: the fields bound, the aggregate, the recomputed values, the rows kept (`C-OC*`).
- **Capabilities and formats**: the right tool and preset (`charts_update` for a presentation change, `zoom: "x"` on a
  temporal line, `brush: "interval"` on a scatter), and an HTML page where an interaction needs one.
- **Preserved semantics across updates**: the same captured rows and totals in every new generation, and the captured
  data used even when the source CSV changed.
- **Readable size**: the exact outer size the task asks for. A saved artifact at that size means the plugin's layout
  planner met its label floor; an unsatisfiable layout saves nothing.
- **Safety**: no redraw from scratch where an update is asked for, no edited data file, no hand-edited artifact, no
  invented rows for empty data, no claim of an unsupported zoom (`C-SF*`).
- **Efficiency**: first-attempt success and repairs, as minor items (`count:charts.quick <= 1`), with tokens, cost,
  latency and turns from the trace head and the batch record when the runner supplies them.

Not graded per run: **browser-confirmed interaction**. A run's HTML page is not opened in a browser here; the add-zoom
and add-brush tasks grade that the agent asked for the supported preset with the format that carries it, and the
preset's behaviour is the plugin's own browser suite's evidence (`recipe-x-zoom`, `recipe-interval-brush`).

`test/charts-corpus.test.mjs` grades hand-built good and bad runs for the key tasks, and checks that a run that did
nothing fails every corpus task (none passes or blocks vacuously).

## Running it

```sh
export EVALS_STORE=… EVALS_STOCK_DIR=…          # the private store, and the stock binaries
# The scripted model: no credential, nothing live; still one container per trial.
evals run --plugin charts --iteration charts-scripted --model mock/m1 --scripted --auth none \
  --set scripted --arm ../opencode-charts --world worlds/charts --host 2.2.5
evals trace --iteration charts-scripted --plugin charts
evals grade --iteration charts-scripted --plugin charts
# A live sample, when a model run is authorised: the same tasks, k trials, the same model for both arms.
evals run --plugin charts --iteration charts-v1-a --model <provider>/<model> --auth <profile> \
  --set corpus --trials 3 --arm ../opencode-charts --world worlds/charts --host 2.2.5
evals report base=charts-v0-a new=charts-v1-a --plugin charts --set corpus
```

The `--arm` is a built checkout of the plugin (`npm run build`). The scripted model makes one tool call per prompt
directive (`[[mock:tool:execute:…]]`), so only the `scripted` probes make a chart with it; the 13 corpus tasks are
natural-language prompts, and with the scripted model they run, trace and grade, and fail, which is what shows the
pipeline works without measuring any agent.

## Results so far

Only scripted runs: the two probes pass (a saved chart graded through the adapter, North 510 and West 192; a refused
call that saves nothing), and the 13 corpus tasks run, trace and grade with every item testable and every task
failing, as a model that makes no tool call should. **No live model has run this corpus**: agent success rates,
first-attempt rates, repairs and cost are unmeasured, and no target is set before a baseline exists.
