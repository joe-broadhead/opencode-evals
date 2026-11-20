// The evals profile's library (R2, §1.2): the two environments, the credential lookup, the link scan and the installed files.
// The walk itself (check-real, keeper, evals-profile.sh, signin.sh) is tested in scripts/profile/walk.test.mjs, run by
// `npm run test:profile`: every vendor, every refusal, with a stand-in `opencode` and no real profile, vendor or credential.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { IDENTITY, profileEnv, realEnv, linksIn, activeCredential, digestsOf, profileConfig, defaultProfileDir, defaultStoreDir, defaultServerEnvFile, realServerUrl } from "../scripts/profile/profile-lib.mjs"

const SCRIPT = join(import.meta.dirname, "..", "scripts", "profile")
const cred = (integration, access, refresh = `${access}-refresh`, extra = {}) => ({ id: "cred_x", integrationID: integration, label: "x", active: true, value: { type: "oauth", methodID: "m", access, refresh, ...extra } })
const exported = (integration, access, refresh) => JSON.stringify([cred(integration, access, refresh)])

test("the profile's environment is inside the profile, with an empty .claude and no Claude Code, and the real one is not", () => {
  const env = profileEnv("/p", { HOME: "/real", PATH: "/usr/bin", OPENCODE_CONFIG_CONTENT: "x", XDG_DATA_HOME: "/real/.local", CLAUDE_CODE_OAUTH_TOKEN: "t", KEEP: "1" })
  assert.equal(env.HOME, "/p")
  assert.equal(env.OPENCODE_TEST_HOME, "/p")
  assert.equal(env.XDG_DATA_HOME, "/p/.local/share")
  assert.equal(env.CLAUDE_CONFIG_DIR, "/p/.claude")
  assert.equal(env.OPENCODE_DISABLE_CLAUDE_CODE, "1")
  assert.equal(env.OPENCODE_CONFIG_CONTENT, undefined)
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined)
  assert.equal(env.KEEP, "1")
  const real = realEnv({ HOME: "/p", OPENCODE_TEST_HOME: "/p", XDG_DATA_HOME: "/p/x", EVALS_REAL_HOME: "/real" })
  assert.equal(real.HOME, "/real")
  assert.equal(real.OPENCODE_TEST_HOME, undefined)
  assert.equal(real.XDG_DATA_HOME, undefined)
  assert.deepEqual(profileConfig().policies, [{ action: "provider.use", resource: "claude-agent", effect: "deny" }])
})

test("every path has an environment variable and today's value as its default", () => {
  const real = { EVALS_REAL_HOME: "/real", PATH: "/usr/bin" }
  assert.equal(defaultProfileDir(real), "/real/evals-232/profile")
  assert.equal(defaultStoreDir(real), "/real/evals-232/store")
  assert.equal(defaultServerEnvFile(real), "/real/.config/opencode-web/server.env")
  assert.equal(realServerUrl(real), "http://127.0.0.1:4096")
  // each is overridden by its own variable, and a flag where the script takes one
  const mine = { EVALS_PROFILE: "/p", EVALS_STORE: "/s", EVALS_REAL_SERVER: "http://127.0.0.1:5000", EVALS_REAL_SERVER_ENV: "/e.env" }
  assert.equal(defaultProfileDir(mine), "/p")
  assert.equal(defaultStoreDir(mine), "/s")
  assert.equal(defaultServerEnvFile(mine), "/e.env")
  assert.equal(realServerUrl(mine), "http://127.0.0.1:5000")
})

test("the active credential and its digests come out of an export without the token leaving the call", () => {
  const credential = activeCredential(exported("x", "ACCESS-TOKEN-ABCDEFGH", "REFRESH-TOKEN-ABCDEFG"), "x")
  const digests = digestsOf(credential)
  assert.match(digests.access, /^[0-9a-f]{64}$/)
  assert.notEqual(digests.access, digests.refresh)
  assert.equal(activeCredential("not json", "x"), null)
  assert.equal(activeCredential("[]", "x"), null)
  // an inactive `Linear` beside the active `Linear 2`: only the active one is ever compared
  assert.equal(activeCredential(JSON.stringify([{ id: "cred_a", integrationID: "mcp_lin", label: "Linear", active: false, value: { type: "oauth" } }, { id: "cred_b", integrationID: "mcp_lin", label: "Linear 2", active: true, value: { type: "oauth" } }]), "linear").label, "Linear 2")
  assert.ok(Object.keys(IDENTITY).length === 14)
})

test("linksIn finds every symbolic link under a directory, and none when there is none", () => {
  const root = mkdtempSync(join(tmpdir(), "evals-profile-links-"))
  try {
    mkdirSync(join(root, "deep", "er"), { recursive: true })
    symlinkSync("/real", join(root, "deep", "er", "out"))
    assert.deepEqual(linksIn(root), [join(root, "deep", "er", "out")])
    rmSync(join(root, "deep", "er", "out"))
    assert.deepEqual(linksIn(root), [])
    assert.deepEqual(linksIn(join(root, "missing")), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("check-real.sh, keeper.mjs and evals-profile.sh are installed where the round expects them, from this repository's copies", () => {
  for (const file of ["check-real.sh", "check-real.mjs", "keeper.mjs", "evals-profile.sh", "profile-lib.mjs", "signin.sh", "guard-real.mjs", "log-signin.mjs", "copy-client.mjs", "service-port.mjs", "write-config.mjs", "ensure-port.mjs", "identity-methods.json", "rpc-methods.fixture.json", "walk.test.mjs", "install.sh"]) assert.ok(existsSync(join(SCRIPT, file)), file)
  for (const file of ["check-real.sh", "evals-profile.sh", "install.sh"]) assert.match(readFileSync(join(SCRIPT, file), "utf8"), /EVALS_STORE=/, file)
  assert.match(readFileSync(join(SCRIPT, "signin.sh"), "utf8"), /EVALS_STORE/, "the walk takes its store from EVALS_STORE")
  const usage = spawnSync("node", [join(SCRIPT, "check-real.mjs")], { encoding: "utf8" })
  assert.equal(usage.status, 2)
  assert.match(usage.stderr, /usage: check-real\.mjs <integration>/)
})

test("install.sh refuses to overwrite a different copy, backs up first with --force, and installs JSON at 600", () => {
  const root = mkdtempSync(join(tmpdir(), "evals-profile-install-"))
  try {
    const dest = join(root, "bin")
    const env = { ...process.env, EVALS_BIN: dest, EVALS_STORE: join(root, "store") }
    const run = (...args) => spawnSync("bash", [join(SCRIPT, "install.sh"), ...args], { env, encoding: "utf8" })
    const first = run()
    assert.equal(first.status, 0, first.stdout + first.stderr)
    assert.equal(statSync(join(dest, "signin.sh")).mode & 0o777, 0o700)
    assert.equal(statSync(join(dest, "identity-methods.json")).mode & 0o777, 0o600)
    // a hand edit: refuse, and change nothing
    const edited = "#!/bin/sh\n# hand edited\n"
    writeFileSync(join(dest, "signin.sh"), edited)
    const refused = run()
    assert.equal(refused.status, 1, refused.stdout)
    assert.match(refused.stderr, /already holds a different copy: signin\.sh/)
    assert.equal(readFileSync(join(dest, "signin.sh"), "utf8"), edited, "nothing was overwritten")
    // --force: the old tree is backed up first, then installed
    const forced = run("--force")
    assert.equal(forced.status, 0, forced.stdout + forced.stderr)
    assert.match(forced.stdout, /backed up .* to .*\.bak-/)
    const backups = readdirSync(root).filter((n) => n.startsWith("bin.bak-"))
    assert.equal(backups.length, 1)
    assert.equal(readFileSync(join(root, backups[0], "signin.sh"), "utf8"), edited, "the hand-edited file is in the backup")
    assert.equal(readFileSync(join(dest, "signin.sh"), "utf8"), readFileSync(join(SCRIPT, "signin.sh"), "utf8"))
    // an identical tree needs no backup
    const again = run("--force")
    assert.equal(again.status, 0, again.stdout + again.stderr)
    assert.equal(readdirSync(root).filter((n) => n.startsWith("bin.bak-")).length, 1, "identical files are not backed up")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
