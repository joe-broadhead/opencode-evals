// Grading adapters: per-plugin facts derived from a run's own files, read by `state:` clauses when the iteration has
// no hand-written state fixture for the case (`fixtures/state/<iteration>/<case>.json` still wins). An adapter is a
// pure function of the files record; it never runs the plugin, so a fact it states is independent of the code under
// test.

import { chartsState } from "./charts.mjs"

const ADAPTERS = { charts: chartsState }

/** The derived state of one run, or null when the plugin has no adapter or the run has no files record. */
export function adapterState(plugin, files) {
  const adapter = ADAPTERS[plugin]
  return adapter ? adapter(files) : null
}

/** The adapter files, for the grader hash: a change to one can change a verdict. */
export const ADAPTER_FILES = ["src/grade/adapters/index.mjs", "src/grade/adapters/charts.mjs"]
