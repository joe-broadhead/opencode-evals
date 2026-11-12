// Where the private store is. One definition, so every command reads and writes the same tree:
//
//   $EVALS_STORE            default ../private/store, beside this repository
//   $EVALS_STORE/raw        recordings; EVALS_RAW overrides it for a store whose recordings live elsewhere
//   $EVALS_STORE/traces/<iteration>/<plugin>/   oc-trace/1, beside the recordings' own layout
//
// Nothing here is written into the repository: these are configuration, resolved at run time.

import { existsSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")

export const storeRoot = (env = process.env) => env.EVALS_STORE ?? join(ROOT, "..", "private", "store")

export const rawRoot = (env = process.env) => env.EVALS_RAW ?? join(storeRoot(env), "raw")

/**
 * One iteration's traces for one plugin. A store written before traces were kept per plugin has them directly
 * under traces/<iteration>/, and is still read there; anything new is written per plugin.
 */
export function tracesDir(iteration, plugin, env = process.env) {
  const root = join(storeRoot(env), "traces", iteration)
  const nested = join(root, plugin)
  if (existsSync(nested)) return nested
  if (existsSync(root) && readdirSync(root).some((file) => file.endsWith(".trace.jsonl"))) return root
  return nested
}
