#!/usr/bin/env node
// write-config.mjs <profile dir>: writes the evals profile's opencode.json: the claude-agent deny and the pinned plugins of
// $EVALS_STORE/evals-plugins.json (EVALS_PLUGINS overrides). Called by evals-profile.sh on every run.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadPins, profileConfig } from "./profile-lib.mjs"

const dir = process.argv[2]
if (!dir) {
  console.error("usage: write-config.mjs <profile dir>")
  process.exit(2)
}
try {
  const config = profileConfig(loadPins(process.env))
  mkdirSync(join(dir, ".config", "opencode"), { recursive: true, mode: 0o700 })
  writeFileSync(join(dir, ".config", "opencode", "opencode.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
} catch (error) {
  console.error(`evals-profile: ${error.message}`)
  process.exit(1)
}
