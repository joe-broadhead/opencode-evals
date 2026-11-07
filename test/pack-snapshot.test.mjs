// The CI path: committed pack snapshots verified with no plugin checkout anywhere.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { packDigest, verifySnapshot, verifyFromRepo, snapshotChecks, driftReport, recomputeCounts, PACK_IDS, PACK_SCHEMA } from "../src/pack/snapshot.mjs"
import { derivePack, pluginRepo, repoAvailable, readPack, packIds } from "../src/pack/from-plugin.mjs"
import { checkPack } from "../src/t0/generic.mjs"

const ROOT = join(import.meta.dirname, "..")
const temp = () => mkdtempSync(join(tmpdir(), "evals-pack-"))

const snapshot = (over = {}) => {
  const base = {
    schema: PACK_SCHEMA,
    id: "demo",
    name: "Demo",
    pluginId: "demo.one",
    rpc: "demo.one.tools",
    version: "0.0.0",
    skills: ["demo", "demo-write"],
    skill_meta: {
      demo: { name: "demo", description_sha256: "a".repeat(64), description_chars: 120, body_lines: 20 },
      "demo-write": { name: "demo-write", description_sha256: "b".repeat(64), description_chars: 90, body_lines: 12 },
    },
    tools: [
      { name: "get_one", permission: "demo_get_one", effect: "allow", readOnly: true, class: "read" },
      { name: "create_one", permission: "demo_create_one", effect: "ask", readOnly: false, class: "write" },
      { name: "delete_one", permission: "demo_delete_one", effect: "deny", readOnly: false, class: "destructive" },
    ],
    t1: [{ kind: "asked", tool: "create_one", args: { text: "x" } }],
    ...over,
  }
  base.counts = recomputeCounts(base)
  return { ...base, digest: packDigest(base) }
}

test("a well-formed snapshot verifies with no checkout at all", () => {
  const pack = snapshot()
  const result = verifySnapshot(pack, { id: "demo" })
  assert.equal(result.ok, true, result.problems.join("; "))
  assert.equal(result.checks.length, 9)
})

test("each defect is caught by the check that owns it", () => {
  const drift = snapshot()
  drift.counts = { ...drift.counts, tools: 99 }
  assert.match(verifySnapshot(drift).problems.join(" "), /P-05/)

  const tampered = snapshot()
  tampered.tools = [...tampered.tools, { name: "extra", permission: "demo_extra", effect: "allow", readOnly: true, class: "read" }]
  assert.match(verifySnapshot(tampered).problems.join(" "), /P-06/, "the digest no longer matches the content")

  const doubled = snapshot()
  doubled.tools = doubled.tools.map((tool) => ({ ...tool, permission: "demo_same" }))
  doubled.counts = recomputeCounts(doubled)
  doubled.digest = packDigest({ ...doubled, digest: undefined })
  assert.match(verifySnapshot(doubled).problems.join(" "), /P-03/)

  const deniedRead = snapshot()
  deniedRead.tools = deniedRead.tools.map((tool) => (tool.effect === "deny" ? { ...tool, class: "read" } : tool))
  deniedRead.counts = recomputeCounts(deniedRead)
  deniedRead.digest = packDigest({ ...deniedRead, digest: undefined })
  assert.match(verifySnapshot(deniedRead).problems.join(" "), /P-04/)

  const noMeta = snapshot()
  delete noMeta.skill_meta
  noMeta.digest = packDigest({ ...noMeta, digest: undefined })
  assert.match(verifySnapshot(noMeta).problems.join(" "), /P-07/)

  const badCase = snapshot()
  badCase.t1 = [{ kind: "shrugged", tool: "nope" }]
  badCase.digest = packDigest({ ...badCase, digest: undefined })
  assert.match(verifySnapshot(badCase).problems.join(" "), /P-08/)
})

test("a snapshot is read from packs/ and verified against its file name", () => {
  const root = temp()
  const pack = snapshot()
  mkdirSync(join(root, "packs", "demo"), { recursive: true })
  writeFileSync(join(root, "packs", "demo", "pack.json"), JSON.stringify(pack))
  assert.equal(verifyFromRepo("demo", root).ok, true)
  assert.equal(verifyFromRepo("other", root).ok, false, "a missing snapshot is a failure, not a skip")
  writeFileSync(join(root, "packs", "demo", "pack.json"), JSON.stringify({ ...pack, id: "renamed" }))
  assert.match(verifyFromRepo("demo", root).problems.join(" "), /the file is demo/)
  rmSync(root, { recursive: true, force: true })
})

test("drift is reported, never applied", () => {
  const committed = snapshot()
  const live = {
    ...committed,
    tools: [
      { ...committed.tools[0], effect: "ask" },
      { ...committed.tools[1], class: "read" },
      { name: "new_one", permission: "demo_new_one", effect: "allow", readOnly: true, class: "read" },
    ],
    skill_meta: { ...committed.skill_meta, demo: { ...committed.skill_meta.demo, description_sha256: "c".repeat(64) } },
    version: "0.0.1",
  }
  delete live.digest
  const report = driftReport(live, committed)
  assert.equal(report.drift, true)
  assert.deepEqual(report.added, ["new_one"])
  assert.deepEqual(report.removed, ["delete_one"])
  assert.ok(report.changed.some((line) => line.startsWith("get_one.effect")))
  assert.ok(report.changed.some((line) => line.startsWith("create_one.class")))
  assert.equal(report.skillChanged.length, 1)
  assert.ok(report.meta.some((line) => line.startsWith("version")))

  const same = driftReport({ ...committed }, committed)
  assert.equal(same.drift, false)
})

test("no checkout is not an error: the snapshot is the pack", () => {
  const env = {}
  assert.equal(pluginRepo("x", env), null)
  assert.equal(repoAvailable("x", env), false)
  const pack = readPack("x", ROOT, env)
  assert.ok(pack.tools.length > 0)
  assert.equal(pack.live, undefined, "nothing is derived without a checkout")
  const t0 = checkPack(pack, null)
  assert.equal(t0.source, "snapshot")
  assert.equal(t0.failed, 0)
})

test("a per-plugin root wins over a shared root, and neither guesses a home directory", () => {
  assert.equal(pluginRepo("x", { EVALS_PLUGIN_ROOT: "/tmp/checkouts" }), "/tmp/checkouts/opencode-x")
  assert.equal(pluginRepo("x", { EVALS_PLUGIN_ROOT: "/tmp/checkouts", EVALS_REPO_X: "/tmp/elsewhere" }), "/tmp/elsewhere")
  assert.equal(pluginRepo("x", { HOME: "/home/someone" }), null)
})

test("every committed snapshot verifies — the assertion CI makes", () => {
  const ids = packIds(ROOT)
  assert.ok(ids.length >= 9, `expected the nine packs, found ${ids.join(",")}`)
  for (const id of ids) {
    const result = verifyFromRepo(id, ROOT)
    assert.equal(result.ok, true, `${id}: ${result.problems.join("; ")}`)
  }
  assert.deepEqual([...ids].sort(), [...PACK_IDS].sort())
})

test("the committed snapshots carry no checkout path", () => {
  for (const id of packIds(ROOT)) {
    const text = readFileSync(join(ROOT, "packs", id, "pack.json"), "utf8")
    assert.doesNotMatch(text, /\/Users\/|\/home\/|\/private\//, `${id} carries a path`)
  }
})
