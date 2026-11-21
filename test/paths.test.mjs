// A case id, an iteration or a plugin id never escapes the store or the sandbox.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { segment, inside, within, isSegment, real, LINK_BUDGET } from "../src/run/paths.mjs"
import { stripForeignLinks, makeSandbox, writeConfig, removeInside } from "../src/run/sandbox.mjs"
import { casesIn, pluginCases } from "../src/case/load.mjs"
import { runBatch } from "../src/run/runner.mjs"

const BIN = join(import.meta.dirname, "..", "bin", "evals")
const temp = () => mkdtempSync(join(tmpdir(), "evals-paths-"))
const published = () => JSON.parse(readFileSync(join(import.meta.dirname, "..", "cases", "x", "small-bounded-search.json"), "utf8"))

test("a segment is one name, never a path", () => {
  for (const good of ["nx6", "v1-a", "A-v000-t1", "history", "case.t2"]) assert.equal(isSegment(good), true, good)
  for (const bad of ["../x", "a/b", "..", "a..b", "/abs", "", ".hidden", "x\\y", "a b"]) assert.equal(isSegment(bad), false, bad)
  assert.throws(() => segment("--iteration", "../../etc"), /not a safe name/)
  assert.equal(inside("/tmp/root", "/tmp/root/a/b"), true)
  assert.equal(inside("/tmp/root", "/tmp/root-other/a"), false)
  assert.equal(inside("/tmp/root", "/tmp/root/../x"), false)
  assert.throws(() => within("/tmp/root", "/tmp/elsewhere", "a recording"), /refusing to touch a recording/)
})

test("a compiled case whose id is a path, or is not its file's name, is refused when it is loaded", () => {
  const dir = temp()
  writeFileSync(join(dir, "escape.json"), JSON.stringify({ ...published(), id: "../../../../ESCAPED" }))
  assert.throws(() => casesIn(dir), /case id "..\/..\/..\/..\/ESCAPED" must be lower-case words/)
  rmSync(join(dir, "escape.json"))
  writeFileSync(join(dir, "other-name.json"), JSON.stringify(published()))
  assert.throws(() => casesIn(dir), /the case id is "small-bounded-search", the file is other-name.json/)
  rmSync(dir, { recursive: true, force: true })
})

test("a private holdout named ../../ESCAPED reaches no path: the run is refused before anything is written", async () => {
  const root = temp()
  const store = join(root, "store")
  const holdouts = join(store, "holdouts", "x")
  mkdirSync(holdouts, { recursive: true })
  writeFileSync(join(holdouts, "escaped.json"), JSON.stringify({ ...published(), id: "../../../../ESCAPED" }))
  const caller = { PATH: process.env.PATH, HOME: root, EVALS_STORE: store, EVALS_TMP: join(root, "tmp"), EVALS_OPENCODE_BIN: "/nonexistent" }
  assert.throws(() => pluginCases("x", { env: caller }), /must be lower-case words/)
  await assert.rejects(runBatch({ plugin: "x", iteration: "it", model: "mock/m1", auth: "none", set: "all", arm: "none" }, { caller, log: () => {} }), /must be lower-case words/)
  assert.deepEqual(readdirSync(root).sort(), ["store"], "no ESCAPED, no tmp, no raw")
  rmSync(root, { recursive: true, force: true })
})

test("an iteration or a plugin that is a path is refused by the runner and by every command", async () => {
  const root = temp()
  const caller = { PATH: process.env.PATH, EVALS_STORE: join(root, "store") }
  await assert.rejects(runBatch({ plugin: "x", iteration: "../../out", model: "m", auth: "none" }, { caller, log: () => {} }), /--iteration "..\/..\/out" is not a safe name/)
  await assert.rejects(runBatch({ plugin: "../x", iteration: "it", model: "m", auth: "none" }, { caller, log: () => {} }), /--plugin/)
  for (const args of [["grade", "--iteration", "../../out", "--plugin", "x"], ["trace", "--iteration", "a/b"], ["scorecard", "--iteration", "..", "--plugin", "x"], ["policy", "--a", "../a", "--b", "b"], ["report", "a=../x"]]) {
    const out = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: caller })
    assert.notEqual(out.status, 0, args.join(" "))
    assert.match(out.stderr, /is not a safe name/, args.join(" "))
  }
  assert.equal(existsSync(join(root, "out")), false)
  rmSync(root, { recursive: true, force: true })
})

test("containment compares real paths: a link inside a root that points out of it is outside", async () => {
  const { symlinkSync } = await import("node:fs")
  const root = temp()
  const outside = temp()
  mkdirSync(join(root, "in"))
  symlinkSync(outside, join(root, "out"))
  assert.equal(inside(root, join(root, "in", "file")), true)
  assert.equal(inside(root, join(root, "out", "file")), false, "through a link that leaves the root")
  assert.throws(() => within(root, join(root, "out", "new", "file"), "a recording"), /outside/)
  // A root reached through a link is compared by where it really is.
  symlinkSync(root, join(outside, "alias"))
  assert.equal(inside(join(outside, "alias"), join(root, "in")), true)
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

test("a dangling link counts as inside only when where it points is inside; a loop is never inside", async () => {
  const { symlinkSync } = await import("node:fs")
  const root = mkdtempSync(join(tmpdir(), "evals-dangling-"))
  const box = join(root, "box")
  mkdirSync(box)
  // A leaf link whose target does not exist (yet): `existsSync` says it is not there at all.
  symlinkSync(join(root, "outside", "later.txt"), join(box, "out-dangling"))
  symlinkSync(join(box, "not-yet.txt"), join(box, "in-dangling"))
  symlinkSync("relative-loop-b", join(box, "relative-loop-a"))
  symlinkSync("relative-loop-a", join(box, "relative-loop-b"))
  symlinkSync(join(root, "outside"), join(box, "out-dir-dangling"))
  assert.equal(existsSync(join(box, "out-dangling")), false, "the premise: existsSync follows the link")
  assert.equal(inside(box, join(box, "out-dangling")), false)
  assert.throws(() => within(box, join(box, "out-dangling"), "the file"), /outside/)
  assert.equal(inside(box, join(box, "out-dir-dangling", "deeper", "file")), false, "a path under a dangling link out")
  assert.equal(inside(box, join(box, "in-dangling")), true, "a dangling link that points inside is inside")
  assert.equal(inside(box, join(box, "relative-loop-a")), false, "a link loop resolves nowhere")
  assert.equal(inside(box, join(box, "plain", "new.txt")), true)
  rmSync(root, { recursive: true, force: true })
})

test("stripForeignLinks removes a link chain that only looks inside the sandbox lexically", () => {
  const base = temp()
  const root = join(base, "runs", "case.t1")
  const cache = join(root, "home", ".cache")
  mkdirSync(cache, { recursive: true })
  const outside = join(base, "outside")
  mkdirSync(outside)
  writeFileSync(join(outside, "marker"), "untouched")
  // Lexically `../..` from .cache is the sandbox root. The kernel knows `hop` is the root, so `opencode-x` resolves
  // three levels above it, outside; JS realpathSync collapsed the `..` and said inside.
  symlinkSync("../..", join(cache, "hop"))
  symlinkSync("hop/../../..", join(cache, "opencode-x"))
  symlinkSync(join(cache, "hop"), join(root, "home", ".inside"))
  const removed = stripForeignLinks({ root })
  assert.deepEqual(removed, ["home/.cache/opencode-x"])
  assert.equal(existsSync(join(cache, "opencode-x")), false, "the chain is removed")
  assert.equal(existsSync(join(cache, "hop")), true, "a link to the root itself is inside")
  assert.equal(existsSync(join(root, "home", ".inside")), true, "a link that resolves inside through another is kept")
  assert.equal(readFileSync(join(outside, "marker"), "utf8"), "untouched")
  rmSync(base, { recursive: true, force: true })
})

test("a dangling link chain cannot aim a harness write outside the sandbox", () => {
  const base = temp()
  const sandbox = makeSandbox(join(base, "runs", "case.t1"))
  const dir = join(sandbox.home, ".config", "opencode")
  // `hop` is the home; the target then climbs three levels above it. `PLANTED` does not exist, which the old lexical
  // resolution mistook for an inside path.
  symlinkSync("../..", join(dir, "hop"))
  symlinkSync("hop/../../../PLANTED", join(dir, "opencode.json"))
  assert.equal(inside(sandbox.root, join(dir, "opencode.json")), false, "the chain resolves outside, a missing target included")
  assert.deepEqual(stripForeignLinks(sandbox), ["home/.config/opencode/opencode.json"])
  writeConfig(sandbox, { plugin: ["x"] })
  assert.equal(existsSync(join(base, "PLANTED")), false, "nothing outside the root is created")
  assert.equal(JSON.parse(readFileSync(join(dir, "opencode.json"), "utf8")).plugin[0], "x")

  // A link at the destination itself is replaced by the write, never followed.
  const outside = join(base, "outside")
  mkdirSync(outside)
  rmSync(join(dir, "opencode.json"))
  symlinkSync(join(outside, "PLANTED"), join(dir, "opencode.json"))
  writeConfig(sandbox, { plugin: ["y"] })
  assert.equal(existsSync(join(outside, "PLANTED")), false, "the link's target is not created")
  assert.equal(JSON.parse(readFileSync(join(dir, "opencode.json"), "utf8")).plugin[0], "y")
  rmSync(base, { recursive: true, force: true })
})

/** `y0 -> .`, `yi -> y(i-1)/y(i-1)`: resolving yN takes about 2^N link follows; the kernel stops at 40. */
function expensiveChain(root, n) {
  const dir = join(root, "chaos")
  mkdirSync(dir)
  symlinkSync(".", join(dir, "y0"))
  for (let i = 1; i <= n; i++) symlinkSync(`y${i - 1}/y${i - 1}`, join(dir, `y${i}`))
  symlinkSync(join(dir, `y${n}`), join(root, "home"))
  return dir
}

test("an expensive link chain is outside, and fast, at the kernel's limit", () => {
  for (const n of [20, 40]) {
    const root = temp()
    try {
      expensiveChain(root, n)
      const target = join(root, "home", ".claude")
      const started = Date.now()
      assert.equal(inside(root, target), false, `N=${n} is outside`)
      const elapsed = Date.now() - started
      assert.ok(elapsed < 100, `N=${n} resolves in under 100 ms (${elapsed} ms)`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test("one shared budget bounds a resolution the kernel cannot do whole", () => {
  const root = temp()
  try {
    expensiveChain(root, 6)
    // The missing `nope` stops the kernel before `home`, so the walk resolves the chain itself: a spent budget is
    // outside, and stopping at 40 follows is what keeps it cheap (without the budget this path would take ~2^6 follows
    // — the test observes the counter, not the wall clock).
    const path = `${root}/nope/../home/.claude`
    const budget = { left: LINK_BUDGET, followed: 0 }
    const resolved = real(path, budget)
    assert.equal(budget.followed, LINK_BUDGET, "the walk stops at the shared budget")
    assert.equal(resolved.startsWith(root), false, "a spent budget is outside the root")
    assert.equal(inside(root, path), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a legitimate link chain inside the root still resolves", () => {
  const root = temp()
  try {
    const dir = join(root, "home", "chain")
    mkdirSync(dir, { recursive: true })
    symlinkSync(".", join(dir, "l0"))
    for (let i = 1; i <= 10; i++) symlinkSync(`l${i - 1}`, join(dir, `l${i}`))
    assert.equal(inside(root, join(dir, "l10", "file")), true, "ten links are well inside the budget")
    assert.equal(real(join(dir, "l10", "file")), join(dir, "file"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("the credential cleanup removes .claude in a home holding an expensive chain", () => {
  const base = temp()
  try {
    const sandbox = makeSandbox(join(base, "runs", "case.t1"))
    expensiveChain(sandbox.home, 8)
    mkdirSync(join(sandbox.home, ".claude"))
    const file = join(sandbox.home, ".claude", ".credentials.json")
    writeFileSync(file, "{}")
    assert.equal(removeInside(sandbox.root, file, { gone: true }), true)
    assert.equal(existsSync(file), false, "a chain elsewhere in the home does not stop the credential removal")
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
