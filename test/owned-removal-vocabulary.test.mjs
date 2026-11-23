// Regression for dispatch BLOCKER 6: docker 29.5.2's daemon answers a missing
// NETWORK with `Error response from daemon: network <id> not found`, while the
// harness's removal verification accepted only the CLI's
// `No such (object|container|network): <id>` — so every live invocation reported
// verified_gone=false and the successor gate's check (c) structurally failed. The
// offline fakes emit the old vocabulary, which is why this never failed offline
// (the same live-only class as the log-driver blocker). Both removal-verification
// sites now accept BOTH vocabularies for each object class; any other response
// still refuses — absence of the expected vocabulary is still NOT verified-gone.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cleanupOwned, createResourceScope } from "../src/run/wave-launcher.mjs"
import { main } from "../scripts/run-mem-wave.mjs"
import { WAVE_MODEL } from "../src/run/wave-manifest.mjs"
import { containedFixture, drive, fakeIdentityOwner } from "./support/wave-contained-parent.mjs"

const ID = "a".repeat(64)
const CONTAINER_ID = "c".repeat(64)

// The real daemon's exact captured vocabulary (docker 29.5.2, from the blocker evidence).
const DAEMON_NETWORK = `Error response from daemon: network ${ID} not found`
const DAEMON_CONTAINER = `Error response from daemon: container ${CONTAINER_ID} not found`
const DAEMON_OBJECT = `Error response from daemon: object ${CONTAINER_ID} not found`
// The CLI vocabulary the harness always accepted.
const CLI_OBJECT = `Error: No such object: ${CONTAINER_ID}`
const CLI_NETWORK = `Error: No such network: ${ID}`

test("cleanupOwned verifies BOTH vocabularies for each object class and refuses everything else", async t => {
  const root = mkdtempSync(join(tmpdir(), "removal-vocab-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const scope = createResourceScope(root, { manifestSha: "b".repeat(64), trials: [{ id: "first" }] })
  const receipt = { schema: "oc-evals-owned/1", batch: "b1234567890", owner: { invocation_id: scope.owner.invocation_id, manifest_sha256: scope.owner.manifest_sha256, trial_id: "first" },
    resources: [{ kind: "container", id: CONTAINER_ID, context: "colima-mem-evals-20261122" }, { kind: "network", id: ID, context: "colima-mem-evals-20261122" }], pending: [], uncertain: false, verified_gone: false }
  writeFileSync(join(root, "resources", "first.json"), JSON.stringify(receipt))
  const driveCleanup = (containerStderr, networkStderr) => cleanupOwned(scope, async args => {
    if (args.includes("inspect")) return { code: 1, stdout: "", stderr: args.includes("network") ? networkStderr : containerStderr }
    return { code: 0, stdout: "", stderr: "" }
  }, () => 60000)
  // The daemon's real vocabulary verifies for each object class (red at the parent:
  // the network form never did).
  assert.equal(await driveCleanup(DAEMON_CONTAINER, DAEMON_NETWORK), true, "the daemon's absence vocabulary verifies for both classes")
  // The CLI vocabulary still verifies.
  assert.equal(await driveCleanup(CLI_OBJECT, CLI_NETWORK), true, "the CLI's absence vocabulary verifies for both classes")
  assert.equal(await driveCleanup(DAEMON_OBJECT, DAEMON_NETWORK), true, "the daemon's object form verifies")
  // Anything else still refuses: fail-closed unchanged. (The CLI branch's loose
  // `no such` acceptance is the reviewed existing semantics, pinned by the launcher
  // suite — it is not tightened here.)
  for (const [containerStderr, networkStderr] of [
    ["", ""],
    [`Error response from daemon: container ${"e".repeat(64)} not found`, DAEMON_NETWORK],
    [DAEMON_CONTAINER, `Error response from daemon: network ${"e".repeat(64)} not found`],
    [DAEMON_CONTAINER, "Error response from daemon: something unrelated"],
    [DAEMON_CONTAINER, `network ${ID} found`],
  ]) {
    assert.equal(await driveCleanup(containerStderr, networkStderr), false, `unexpected stderr still refuses: ${JSON.stringify([containerStderr, networkStderr])}`)
  }
})

test("containTrial's removal verification accepts the daemon's network vocabulary end to end", async t => {
  const root = mkdtempSync(join(tmpdir(), "removal-contained-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const wave = { id: "owned", harness_sha: "a".repeat(40), control: join(root, "control"), store: join(root, "store"), docker_config: join(root, "docker"),
    model: WAVE_MODEL, trial_timeout_s: 3480, caps: { path: join(root, "caps.json") }, runtime: { docker: { path: "/pinned/docker" }, image: `sha256:${"b".repeat(64)}` },
    trials: ["first", "second"].map(id => ({ id, case: "core-a", arm: "baseline", condition: "direct" })) }
  mkdirSync(wave.docker_config)
  writeFileSync(wave.caps.path, JSON.stringify({ estimate_run_usd: { [WAVE_MODEL]: { wide: 0.1 } } }))
  const file = join(root, "manifest.json")
  writeFileSync(file, JSON.stringify(wave))
  // The live-faithful combination the blocker captured: containers answer with the
  // CLI vocabulary (which always matched), networks answer with the daemon's real
  // `Error response from daemon: network <id> not found`.
  const x = containedFixture({ root, wave, file }, { reply: ({ a, r, settle }) => {
    if (a[0] === "network" && a[1] === "inspect" && r.code === 1 && /No such/i.test(r.stderr ?? "")) {
      settle({ ...r, stderr: `Error response from daemon: network ${a.at(-1)} not found` })
      return
    }
    settle(r)
  } })
  const options = {
    env: { OPENCODE_API_KEY: "synthetic-test-key" }, identity: () => ({}),
    qualify: () => ({ execution_qualified: true, plan: { cases: [{ id: "core-a", set: "core", tier: "wide" }] } }),
    adapter: { supervisionAvailable: true, owned: x.owned, worker: () => assert.fail("host worker forbidden"), trial: () => assert.fail("host CLI forbidden"), signal: () => assert.fail("host signal forbidden") },
    clock: x.c,
    nativeQualification: () => Promise.resolve({ matched: true, identityOwner: fakeIdentityOwner(), profile: { os_profile: { platform: "darwin", arch: "arm64", version: "26.7.1", build: "25G241", sdk: "26.5" } } }),
    ownedCapability: () => x.owned,
  }
  await drive(main(["--manifest", file], options), x.c)
  assert.equal(x.journal().verified_gone, true, "the daemon's network vocabulary verifies removal")
  assert.equal(x.resources.size, 0)
})
