#!/usr/bin/env node
// log-signin.mjs <store> <integration>: records when a vendor's evals sign-in completed (logRound), and the REAL credential's `expires` at that
// moment as the refresh-chain baseline. A time only: no token, no digest. check-real later proves a refresh by reading a LATER real expiry.
import { activeCredential, credentialExpires, exportTarget, logRound, realServerUrl, recordBaseline, run, runReal, trustedExpiry } from "./profile-lib.mjs"

const [store, integration] = process.argv.slice(2)
if (!store || !integration) {
  console.error("usage: log-signin.mjs <store> <integration>")
  process.exit(2)
}
logRound(store, { event: "sign-in", integration })
// The baseline is the real profile's current expiry for this vendor, read through the web server (`--server`, never a plain opencode call).
// A failure here is not fatal: the first check-real then records the baseline, which is later, and so conservative.
try {
  realServerUrl(process.env)
} catch (error) {
  console.error(`log-signin: ${error.message}`)
  process.exit(1)
}
const target = exportTarget(integration)
const held = runReal(run, process.env.OPENCODE_BIN ?? "opencode", ["auth", "export", target], { base: process.env })
const credential = held.code === 0 ? activeCredential(held.stdout, target) : null
const expires = credentialExpires(credential)
if (expires && trustedExpiry(expires)) recordBaseline(store, integration, expires, { source: "sign-in" })
