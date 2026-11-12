// Where a plugin's cases are: the repository's cases/<plugin>/, and the private holdouts in the store,
// $EVALS_STORE/holdouts/<plugin>/, which never enter the repository. A private holdout is a holdout whatever its header
// says, and an id that is in both is an error: a holdout that was published is no longer one.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { storeRoot } from "../store.mjs"

const ROOT = resolve(import.meta.dirname, "..", "..")

export const repoCasesDir = (plugin) => join(ROOT, "cases", plugin)
export const privateHoldoutsDir = (plugin, env = process.env) => join(storeRoot(env), "holdouts", plugin)

/** The compiled cases in one directory: every `<id>.json` that is an oc-case/1. */
export function casesIn(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")))
    .filter((c) => c?.schema === "oc-case/1")
}

/**
 * The cases a run, a grade or a report covers. With `dir`, only that directory; without, the repository's cases and
 * the store's private holdouts for the plugin.
 */
export function pluginCases(plugin, { dir = null, env = process.env } = {}) {
  if (dir) return casesIn(dir)
  const published = casesIn(repoCasesDir(plugin))
  const holdouts = casesIn(privateHoldoutsDir(plugin, env)).map((c) => ({ ...c, holdout: true, private: true }))
  const clash = holdouts.filter((c) => published.some((p) => p.id === c.id))
  if (clash.length) throw new Error(`private holdout(s) ${clash.map((c) => c.id).join(", ")} are also in the repository's cases/${plugin}: a published holdout is not a holdout`)
  return [...published, ...holdouts]
}
