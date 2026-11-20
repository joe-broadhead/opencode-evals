#!/usr/bin/env node
// log-signin.mjs [--forget] <store> <integration>: records when a vendor's evals sign-in completed (logRound) and REPLACES the refresh-chain
// baseline with the REAL credential's `expires` at that moment, bound to the evals credential's id (a sign-in is the new fixed point). A time
// and an id only: no token, no digest. With --forget it only removes the vendor's baseline, before a sign-in.
import { activeCredential, credentialExpires, defaultProfileDir, exportTarget, forgetBaseline, logRound, profileEnv, realServerUrl, realServiceProblem, recordBaseline, run, runReal } from "./profile-lib.mjs"

const args = process.argv.slice(2)
const forget = args[0] === "--forget"
const [store, integration] = forget ? args.slice(1) : args
if (!store || !integration) {
  console.error(`usage: log-signin.mjs${forget ? " --forget" : ""} <store> <integration>`)
  process.exit(2)
}
if (forget) {
  forgetBaseline(store, integration)
  process.exit(0)
}
logRound(store, { event: "sign-in", integration })
// The guard ran before the sign-in, which can take minutes: check again before reading the real profile. Nothing is read when it reports a
// problem. The baseline is settled by check-real: it re-baselines when the evals credential id differs from the stored one, and keeps it only
// for the same credential. Meanwhile signin.sh has already deleted the old baseline.
const problem = realServiceProblem(process.env)
if (problem) {
  console.error(`log-signin: ${problem}; no baseline was taken here (check-real settles it against the evals credential)`)
  process.exit(0)
}
try {
  realServerUrl(process.env)
} catch (error) {
  console.error(`log-signin: ${error.message}; no baseline was taken here (check-real settles it against the evals credential)`)
  process.exit(1)
}
// The evals credential's id is not a secret: it is what makes a later baseline stale after a new evals sign-in, even a manual one.
const profile = process.env.EVALS_PROFILE ?? defaultProfileDir(process.env)
const mine = run(process.env.OPENCODE_BIN ?? "opencode", ["auth", "export", exportTarget(integration)], { env: profileEnv(profile, process.env) })
const evalsId = mine.code === 0 ? activeCredential(mine.stdout, exportTarget(integration))?.id ?? null : null
// The real profile's current expiry for this vendor, read through the web server (`--server`, never a plain opencode call). `replace: true`
// because a re-sign-in is the new fixed point: an old baseline would make a refresh between the two sign-ins look like one after this one.
const target = exportTarget(integration)
const held = runReal(run, process.env.OPENCODE_BIN ?? "opencode", ["auth", "export", target], { base: process.env })
const credential = held.code === 0 ? activeCredential(held.stdout, target) : null
recordBaseline(store, integration, credentialExpires(credential), { replace: true, source: "sign-in", evalsId: typeof evalsId === "string" ? evalsId : null })
