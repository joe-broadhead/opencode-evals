#!/usr/bin/env node
// keeper: only the evals profile refreshes (EVALS-232 §1.2.6). It reads each credential's `expires` before and after its identity read:
// a token that was due (inside the refresh window) and did not move was not refreshed, and that is a failure, reported by name.
// A batch exports the profile once and hands its trials the access token as it was, so a vendor whose tokens last an hour (Atlassian,
// Google, Notion) needs batches shorter than about 50 minutes: slice a large set (the 977 wide cases) to fit. One free identity read per signed-in integration, through the
// evals profile's service, every 20 minutes and before every batch, so its tokens stay fresh and the real profile's are never
// the ones that get used. Nothing it reads is printed or logged but whether it worked.
//
//   keeper.mjs [--once] [--profile DIR] [--opencode BIN] [--store DIR] [--every MINUTES] [--only a,b]

import { join } from "node:path"
import { homedir } from "node:os"
import { IDENTITY, profileEnv, realEnv, run, activeCredential, logRound } from "./profile-lib.mjs"
import { assertDistinctPort } from "../../src/run/service-port.mjs"

/** A token this close to its expiry (or past it) is due: the identity read must make the service refresh it. */
export const REFRESH_WINDOW_MS = 15 * 60_000

/** One pass: which integrations the profile is signed into, and whether each identity read worked. */
export function keepOnce({ opencode = "opencode", profile, store, env = process.env, only = null, exec = run, now = Date.now() } = {}) {
  const penv = profileEnv(profile, env)
  // Never through the real service's port.
  assertDistinctPort({ opencode, profileEnv: penv, realEnv: realEnv(env), exec, env })
  const results = []
  const expiryOf = (integration) => {
    const out = exec(opencode, ["auth", "export", integration], { env: penv })
    const credential = out.code === 0 ? activeCredential(out.stdout, integration) : null
    return credential ? { present: true, expires: typeof credential.value?.expires === "number" ? credential.value.expires : null } : { present: false, expires: null }
  }
  for (const [integration, route] of Object.entries(IDENTITY)) {
    if (only && !only.includes(integration)) continue
    const before = expiryOf(integration)
    if (!before.present) continue
    const read = exec(opencode, ["api", "post", `/api/rpc/${route}`, "--data", "{}"], { env: penv })
    const ok = read.code === 0 && !/"error"\s*:/.test(read.stdout.slice(0, 400))
    const after = expiryOf(integration)
    const due = before.expires !== null && before.expires - now < REFRESH_WINDOW_MS
    const moved = before.expires !== null && after.expires !== null && after.expires > before.expires
    const stuck = ok && due && !moved
    results.push({ integration, ok: ok && !stuck, ...(due ? { due: true, refreshed: moved } : {}), ...(ok ? {} : { why: `exit ${read.code}` }), ...(stuck ? { why: "its token was due and its expiry did not move: the service did not refresh it" } : {}) })
  }
  if (store) logRound(store, { event: "keeper", reads: results.length, failed: results.filter((r) => !r.ok).map((r) => r.integration), refreshed: results.filter((r) => r.refreshed).map((r) => r.integration) })
  return results
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const flag = (name, fallback) => {
    const at = args.indexOf(`--${name}`)
    return at >= 0 ? args[at + 1] : fallback
  }
  const store = flag("store", process.env.EVALS_STORE ?? join(homedir(), "evals-232", "store"))
  const options = { opencode: flag("opencode", process.env.OPENCODE_BIN ?? "opencode"), profile: flag("profile", process.env.EVALS_PROFILE ?? join(store, "..", "profile")), store, only: flag("only", null)?.split(",") ?? null }
  const pass = () => {
    const results = keepOnce(options)
    console.log(`${new Date().toISOString()} keeper: ${results.length} read(s), ${results.filter((r) => !r.ok).length} failed${results.some((r) => !r.ok) ? `: ${results.filter((r) => !r.ok).map((r) => r.integration).join(", ")}` : ""}`)
    return results
  }
  if (args.includes("--once")) process.exit(pass().some((r) => !r.ok) ? 1 : 0)
  pass()
  setInterval(pass, Number(flag("every", 20)) * 60_000)
}
