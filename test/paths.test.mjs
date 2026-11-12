// A case id, an iteration or a plugin id never escapes the store or the sandbox.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { segment, inside, within, isSegment } from "../src/run/paths.mjs"
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
