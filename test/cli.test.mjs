// The CLI never does more than it was asked: no plugin is assumed for compile, and --help runs nothing.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync, execFileSync } from "node:child_process"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const evals = (...args) => spawnSync(process.execPath, [join(ROOT, "bin", "evals"), ...args], { encoding: "utf8", cwd: ROOT })
const tracked = () => execFileSync("git", ["-C", ROOT, "status", "--porcelain", "--", "cases"], { encoding: "utf8" })

test("compile without --plugin or --all is refused, and --help on it prints the usage and writes nothing", () => {
  const before = tracked()
  const bare = evals("compile")
  assert.notEqual(bare.status, 0)
  assert.match(bare.stderr, /--plugin <id>, or --all/)
  const help = evals("compile", "--help")
  assert.equal(help.status, 0)
  assert.match(help.stdout, /evals compile\s+--plugin x \| --all/)
  assert.equal(tracked(), before, "nothing under cases/ was touched")
})

test("every committed case JSON is what its markdown compiles to (the CI check)", () => {
  const check = evals("compile", "--all", "--check")
  assert.equal(check.status, 0, check.stdout)
  assert.doesNotMatch(check.stdout, /stale/)
})

test("an unknown command is an error, not the README", () => {
  const out = evals("frobnicate")
  assert.equal(out.status, 2)
  assert.match(out.stdout, /unknown command "frobnicate"/)
})
