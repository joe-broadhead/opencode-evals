#!/usr/bin/env node
// copy-client.mjs <slack-app|x-app|gws-app>: gives the evals profile the owner's own app client (EVALS-232: Slack, X and Google use the apps the owner
// already configured, not second apps). Client configuration only, never a user token. Prints PASS or FAIL and the reason, never a secret.
//
//   slack-app, x-app  `auth export <id>` from the REAL profile through the web server (--server), cut to the client entry (appClientEntry), then
//                     `auth import` from stdin into the evals profile. Verified by digest: the evals client id equals the real one. An entry the
//                     evals profile already holds with the SAME client id is left alone; a different one is never overwritten.
//   gws-app           the Desktop OAuth client in the real gws-default credential's metadata is written to $EVALS_STORE/evals-gws-client.json (600);
//                     evals-profile.sh then lists it as the gws plugin's `oauthClient` option, so the gws sign-in form hides the client fields.
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { CLIENT_STEPS, realServicePortOf, profileEnv, run, runReal, realServiceProblem, activeCredential, appClientEntry, gwsClient, sha256, logRound, defaultProfileDir, defaultStoreDir } from "./profile-lib.mjs"

export function copyClient({ step, opencode = "opencode", profile, store, env = process.env, exec = run, guard = {} }) {
  const fail = (reason) => ({ ok: false, line: `FAIL ${step}: ${reason}` })
  if (!(step in CLIENT_STEPS)) return fail(`not an app-client step (${Object.keys(CLIENT_STEPS).join(", ")})`)
  const problem = realServiceProblem(env, guard)
  if (problem) return fail(problem)
  // Calls into the evals profile go to ITS service only: its port must already be set (evals-profile.sh does it) and must not be the real service's.
  if (step !== "gws-app") {
    let port = 0
    try { port = Number(JSON.parse(readFileSync(join(profile, ".config", "opencode", "service.json"), "utf8")).port) } catch {}
    if (!port) return fail(`the evals profile's own service port is not set: run evals-profile.sh -- true first (in the profile scripts' directory)`)
    if (port === realServicePortOf(env)) return fail(`the evals profile's service is on the real service's port ${port}: refusing`)
  }
  const evals = profileEnv(profile, env)
  const done = (line, extra = {}) => {
    if (store) logRound(store, { event: "copy-client", step, result: "PASS", ...extra })
    return { ok: true, line }
  }

  if (step === "gws-app") {
    const out = runReal(exec, opencode, ["auth", "export", "gws-default"], { base: env })
    if (out.code !== 0) return fail(`could not read the real profile through the web server (the export exited ${out.code})`)
    const client = gwsClient(out.stdout)
    // No Desktop client to copy is not a failure: the gws sign-in form asks for one itself. It is SKIPPED, never PASS.
    if (!client) return { ok: true, skipped: true, line: "SKIPPED gws-app: the real gws sign-in holds no Desktop OAuth client to copy (none stored, or a Web client, which is not copied): the gws form will ask for it" }
    const file = env.EVALS_GWS_CLIENT ?? join(store, "evals-gws-client.json")
    const mine = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null
    if (mine && sha256(mine.clientId) !== sha256(client.clientId)) return fail(`${file} holds a client id that differs from the real profile's (the gws sign-in would use that other client). Fix: delete ${file}, then run signin.sh --from gws-app`)
    if (!mine) {
      writeFileSync(`${file}.tmp`, `${JSON.stringify(client)}\n`, { mode: 0o600 })
      chmodSync(`${file}.tmp`, 0o600)
      renameSync(`${file}.tmp`, file)
    }
    const check = JSON.parse(readFileSync(file, "utf8"))
    if (sha256(check.clientId) !== sha256(client.clientId) || sha256(check.clientSecret) !== sha256(client.clientSecret)) return fail("the saved client does not match the real one")
    return done(`PASS gws-app: the real gws OAuth client ${mine ? "is already" : "is now"} set for the evals profile's gws plugin (client id digest matches). No token was copied`, { client_id_digest: sha256(client.clientId).slice(0, 12) })
  }

  const id = step
  const real = runReal(exec, opencode, ["auth", "export", id], { base: env })
  const entry = real.code === 0 ? appClientEntry(real.stdout, id) : null
  if (!entry) return fail(`the real profile holds no ${id} client entry (exit ${real.code})`)
  const digest = (e) => (e ? sha256(e.value.key) : null)
  const held = () => {
    const out = exec(opencode, ["auth", "export", id], { env: evals })
    return out.code === 0 ? appClientEntry(out.stdout, id) : null
  }
  const before = held()
  if (before) {
    if (digest(before) !== digest(entry)) return fail(`the evals profile already holds a ${id} entry with a different client id: nothing was overwritten; remove it or decide which app to use`)
    return done(`PASS ${id}: already in the evals profile, client id matches the real profile's`, { already: true })
  }
  const imported = exec(opencode, ["auth", "import"], { env: evals, input: JSON.stringify([{ id: `cred_${randomBytes(13).toString("hex")}`, ...entry }]) })
  if (imported.code !== 0) return fail(`\`auth import\` into the evals profile failed (exit ${imported.code}): ${String(imported.stderr).replace(/[A-Za-z0-9_.~+/=-]{24,}/g, "***").replace(/\s+/g, " ").trim().slice(0, 160)}`)
  const after = held()
  if (!after || digest(after) !== digest(entry)) return fail("after the import the evals profile's client id does not match the real profile's")
  return done(`PASS ${id}: the app client was copied to the evals profile (client id digest matches; no user token involved)`, { client_id_digest: digest(entry).slice(0, 12) })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const step = process.argv[2]
  const store = process.env.EVALS_STORE ?? defaultStoreDir()
  const result = copyClient({ step, opencode: process.env.OPENCODE_BIN ?? "opencode", profile: process.env.EVALS_PROFILE ?? defaultProfileDir(), store })
  console.log(result.line)
  process.exit(result.ok ? (result.skipped ? 3 : 0) : 1)
}
