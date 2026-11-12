// The host versions T1 covers, and where their stock binaries are found on each platform.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { TESTED, stockBinary, availableVersions, platformPackages } from "../src/t1/harness.mjs"
import { coverageTable } from "../src/t1/run.mjs"

const install = (dir, version, pkg) => {
  const bin = join(dir, version, "node_modules", "@opencode", pkg, "bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, "opencode"), "#!/bin/sh\n")
  return join(bin, "opencode")
}

test("the tested hosts are the plugins' own: 2.2.3 to 2.2.6", () => {
  assert.deepEqual(TESTED, ["2.2.3", "2.2.4", "2.2.5", "2.2.6"])
  assert.deepEqual(coverageTable([]).versions, TESTED)
})

test("the platform package is the one npm installs for this machine, best build first", () => {
  assert.deepEqual(platformPackages({ platform: "darwin", arch: "arm64", musl: false }), ["cli-darwin-arm64", "cli-darwin-arm64-baseline"])
  assert.deepEqual(platformPackages({ platform: "linux", arch: "x64", musl: false }), ["cli-linux-x64", "cli-linux-x64-baseline"])
  assert.deepEqual(platformPackages({ platform: "linux", arch: "x64", musl: true }), ["cli-linux-x64-musl", "cli-linux-x64-baseline-musl"])
  assert.deepEqual(platformPackages({ platform: "linux", arch: "arm64", musl: false }), ["cli-linux-arm64", "cli-linux-arm64-baseline"])
})

test("a Linux install with all four optional packages resolves to the glibc build, or the musl one on musl", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-stock-"))
  const glibc = install(dir, "2.2.6", "cli-linux-x64")
  install(dir, "2.2.6", "cli-linux-x64-baseline")
  const musl = install(dir, "2.2.6", "cli-linux-x64-musl")
  install(dir, "2.2.6", "cli-linux-x64-baseline-musl")
  const env = { EVALS_STOCK_DIR: dir }
  assert.equal(stockBinary("2.2.6", { env, platform: "linux", arch: "x64", musl: false }), glibc)
  assert.equal(stockBinary("2.2.6", { env, platform: "linux", arch: "x64", musl: true }), musl)
  assert.equal(stockBinary("2.2.6", { env, platform: "darwin", arch: "arm64" }), null, "no darwin build in this install")
  rmSync(dir, { recursive: true, force: true })
})

test("a baseline-only install is still found, and OPENCODE_BIN_<version> wins over the directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-stock-"))
  const baseline = install(dir, "2.2.5", "cli-linux-x64-baseline")
  const darwin = install(dir, "2.2.3", "cli-darwin-arm64")
  const explicit = join(dir, "explicit-opencode")
  writeFileSync(explicit, "#!/bin/sh\n")
  const target = { platform: "linux", arch: "x64", musl: false }
  assert.equal(stockBinary("2.2.5", { env: { EVALS_STOCK_DIR: dir }, ...target }), baseline)
  assert.equal(stockBinary("2.2.5", { env: { EVALS_STOCK_DIR: dir, OPENCODE_BIN_2_2_5: explicit }, ...target }), explicit)
  assert.equal(stockBinary("2.2.3", { env: { EVALS_STOCK_DIR: dir }, platform: "darwin", arch: "arm64" }), darwin)
  assert.deepEqual(availableVersions({ env: { EVALS_STOCK_DIR: dir, OPENCODE_BIN_2_2_6: explicit }, ...target }), ["2.2.5", "2.2.6"])
  assert.equal(stockBinary("2.2.6", { env: {} }), null, "nothing configured is nothing found: no path is guessed")
  rmSync(dir, { recursive: true, force: true })
})
