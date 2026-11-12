// The CI path: committed pack snapshots verified with no plugin checkout anywhere.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { packDigest, verifySnapshot, verifyFromRepo, snapshotChecks, driftReport, recomputeCounts, PACK_SCHEMA } from "../src/pack/snapshot.mjs"
import { derivePack, pluginRepo, repoAvailable, readPack, packIds, discoverPlugins, familyProblems, allPackIds } from "../src/pack/from-plugin.mjs"
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
  assert.ok(report.meta.includes('version: "0.0.0" -> "0.0.1"'), "old -> new, like the tool changes")

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
  assert.ok(ids.length >= 22, `expected the family's 22 packs, found ${ids.join(",")}`)
  for (const id of ids) {
    const result = verifyFromRepo(id, ROOT)
    assert.equal(result.ok, true, `${id}: ${result.problems.join("; ")}`)
  }
  for (const id of ["x", "notion", "jira", "ashby", "affinity", "metaview", "wisprflow", "granola", "linear", "history"]) assert.ok(ids.includes(id), id)
  // Every snapshot records the family's access option, and its declared effects are the default's: all allow.
  for (const id of ids) {
    const pack = JSON.parse(readFileSync(join(ROOT, "packs", id, "pack.json"), "utf8"))
    assert.equal(pack.access?.default, "all", `${id} access`)
  }
})

const checkout = (root, name, jelly, source = 'export const PLUGIN_ID = "' + name + '.thing"\n') => {
  const dir = join(root, `opencode-${name}`)
  mkdirSync(join(dir, "src"), { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `@demo/opencode-${name}`, version: "0.0.1", jelly }))
  writeFileSync(join(dir, "src", "constants.ts"), source)
  return dir
}

test("packs are discovered from any plugin checkout, and a checkout that is not a family plugin is named, not packed", () => {
  const root = temp()
  const access = { contributes: { settings: [{ key: "access", default: "all" }] } }
  checkout(root, "alpha", { tools: [{ name: "alpha.get", permission: "alpha_get", effect: "allow", readOnly: true }, { name: "alpha.put", permission: "alpha_put", effect: "allow", readOnly: false }], skills: [], ...access })
  checkout(root, "library", { tools: [] })
  checkout(root, "shared", { tools: [{ name: "shared.a", permission: "shared.read", readOnly: true }, { name: "shared.b", permission: "shared.read", readOnly: true }] })
  mkdirSync(join(root, "opencode-empty"))
  mkdirSync(join(root, "not-a-plugin"))
  const env = { EVALS_PLUGIN_ROOT: root }
  assert.deepEqual(discoverPlugins(env), ["alpha", "shared"], "no tools is no plugin; a folder without package.json is skipped")
  const alpha = derivePack("alpha", pluginRepo("alpha", env))
  assert.deepEqual(alpha.access, { key: "access", default: "all" })
  assert.deepEqual(alpha.tools.map((tool) => [tool.name, tool.effect, tool.class]), [["get", "allow", "read"], ["put", "allow", "write"]])
  assert.deepEqual(familyProblems(alpha), [])
  assert.match(familyProblems(derivePack("shared", pluginRepo("shared", env))).join(" "), /P-03/)
  assert.ok(allPackIds(ROOT, env).includes("alpha") && allPackIds(ROOT, env).includes("x"))
  assert.deepEqual(discoverPlugins({ EVALS_REPO_BETA: join(root, "opencode-alpha") }), ["beta"])
  rmSync(root, { recursive: true, force: true })
})

test("the committed snapshots carry no checkout path", () => {
  for (const id of packIds(ROOT)) {
    const text = readFileSync(join(ROOT, "packs", id, "pack.json"), "utf8")
    assert.doesNotMatch(text, /\/Users\/|\/home\/|\/private\//, `${id} carries a path`)
  }
})

test("evals pack names the packs that differ, and never counts a checkout that is not a family plugin", async () => {
  const { spawnSync } = await import("node:child_process")
  const root = temp()
  checkout(root, "alpha", { tools: [{ name: "alpha.get", permission: "alpha_get", effect: "allow", readOnly: true }], skills: [] })
  checkout(root, "shared", { tools: [{ name: "shared.a", permission: "shared.read", readOnly: true }, { name: "shared.b", permission: "shared.read", readOnly: true }] })
  const out = spawnSync(process.execPath, [join(ROOT, "bin", "evals"), "pack"], { encoding: "utf8", env: { PATH: process.env.PATH, EVALS_PLUGIN_ROOT: root } })
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /shared\s+skipped: not a family plugin/)
  assert.match(out.stdout, /alpha\s+no snapshot/)
  assert.match(out.stdout, /1 pack\(s\) differ from their checkout \(alpha\)/)
  rmSync(root, { recursive: true, force: true })
})
