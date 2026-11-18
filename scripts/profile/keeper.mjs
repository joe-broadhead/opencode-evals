#!/usr/bin/env node
// keeper: only the evals profile refreshes (EVALS-232 §1.2.6). One free identity read per signed-in integration, through the
// evals profile's service, every 20 minutes and before every batch, so its tokens stay fresh and the real profile's are never
// the ones that get used. Nothing it reads is printed or logged but whether it worked.
//
//   keeper.mjs [--once] [--profile DIR] [--opencode BIN] [--store DIR] [--every MINUTES] [--only a,b]

import { join } from "node:path"
import { homedir } from "node:os"
import { IDENTITY, profileEnv, run, activeCredential, logRound } from "./profile-lib.mjs"

/** One pass: which integrations the profile is signed into, and whether each identity read worked. */
export function keepOnce({ opencode = "opencode", profile, store, env = process.env, only = null, exec = run } = {}) {
  const penv = profileEnv(profile, env)
  const results = []
  for (const [integration, route] of Object.entries(IDENTITY)) {
    if (only && !only.includes(integration)) continue
    const exported = exec(opencode, ["auth", "export", integration], { env: penv })
    if (exported.code !== 0 || !activeCredential(exported.stdout, integration)) continue
    const read = exec(opencode, ["api", "post", `/api/rpc/${route}`, "--data", "{}"], { env: penv })
    const ok = read.code === 0 && !/"error"\s*:/.test(read.stdout.slice(0, 400))
    results.push({ integration, ok, ...(ok ? {} : { why: `exit ${read.code}` }) })
  }
  if (store) logRound(store, { event: "keeper", reads: results.length, failed: results.filter((r) => !r.ok).map((r) => r.integration) })
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
