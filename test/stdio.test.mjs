// A command whose output nobody reads ends; it does not spin (found: `evals run` processes at 100% CPU for twelve hours after their test run was killed).
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { join } from "node:path"
import { readFileSync, existsSync } from "node:fs"

const ROOT = join(import.meta.dirname, "..")

const runWithClosedReader = (script, { timeoutMs = 15_000 } = {}) =>
  new Promise((done) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] })
    // The reader goes away at once: the child's later writes meet a closed pipe.
    child.stdout.destroy()
    child.stderr.destroy()
    const started = Date.now()
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      done({ spun: true, ms: Date.now() - started })
    }, timeoutMs)
    child.on("exit", (code) => {
      clearTimeout(timer)
      done({ spun: false, code, ms: Date.now() - started })
    })
  })

const writer = `setTimeout(() => { for (let i = 0; i < 200; i++) console.log("x".repeat(2000)); console.error("y".repeat(2000)); setTimeout(() => process.exit(0), 300) }, 600)`

test("bin/evals drops output nobody reads and goes on: a write to a closed pipe is not an uncaught error", async () => {
  const ok = await runWithClosedReader(`import { ignoreStdioErrors } from ${JSON.stringify(join(ROOT, "src", "stdio.mjs"))}\nignoreStdioErrors()\n${writer}`)
  assert.equal(ok.spun, false, "it ended")
  assert.equal(ok.code, 0)
  assert.match(readFileSync(join(ROOT, "bin", "evals"), "utf8"), /ignoreStdioErrors\(\)/, "the CLI installs it before anything runs")
})

test("a batch's handler for an uncaught error cannot loop on a closed output: logging into it throws nothing that comes back to the handler", async () => {
  // The runner's handler, as written: it logs, then stops the batch. With the output closed and no listener, the log call threw into the handler again, for ever.
  const handler = `
    let calls = 0
    process.on("uncaughtException", (error) => {
      calls++
      if (calls > 50) process.exit(7)
      try { console.log("evals run: " + (error?.stack ?? error)) } catch {}
      process.exit(1)
    })
    ${writer}
  `
  const run = await runWithClosedReader(handler)
  assert.equal(run.spun, false)
  assert.notEqual(run.code, 7, "the handler was not called over and over")
  const source = readFileSync(join(ROOT, "src", "run", "runner.mjs"), "utf8")
  assert.match(source, /A handler that logs must never throw into itself/)
})

test("evals run whose reader is gone ends: the batch is not left spinning in its own error handler", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { compileCase } = await import("../src/case/compile.mjs")
  const { installFakeOpencode, installFakeBun } = await import("./helpers/fake-opencode.mjs")
  const root = mkdtempSync(join(tmpdir(), "evals-stdio-"))
  try {
    const store = join(root, "store")
    mkdirSync(store)
    writeFileSync(join(store, "round.json"), JSON.stringify({ accounts: { tavily: "none" } }))
    writeFileSync(join(store, "caps.json"), JSON.stringify({ vendors: { tavily_credits: 500 } }))
    const casesDir = join(root, "cases")
    mkdirSync(casesDir)
    const body = `# tools-search-x\n- Plugin: tavily\n- Skill under test: tavily\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: real\n- Set: wide\n\n## Prompt\nsearch the web for notes apps\n\n## Items\n- [TV-OC01] major · It answers.\n  evidence: text:any matches /./\n`
    writeFileSync(join(casesDir, "tools-search-x.json"), JSON.stringify(compileCase("cases/tavily/tools-search-x.md", body)))
    const arm = join(root, "plugin")
    mkdirSync(join(arm, "dist"), { recursive: true })
    writeFileSync(join(arm, "package.json"), JSON.stringify({ name: "@x/tavily", version: "0.0.5" }))
    writeFileSync(join(arm, "dist", "index.js"), "export default {}\n")
    const bin = join(root, "bin")
    mkdirSync(bin)
    const home = join(root, "user")
    mkdirSync(home)
    const tmp = join(root, "tmp")
    mkdirSync(tmp)
    const env = { PATH: process.env.PATH, HOME: home, EVALS_STORE: store, EVALS_OPENCODE_BIN: installFakeOpencode(bin), EVALS_BUN: installFakeBun(bin), EVALS_TMP: tmp }
    const args = [join(ROOT, "bin", "evals"), "run", "--plugin", "tavily", "--iteration", "gone", "--model", "mock/m1", "--auth", "none", "--scripted", "--isolation", "none", "--unsafe-no-isolation", "--arm", arm, "--cases-dir", casesDir, "--cases", "tools-search-x", "--set", "wide"]
    const result = await new Promise((done) => {
      const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] })
      child.stdout.destroy()
      child.stderr.destroy()
      const timer = setTimeout(() => {
        child.kill("SIGKILL")
        done("spun")
      }, 60_000)
      child.on("exit", (code, signal) => {
        clearTimeout(timer)
        done(code ?? signal)
      })
    })
    assert.notEqual(result, "spun", "evals run ended with nobody reading its output")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------------- only a closed reader is tolerated

const run = (args, { stdout, stderr = "pipe" }) =>
  new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ["ignore", stdout, stderr] })
    let err = ""
    child.stderr?.on("data", (d) => (err += d))
    child.on("exit", (code, signal) => done({ code: code ?? signal, err }))
  })

test("a disk-full write error is not hidden: the command exits non-zero with the message (only a closed reader is tolerated)", { skip: !existsSync("/dev/full") ? "no /dev/full on this platform" : false }, async () => {
  const { openSync, closeSync } = await import("node:fs")
  const fd = openSync("/dev/full", "w")
  try {
    // a command that prints and succeeds: with its stdout on a full disk it must not say 0
    const full = await run([join(ROOT, "bin", "evals"), "selftest"], { stdout: fd })
    assert.notEqual(full.code, 0, "exit code")
    assert.match(full.err, /evals: cannot write to stdout: ENOSPC: no space left on device/)
    assert.equal((full.err.match(/cannot write to stdout/g) ?? []).length, 1, "said once")
  } finally {
    closeSync(fd)
  }
  // the same command with its reader gone: tolerated, exit 0
  const gone = await new Promise((done) => {
    const child = spawn(process.execPath, [join(ROOT, "bin", "evals"), "selftest"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] })
    child.stdout.destroy()
    child.stderr.destroy()
    child.on("exit", (code, signal) => done(code ?? signal))
  })
  assert.equal(gone, 0, "a closed reader is not an error")
})

test("ignoreStdioErrors: EPIPE, ECONNRESET and a destroyed stream are dropped; any other code sets the exit code, says so once, and survives a later exit(0)", async () => {
  const { EventEmitter } = await import("node:events")
  const { ignoreStdioErrors, CLOSED_READER } = await import("../src/stdio.mjs")
  assert.deepEqual([...CLOSED_READER].sort(), ["ECONNRESET", "EPIPE", "ERR_STREAM_DESTROYED"])
  const make = () => {
    const proc = new EventEmitter()
    proc.exitCode = undefined
    const out = new EventEmitter()
    const err = new EventEmitter()
    const said = []
    ignoreStdioErrors({ proc, streams: [["stdout", out], ["stderr", err]], say: (line) => said.push(line) })
    return { proc, out, err, said }
  }
  const a = make()
  for (const code of ["EPIPE", "ECONNRESET", "ERR_STREAM_DESTROYED"]) a.out.emit("error", Object.assign(new Error(code), { code }))
  assert.equal(a.proc.exitCode, undefined)
  assert.deepEqual(a.said, [])
  const b = make()
  b.out.emit("error", Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" }))
  b.out.emit("error", Object.assign(new Error("EIO: i/o error, write"), { code: "EIO" }))
  assert.equal(b.proc.exitCode, 1)
  assert.deepEqual(b.said, ["evals: cannot write to stdout: ENOSPC: no space left on device, write\n"], "once per stream")
  b.err.emit("error", Object.assign(new Error("EBADF"), { code: "EBADF" }))
  assert.equal(b.said.length, 2)
  b.proc.exitCode = 0
  b.proc.emit("exit", 0)
  assert.equal(b.proc.exitCode, 1, "a command that sets 0 afterwards still ends non-zero")
  const c = make()
  c.out.emit("error", Object.assign(new Error("boom"), { code: "EIO" }))
  assert.equal(c.proc.exitCode, 1)
})
