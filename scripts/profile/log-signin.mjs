#!/usr/bin/env node
// log-signin.mjs <store> <integration>: records when a vendor's evals sign-in completed (logRound), and REPLACES the refresh-chain baseline with
// the REAL credential's `expires` at that moment — a sign-in is the new fixed point. A time only: no token, no digest.
import { activeCredential, credentialExpires, exportTarget, logRound, realServerUrl, realServiceProblem, recordBaseline, run, runReal } from "./profile-lib.mjs"

const [store, integration] = process.argv.slice(2)
if (!store || !integration) {
  console.error("usage: log-signin.mjs <store> <integration>")
  process.exit(2)
}
logRound(store, { event: "sign-in", integration })
// The guard ran before the sign-in, which can take minutes: check again before reading the real profile. Nothing is read when it reports a
// problem, and the baseline is taken by the next check-real instead (later, and so conservative).
const problem = realServiceProblem(process.env)
if (problem) {
  console.error(`log-signin: ${problem}; no baseline was taken (the next check-real takes one)`)
  process.exit(0)
}
try {
  realServerUrl(process.env)
} catch (error) {
  console.error(`log-signin: ${error.message}; no baseline was taken`)
  process.exit(1)
}
// The real profile's current expiry for this vendor, read through the web server (`--server`, never a plain opencode call). `replace: true`
// because a re-sign-in is the new fixed point: an old baseline would make a refresh between the two sign-ins look like a refresh after this one.
const target = exportTarget(integration)
const held = runReal(run, process.env.OPENCODE_BIN ?? "opencode", ["auth", "export", target], { base: process.env })
const credential = held.code === 0 ? activeCredential(held.stdout, target) : null
recordBaseline(store, integration, credentialExpires(credential), { replace: true, source: "sign-in" })
