#!/usr/bin/env node
// ensure-port.mjs <profile dir> [<opencode binary>]: gives the evals profile its own service port (47950 or the next free one) so
// it never contends with the owner's real service. Called by evals-profile.sh before it runs anything in the profile.
import { ensureServicePort } from "../../src/run/service-port.mjs"
import { profileEnv, realEnv } from "./profile-lib.mjs"

const [dir, opencode = process.env.OPENCODE_BIN ?? "opencode"] = process.argv.slice(2)
if (!dir) {
  console.error("usage: ensure-port.mjs <profile dir> [<opencode binary>]")
  process.exit(2)
}
try {
  const out = ensureServicePort({ opencode, profileEnv: profileEnv(dir), realEnv: realEnv() })
  console.error(`evals-profile: service port ${out.port}${out.changed ? " (set)" : ""}; the real service is on ${out.real}`)
} catch (error) {
  console.error(`evals-profile: ${error.message}`)
  process.exit(1)
}
