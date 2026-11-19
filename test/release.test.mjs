// A pack from a release tag, not from a checkout's master (EVALS-232 / L5): the version the round installs is what the pack says.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execFileSync, spawnSync } from "node:child_process"
import { readVersions, extractRelease } from "../src/pack/release.mjs"
import { derivePack } from "../src/pack/from-plugin.mjs"
import { recomputeCounts, reachableTools } from "../src/pack/snapshot.mjs"

const git = (dir, ...args) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

function plugin(dir, version, tools, extra = "") {
  mkdirSync(join(dir, "src"), { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@x/opencode-demo", version, jelly: { title: "Demo", tools, skills: [] } }))
  writeFileSync(join(dir, "src", "constants.ts"), `export const PLUGIN_ID = "demo.core"\n${extra}`)
}
const tool = (name, readOnly = true) => ({ name: `demo_${name}`, permission: `demo_${name}`, effect: "allow", readOnly })

test("a release's pack is the tagged source's, whatever master has moved on to", () => {
  const root = mkdtempSync(join(tmpdir(), "evals-release-test-"))
  try {
    const repo = join(root, "opencode-demo")
    mkdirSync(repo)
    git(repo, "init", "-q", "-b", "main")
    plugin(repo, "0.1.0", [tool("list"), tool("create", false)])
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "release")
    git(repo, "tag", "v0.1.0")
    plugin(repo, "0.2.0", [tool("list"), tool("create", false), tool("image", false)])
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "master moves on")
    const into = join(root, "out")
    const dir = extractRelease({ id: "demo", version: "0.1.0", repo, into })
    const pack = derivePack("demo", dir)
    assert.equal(pack.version, "0.1.0")
    assert.deepEqual(pack.tools.map((t) => t.name), ["list", "create"], "master's third tool is not in the release")
    assert.equal(derivePack("demo", repo).tools.length, 3, "while the checkout's own tree has it")
    assert.throws(() => extractRelease({ id: "demo", version: "9.9.9", repo, into }), /tag v9\.9\.9 is not in/)
    assert.throws(() => extractRelease({ id: "demo", version: "0.1.0", repo: join(root, "nowhere"), into }), /no git checkout/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a tool the plugin hides at runtime is declared, marked hidden, and counted apart", () => {
  const root = mkdtempSync(join(tmpdir(), "evals-hidden-test-"))
  try {
    plugin(root, "0.0.1", [tool("list"), tool("sign_out", false)], `export const HIDDEN_TOOLS = ["sign_out"] as const\n`)
    const pack = derivePack("demo", root)
    assert.deepEqual(pack.tools.filter((t) => t.hidden).map((t) => t.name), ["sign_out"])
    assert.equal(pack.counts.hidden, 1)
    assert.equal(pack.counts.tools, 2)
    assert.deepEqual(reachableTools(pack).map((t) => t.name), ["list"])
    assert.equal("hidden" in recomputeCounts({ tools: [{ name: "a", class: "read" }], skills: [] }), false, "a pack with none keeps its counts as they were")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("versions come from a JSON map or the family's [id]=x.y.z lines", () => {
  const root = mkdtempSync(join(tmpdir(), "evals-versions-test-"))
  try {
    writeFileSync(join(root, "v.json"), JSON.stringify({ slack: "v0.0.6", gws: "0.0.10" }))
    assert.deepEqual(readVersions(join(root, "v.json")), { slack: "0.0.6", gws: "0.0.10" })
    writeFileSync(join(root, "up.sh"), "declare -A V=(\n  [history]=0.0.7 [notion]=0.0.5\n  [boxd]=0.1.2\n)\n")
    assert.deepEqual(readVersions(join(root, "up.sh")), { history: "0.0.7", notion: "0.0.5", boxd: "0.1.2" })
    writeFileSync(join(root, "bad.txt"), "nothing here")
    assert.throws(() => readVersions(join(root, "bad.txt")), /holds no/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
