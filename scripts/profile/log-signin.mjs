#!/usr/bin/env node
// log-signin.mjs <store> <integration>: the time a vendor's evals sign-in completed, one line in the round log (logRound). check-real reads
// it to decide whether the real profile's token has since been refreshed (provisional -> verified). No token is read, printed or written.
import { logRound } from "./profile-lib.mjs"

const [store, integration] = process.argv.slice(2)
if (!store || !integration) {
  console.error("usage: log-signin.mjs <store> <integration>")
  process.exit(2)
}
logRound(store, { event: "sign-in", integration })
