#!/usr/bin/env node
// check-real: after the owner signs the evals profile into one integration, proves the REAL profile still works (EVALS-232 R2, §1.2.3).
// Prints only PASS or FAIL and the reason. No token is ever printed: they are compared as digests, in memory.
//
//   check-real.sh <integration> [--profile DIR] [--opencode BIN] [--store DIR]
//
// 1. the real profile still reads: one identity call through the REAL service's tools RPC succeeds;
// 2. the tokens differ: the digests of the real and the evals profile's access tokens (and refresh tokens) are not equal;
// 3. the real refresh chain survives: provisional until the real token's next refresh (the vendor's recheck is logged).
// On FAIL: stop signing in further vendors; the owner signs the real profile back in for that vendor.

import { join } from "node:path"
import { homedir } from "node:os"
import { IDENTITY, RECHECK_HOURS, NOT_IN_REAL, realEnv, profileEnv, run, activeCredential, digestsOf, logRound } from "./profile-lib.mjs"
import { assertDistinctPort } from "../../src/run/service-port.mjs"

export function checkReal({ integration, opencode = "opencode", profile, store, env = process.env, exec = run, now = new Date() }) {
  const real = realEnv(env)
  const evals = profileEnv(profile, env)
  const fail = (reason) => ({ ok: false, line: `FAIL ${integration}: ${reason}. Stop signing in further vendors: sign the real profile back in for ${integration}; its evals runs then use no credential.` })

  // 0. The evals profile's service is not the real one's: sharing its port would mean talking to the owner's own sign-ins.
  try {
    assertDistinctPort({ opencode, profileEnv: evals, realEnv: real, exec, env })
  } catch (error) {
    return fail(error.message)
  }

  // A vendor the real profile does not hold (OpenRouter, Affinity): nothing of the owner's can be signed out. The evals sign-in must be there and,
  // where the vendor has an identity tool, must read through the evals profile's own service.
  if (NOT_IN_REAL.includes(integration)) {
    const held = exec(opencode, ["auth", "export", integration], { env: real })
    if (!(held.code === 0 && activeCredential(held.stdout, integration))) {
      const mine = exec(opencode, ["auth", "export", integration], { env: evals })
      const credential = mine.code === 0 ? activeCredential(mine.stdout, integration) : null
      if (!credential) return fail("the evals profile holds no credential for it (sign it in first)")
      const route = IDENTITY[integration]
      if (route) {
        const read = exec(opencode, ["api", "post", `/api/rpc/${route}`, "--data", "{}"], { env: evals })
        if (read.code !== 0 || /"error"\s*:/.test(read.stdout.slice(0, 400))) return fail(`the evals profile's identity read (${route.split("/")[1]}) failed (exit ${read.code})`)
      }
      if (store) logRound(store, { event: "check-real", integration, result: "PASS", provisional: false, not_in_real: true })
      return { ok: true, line: `PASS ${integration}: not in the real profile, so there is nothing to sign out of; the evals sign-in is held${route ? " and reads" : ""}` }
    }
  }

  // 1. The real profile still reads.
  const route = IDENTITY[integration]
  let identity = "no identity tool for this integration (an API key): its presence is checked, not a call"
  if (route) {
    const read = exec(opencode, ["api", "post", `/api/rpc/${route}`, "--data", "{}"], { env: real })
    if (read.code !== 0 || /"error"\s*:/.test(read.stdout.slice(0, 400))) return fail(`the real profile's identity read (${route.split("/")[1]}) failed (exit ${read.code})`)
    identity = `identity read ${route.split("/")[1]} succeeded`
  }

  // 2. The tokens differ.
  const read = (environment) => {
    const out = exec(opencode, ["auth", "export", integration], { env: environment })
    return out.code === 0 ? activeCredential(out.stdout, integration) : null
  }
  const mine = read(real)
  const theirs = read(evals)
  if (!mine) return fail("the real profile holds no credential for it")
  if (!theirs) return fail("the evals profile holds no credential for it (sign it in first)")
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
  const integration = args.find((a) => !a.startsWith("--"))
  const flag = (name, fallback) => {
    const at = args.indexOf(`--${name}`)
    return at >= 0 ? args[at + 1] : fallback
  }
  if (!integration) {
    console.error("usage: check-real.sh <integration> [--profile DIR] [--opencode BIN] [--store DIR]")
    process.exit(2)
  }
  const store = flag("store", process.env.EVALS_STORE ?? join(homedir(), "evals-232", "store"))
  const result = checkReal({ integration, opencode: flag("opencode", process.env.OPENCODE_BIN ?? "opencode"), profile: flag("profile", process.env.EVALS_PROFILE ?? join(store, "..", "profile")), store })
  console.log(result.line)
  process.exit(result.ok ? 0 : 1)
}
