#!/usr/bin/env node
// check-real: after the owner signs the evals profile into one integration, proves the REAL profile still works (EVALS-232 R2, §1.2.3).
// Prints only PASS or FAIL and the reason. No token is ever printed: they are compared as digests, in memory.
//
//   check-real.mjs <integration> [--profile DIR] [--opencode BIN] [--store DIR] [--real-server URL] [--real-server-env FILE]
//
// Every path below is an environment variable with today's value as its default (EVALS_PROFILE, EVALS_STORE, EVALS_REAL_SERVER,
// EVALS_REAL_SERVER_ENV); the README lists them.
//
// 1. the real profile still reads: one identity call through the REAL service's tools RPC succeeds;
// 2. the tokens differ: the digests of the real and the evals profile's access tokens (and refresh tokens) are not equal;
// 3. the real refresh chain survives: provisional until the real token's next refresh (the vendor's recheck is logged).
// On FAIL: stop signing in further vendors; the owner signs the real profile back in for that vendor.

import { join } from "node:path"
import { IDENTITY, RECHECK_HOURS, NOT_IN_REAL, exportTarget, identityCheck, IDENTITY_CALLS, realEnv, profileEnv, run, runReal, realServiceProblem, activeCredential, digestsOf, logRound, defaultProfileDir, defaultStoreDir } from "./profile-lib.mjs"
import { assertDistinctPort } from "./service-port.mjs"

export function checkReal({ integration, opencode = "opencode", profile, store, env = process.env, exec = run, now = new Date(), guard = {} }) {
  const real = realEnv(env)
  const evals = profileEnv(profile, env)
  // Which side failed decides what the owner is told (exit code, see signin.sh): 1 the real profile, 4 the evals profile (nothing wrong with the real one),
  // 5 the web server could not be read or the guard refused.
  const failEvals = (reason) => ({ ok: false, side: "evals", line: `FAIL ${integration}: ${reason}. Your normal profile is not involved. Run the check again with signin.sh --recheck ${integration} (no new sign-in), or sign ${integration} into the evals profile again with signin.sh --from ${integration}.` })
  const failRead = (reason) => ({ ok: false, side: "read", line: `FAIL ${integration}: ${reason}; check the web server, then run signin.sh --recheck ${integration}` })
  const realDirectory = real.HOME
  const callEvals = (args) => exec(opencode, args, { env: evals })
  const leftoverNote = (r) => (r?.leftover ? ` (the check session ${r.leftover} could not be deleted: delete the session titled "evals walk check" yourself)` : "")
  const fail = (reason) => ({ ok: false, line: `FAIL ${integration}: ${reason}. Stop signing in further vendors: sign the real profile back in for ${integration}; its evals runs then use no credential.` })
  // Real-profile calls go to the owner's web server only (`--server`), and never while a real background service exists or runs.
  const target = exportTarget(integration)
  const callReal = (args) => runReal(exec, opencode, args, { base: env })

  // -1. No real background service, and nothing on its port: checked from /proc, with no opencode command (one could start it).
  const problem = realServiceProblem(env, guard)
  if (problem) return { ok: false, side: "read", line: `FAIL ${integration}: ${problem}` }

  // 0. The evals profile's service is not the real one's: sharing its port would mean talking to the owner's own sign-ins.
  try {
    assertDistinctPort({ opencode, profileEnv: evals, realEnv: real, exec, env })
  } catch (error) {
    return fail(error.message)
  }

  // A vendor the real profile may not hold (Affinity; OpenRouter only as an MCP tools entry): nothing of the owner's can be signed out. The evals sign-in must be there and,
  // where the vendor has an identity tool, must read through the evals profile's own service.
  if (NOT_IN_REAL.includes(integration)) {
    const held = callReal(["auth", "export", target])
    // A failed real export is NOT "absent": only a successful export with no credential takes the not-in-real path.
    if (held.code !== 0) return failRead(`could not read the real profile through the web server (the export exited ${held.code})`)
    if (!activeCredential(held.stdout, target)) {
      const mine = exec(opencode, ["auth", "export", target], { env: evals })
      const credential = mine.code === 0 ? activeCredential(mine.stdout, target) : null
      if (!credential) return failEvals("the evals profile holds no credential for it (sign it in first)")
      const route = IDENTITY[integration]
      let called = ""
      let note = ""
      if (route) {
        const read = identityCheck(callEvals, { vendor: integration, directory: profile })
        if (!read.ok) return failEvals(`the evals profile's identity read (${route.split("/")[1]}) failed: ${read.why}${leftoverNote(read)}`)
        called = `${route.split("/")[1]} (${IDENTITY_CALLS[integration]})`
        note = read.leftover ? ` WARNING:${leftoverNote(read)}` : ""
      }
      if (store) logRound(store, { event: "check-real", integration, result: "PASS", provisional: false, not_in_real: true })
      return { ok: true, line: `PASS ${integration}: not in the real profile, so there is nothing to sign out of; the evals sign-in is held${called ? ` and reads: identity read ${called} succeeded with the expected answer` : ""}.${note}` }
    }
  }

  // 1. The real profile still reads.
  const route = IDENTITY[integration]
  let identity = "no identity tool for this integration (an API key): its presence is checked, not a call"
  if (route) {
    const read = identityCheck(callReal, { vendor: integration, directory: realDirectory })
    // The plugin's binary is downloaded on first use, which is a change the check session may not make (it allows one read and nothing else): not a failure of the real profile.
    if (!read.ok && read.notInstalled) return { ok: false, side: "install", line: `FAIL ${integration}: the ${integration} plugin's program is not installed in your normal profile yet (the first use downloads it, and the check never downloads anything). Run /gws-install in your normal OpenCode (the web app at http://127.0.0.1:4096), or make one gws call there, then run signin.sh --recheck ${integration}${leftoverNote(read)}` }
    if (!read.ok) return fail(`the real profile's identity read (${route.split("/")[1]}) failed: ${read.why}${leftoverNote(read)}`)
    identity = `identity read ${route.split("/")[1]} (${IDENTITY_CALLS[integration]}) succeeded with the expected answer${read.leftover ? ` WARNING:${leftoverNote(read)}` : ""}`
  }

  // 2. The tokens differ.
  // A failed real export is not "no credential": the web server may only be unreachable.
  const exported = callReal(["auth", "export", target])
  if (exported.code !== 0) return failRead(`could not read the real profile through the web server (exit ${exported.code})`)
  const mine = activeCredential(exported.stdout, target)
  const heldHere = exec(opencode, ["auth", "export", target], { env: evals })
  const theirs = heldHere.code === 0 ? activeCredential(heldHere.stdout, target) : null
  if (!mine) return fail("the real profile holds no active credential for it")
  if (!theirs) return failEvals("the evals profile holds no credential for it")
  const a = digestsOf(mine)
  const b = digestsOf(theirs)
  if (a.access && a.access === b.access) return fail("the evals profile holds the SAME access token as the real profile (one grant, not two)")
  if (a.refresh && a.refresh === b.refresh) return fail("the evals profile holds the SAME refresh token as the real profile (one grant, not two)")
  const same = ["access", "refresh"].filter((k) => !a[k] || !b[k])
  const compared = same.length === 2 ? "no token in either to compare (an API key or an external credential)" : "access and refresh tokens differ"

  // 3. The real refresh chain: provisional until its next refresh.
  const hours = RECHECK_HOURS[integration]
  const recheck = hours ? new Date(now.getTime() + hours * 3_600_000).toISOString() : null
  if (store) logRound(store, { event: "check-real", integration, result: "PASS", provisional: Boolean(hours), recheck_at: recheck })
  // A different token string is not a different grant: a GitHub OAuth app, for one, hands every sign-in the same grant under a new string,
  // so revoking the evals profile's grant would sign the owner out. The end of the round is `auth logout` in the evals profile, never a revoke.
  return { ok: true, line: `PASS ${integration}: ${identity}; ${compared}${hours ? `; provisional: the real refresh chain is checked again by ${recheck} (repeat on days 1 and 2)` : ""}. A distinct token does not prove a distinct grant: end the round with \`auth logout\` in the evals profile only, never by revoking a grant` }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const flags = ["--profile", "--opencode", "--store", "--real-server", "--real-server-env"]
  const integration = args.find((a, i) => !a.startsWith("--") && !(i > 0 && flags.includes(args[i - 1])))
  const flag = (name, fallback) => {
    const at = args.indexOf(`--${name}`)
    return at >= 0 ? args[at + 1] : fallback
  }
  if (!integration) {
    console.error("usage: check-real.mjs <integration> [--profile DIR] [--opencode BIN] [--store DIR] [--real-server URL] [--real-server-env FILE]")
    process.exit(2)
  }
  const storeFlag = flag("store", null)
  const store = storeFlag ?? defaultStoreDir()
  const opencode = flag("opencode", process.env.OPENCODE_BIN ?? "opencode")
  // A store given on the command line keeps its own sibling profile unless --profile says otherwise.
  const profile = flag("profile", process.env.EVALS_PROFILE ?? (storeFlag ? join(storeFlag, "..", "profile") : defaultProfileDir()))
  const env = { ...process.env }
  const realServer = flag("real-server", null)
  const realServerEnv = flag("real-server-env", null)
  if (realServer) env.EVALS_REAL_SERVER = realServer
  if (realServerEnv) env.EVALS_REAL_SERVER_ENV = realServerEnv
  // --skip-unsigned (the recheck of every vendor): a vendor with no active credential in the evals profile is reported, not failed. Read from the evals profile's own service only.
  if (args.includes("--skip-unsigned")) {
    const held = run(opencode, ["auth", "export", exportTarget(integration)], { env: profileEnv(profile, env) })
    if (!(held.code === 0 && activeCredential(held.stdout, exportTarget(integration)))) {
      console.log(`SKIPPED ${integration}: not signed into the evals profile${held.code === 0 ? "" : ` (the export exited ${held.code})`}`)
      process.exit(3)
    }
  }
  const result = checkReal({ integration, opencode, profile, store, env })
  console.log(result.line)
  process.exit(result.ok ? 0 : result.side === "evals" ? 4 : result.side === "read" ? 5 : result.side === "install" ? 6 : 1)
}
