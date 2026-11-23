// Explicit inner bootstrap. Not the wave worker; no IPC, Docker or successor-launching capability.
import { readFileSync, mkdirSync, copyFileSync } from "node:fs"
import { join } from "node:path"
import { runContainedEntry } from "../src/run/owned-entry.mjs"
import { ownedMountLayout } from "../src/run/owned-launch.mjs"
import { createOwnedSink } from "../src/run/owned-io.mjs"

async function main() {
  if (process.platform !== "linux" || process.stdin.isTTY) throw new Error("parent bootstrap required")
  const chunks = []; let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > 65536) throw new Error("descriptor limit")
    chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks)
  const descriptor = JSON.parse(bytes.toString("utf8"))
  const observation = { platform: process.platform, mounts: ownedMountLayout(readFileSync("/proc/self/mountinfo", "utf8")), password: process.env.OPENCODE_PASSWORD }
  await runContainedEntry(bytes, { observation, caller: process.env, sink: createOwnedSink("/work"), prepare: () => {
    for (const path of ["/work/home", "/work/tmp", "/work/store"]) mkdirSync(path, { mode: 0o700 })
    // A commit-set trial resolves its plan's @aliases against $EVALS_STORE/targets.json.
    // The descriptor's commitPlan pin names the reviewed plan at /inputs/commit-plan.json
    // and the staged inputs tree carries the pinned seed at /inputs/targets.json
    // (hash-bound by the manifest pin and the tree digest). No plan, no seed; the
    // pinned plan with a missing seed refuses fail-closed — no fallback resolution.
    if (descriptor?.options?.commitPlan !== undefined) copyFileSync("/inputs/targets.json", join("/work/store", "targets.json"))
  } })
  // Provisional execution is not a qualified success, even when native CLI exit was zero.
  process.exitCode = 1
}
main().catch(() => { process.stderr.write("contained trial refused or incomplete\n"); process.exitCode = 1 })
