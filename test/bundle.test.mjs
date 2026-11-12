// A bundle is graded only if it is built from the tracked tree. Metaview's git-ignored `dist/` was a day
// behind its declaration and T1 graded it as if it were the plugin.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { bundleFor, trackedTime } from "../src/t1/bundle.mjs"

// Every directory a test makes, the checkout and the build beside it, is removed however the test ends.
const made = []
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})
const buildDir = (dir, suffix) => {
  const path = join(dir, "..", `${dir.split("/").pop()}-${suffix}`)
  made.push(path)
  return path
}

function repo({ build = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "evals-bundle-"))
  made.push(dir)
  const write = (path, body) => {
    mkdirSync(join(dir, path, ".."), { recursive: true })
    writeFileSync(join(dir, path), body)
  }
  write("package.json", JSON.stringify({ name: "demo", version: "0.0.0" }))
  write("src/index.ts", "export default { id: 'demo' }\n")
  write("dist/index.js", "// old bundle\n")
  if (build) {
    write(
      "scripts/build.mjs",
      `import { writeFileSync, mkdirSync } from "node:fs"\nmkdirSync("dist", { recursive: true })\nwriteFileSync("dist/index.js", "// built from HEAD\\n")\n`,
    )
  }
  execFileSync("git", ["init", "-q", dir])
  execFileSync("git", ["-C", dir, "-c", "user.email=e@e", "-c", "user.name=e", "add", "-A"])
  execFileSync("git", ["-C", dir, "-c", "user.email=e@e", "-c", "user.name=e", "commit", "-qm", "init"])
  return dir
}

const age = (path, seconds) => {
  const when = new Date(Date.now() - seconds * 1000)
  utimesSync(path, when, when)
}

test("a bundle older than the tracked tree is rebuilt from HEAD, and the checkout is untouched", () => {
  const dir = repo()
  const before = statSync(join(dir, "dist", "index.js")).mtimeMs
  age(join(dir, "dist", "index.js"), 3600)
  const built = bundleFor(dir, buildDir(dir, "build"))
  assert.equal(built.ok, true, built.why)
  assert.equal(built.built, true)
  assert.equal(built.stale.stale, true)
  assert.match(execFileSync("cat", [join(built.dir, "dist", "index.js")], { encoding: "utf8" }), /built from HEAD/)
  assert.equal(statSync(join(dir, "dist", "index.js")).mtimeMs < before, true, "the checkout's dist was not written")
  rmSync(dir, { recursive: true, force: true })
})

test("a fresh bundle is used as it is", () => {
  const dir = repo()
  const future = new Date(Date.now() + 60_000)
  utimesSync(join(dir, "dist", "index.js"), future, future)
  const used = bundleFor(dir, buildDir(dir, "build2"))
  assert.equal(used.ok, true)
  assert.equal(used.built, false)
  assert.equal(used.dir, dir)
  rmSync(dir, { recursive: true, force: true })
})

test("a stale bundle that cannot be rebuilt is refused, never graded", () => {
  const dir = repo({ build: false })
  age(join(dir, "dist", "index.js"), 3600)
  const refused = bundleFor(dir, buildDir(dir, "build3"))
  assert.equal(refused.ok, false)
  assert.match(refused.why, /older than the tracked tree/)
  rmSync(dir, { recursive: true, force: true })
})

test("a repo with no dist is refused", () => {
  const dir = repo()
  rmSync(join(dir, "dist"), { recursive: true, force: true })
  const refused = bundleFor(dir, buildDir(dir, "build4"))
  assert.equal(refused.ok, false)
  assert.match(refused.why, /no dist/)
  rmSync(dir, { recursive: true, force: true })
})

test("the tracked time follows the newest source file", () => {
  const dir = repo()
  const older = trackedTime(dir).time
  const later = new Date(Date.now() + 120_000)
  utimesSync(join(dir, "src", "index.ts"), later, later)
  assert.ok(trackedTime(dir).time > older)
  rmSync(dir, { recursive: true, force: true })
})
