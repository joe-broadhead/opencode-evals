// Where the private store is. One definition, so every command reads and writes the same tree:
//
//   $EVALS_STORE            default ../private/store, beside this repository
//   $EVALS_STORE/raw        recordings; EVALS_RAW overrides it for a store whose recordings live elsewhere
//
// Nothing here is written into the repository: these are configuration, resolved at run time.

import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")

export const storeRoot = (env = process.env) => env.EVALS_STORE ?? join(ROOT, "..", "private", "store")

export const rawRoot = (env = process.env) => env.EVALS_RAW ?? join(storeRoot(env), "raw")
