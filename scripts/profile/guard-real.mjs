#!/usr/bin/env node
// guard-real: exits 1 with a FAIL line while a real background service runs (an `opencode serve --service` with the owner's HOME), or anything
// listens on its port. Read from /proc: it runs no opencode command, which could start one. signin.sh runs it before each vendor.
import { realServiceProblem } from "./profile-lib.mjs"

const problem = realServiceProblem(process.env)
if (problem) {
  console.log(`FAIL guard: ${problem}`)
  process.exit(1)
}
console.log("guard: no real background service, nothing on its port")
