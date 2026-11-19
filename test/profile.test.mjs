// The evals profile's scripts (R2, §1.2): check-real, keeper and evals-profile.sh, tested with a stand-in `opencode` and
// synthetic credentials. No real profile, vendor or credential is touched, and no token is ever printed.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { checkReal } from "../scripts/profile/check-real.mjs"
import { keepOnce } from "../scripts/profile/keeper.mjs"
import { IDENTITY, RECHECK_HOURS, profileEnv, realEnv, linksIn, activeCredential, digestsOf, profileConfig } from "../scripts/profile/profile-lib.mjs"

const SCRIPT = join(import.meta.dirname, "..", "scripts", "profile")
const cred = (integration, access, refresh = `${access}-refresh`, extra = {}) => ({ id: "cred_x", integrationID: integration, label: "x", active: true, value: { type: "oauth", methodID: "m", access, refresh, ...extra } })
const exported = (integration, access, refresh) => JSON.stringify([cred(integration, access, refresh)])

/** A stand-in exec: the real profile and the evals profile answer from their own HOME; reads can be made to fail. */
function stand({ real, evals, identity = 0, realHome = "/real", evalsHome = "/evals" }) {
  const calls = []
  const exec = (command, args, { env }) => {
    // The evals profile has its own service port, apart from the real one's (G0 review 4.1).
    if (args[0] === "service" && args[1] === "get") return { code: 0, stdout: env.HOME === evalsHome ? "47950\n" : "49374\n", stderr: "" }
    calls.push({ args, home: env.HOME })
    if (args[0] === "api") return identity === 0 ? { code: 0, stdout: '{"ok":true}', stderr: "" } : { code: identity, stdout: "", stderr: "boom" }
    if (args[0] === "auth" && args[1] === "export") {
      const mine = env.HOME === evalsHome ? evals : real
      return mine === null ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: mine, stderr: "" }
    }
    return { code: 1, stdout: "", stderr: "unexpected" }
  }
  return { exec, calls, env: { EVALS_REAL_HOME: realHome, PATH: "/usr/bin" } }
}

test("check-real passes when the real profile reads and the two profiles hold different tokens", () => {
  const s = stand({ real: exported("linear", "REAL-ACCESS-TOKEN-0001"), evals: exported("linear", "EVALS-ACCESS-TOKEN-0002") })
  const out = checkReal({ integration: "linear", profile: "/evals", store: null, exec: s.exec, env: s.env })
  assert.equal(out.ok, true, out.line)
  assert.match(out.line, /^PASS linear: identity read linear_whoami succeeded; access and refresh tokens differ; provisional/)
  assert.ok(!out.line.includes("TOKEN"), "no token in the output")
  // The real read goes through the real HOME and the evals profile's export through its own.
  assert.deepEqual(s.calls.map((c) => c.home), ["/real", "/real", "/evals"])
})

test("check-real fails, with the step that fixes it, when the grant is shared or the real read breaks", () => {
  const same = stand({ real: exported("jira", "SAME-ACCESS-TOKEN-0000", "r1"), evals: exported("jira", "SAME-ACCESS-TOKEN-0000", "r2") })
  const a = checkReal({ integration: "jira", profile: "/evals", exec: same.exec, env: same.env })
  assert.equal(a.ok, false)
  assert.match(a.line, /^FAIL jira: the evals profile holds the SAME access token/)
  assert.match(a.line, /sign the real profile back in for jira/)
  const sameRefresh = stand({ real: exported("jira", "A-TOKEN-0000001", "SHARED-REFRESH-000"), evals: exported("jira", "B-TOKEN-0000002", "SHARED-REFRESH-000") })
  assert.match(checkReal({ integration: "jira", profile: "/evals", exec: sameRefresh.exec, env: sameRefresh.env }).line, /SAME refresh token/)
  const broken = stand({ real: exported("notion", "a-token-00000001"), evals: exported("notion", "b-token-00000002"), identity: 1 })
  assert.match(checkReal({ integration: "notion", profile: "/evals", exec: broken.exec, env: broken.env }).line, /^FAIL notion: the real profile's identity read \(notion_notion-get-self\) failed \(exit 1\)/)
  const none = stand({ real: exported("github", "a-token-00000001"), evals: null })
  assert.match(checkReal({ integration: "github", profile: "/evals", exec: none.exec, env: none.env }).line, /holds no credential for it \(sign it in first\)/)
  const noreal = stand({ real: null, evals: exported("github", "b-token-00000002") })
  assert.match(checkReal({ integration: "github", profile: "/evals", exec: noreal.exec, env: noreal.env }).line, /the real profile holds no credential/)
})

test("check-real: an API-key integration has no identity call, a vendor with a one-hour token says when to check again", () => {
  const s = stand({ real: JSON.stringify([{ integrationID: "tavily", active: true, value: { type: "api", key: "k1" } }]), evals: JSON.stringify([{ integrationID: "tavily", active: true, value: { type: "api", key: "k2" } }]) })
  const out = checkReal({ integration: "tavily", profile: "/evals", exec: s.exec, env: s.env })
  assert.equal(out.ok, true, out.line)
  assert.match(out.line, /no identity tool for this integration/)
  assert.ok(!/provisional/.test(out.line))
  assert.equal(s.calls.some((c) => c.args[0] === "api"), false, "no call for a key")
  const g = stand({ real: exported("gws", "a-token-00000001"), evals: exported("gws", "b-token-00000002") })
  const now = new Date("2026-11-18T10:00:00Z")
  assert.match(checkReal({ integration: "gws", profile: "/evals", exec: g.exec, env: g.env, now }).line, /checked again by 2026-11-18T11:00:00\.000Z/)
  assert.equal(RECHECK_HOURS.slack, 12)
  assert.equal(RECHECK_HOURS.linear, 24)
})

test("check-real logs its result to the round log, with no token in it", () => {
  const store = mkdtempSync(join(tmpdir(), "evals-profile-test-"))
  try {
    const s = stand({ real: exported("slack", "REAL-SECRET-TOKEN-0001"), evals: exported("slack", "EVALS-SECRET-TOKEN-02") })
    checkReal({ integration: "slack", profile: "/evals", store, exec: s.exec, env: s.env })
    const log = readFileSync(join(store, "round-232.log"), "utf8")
    assert.match(log, /"event":"check-real"/)
    assert.match(log, /"integration":"slack"/)
    assert.ok(!/SECRET/.test(log))
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})

test("the keeper reads once per signed-in integration, through the evals profile only, and reports failures", () => {
  const calls = []
  const exec = (command, args, { env }) => {
    if (args[0] === "service" && args[1] === "get") return { code: 0, stdout: env.HOME === "/evals" ? "47950\n" : "49374\n", stderr: "" }
    calls.push({ args: args.join(" "), home: env.HOME })
    if (args[0] === "auth") return /linear|jira/.test(args[2]) ? { code: 0, stdout: exported(args[2], `tok-${args[2]}-0001`), stderr: "" } : { code: 1, stdout: "", stderr: "" }
    return args[2].includes("jira") ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: "{}", stderr: "" }
  }
  const results = keepOnce({ profile: "/evals", exec, env: { PATH: "/usr/bin" } })
  assert.deepEqual(results.map((r) => [r.integration, r.ok]), [["linear", true], ["jira", false]])
  assert.ok(calls.every((c) => c.home === "/evals"), "never the real profile")
  assert.equal(calls.filter((c) => c.args.startsWith("api")).length, 2, "one read each, none for an integration the profile is not signed into")
})

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

test("evals-profile.sh builds an empty profile, links nothing, and refuses to run when a link is found", () => {
  const root = mkdtempSync(join(tmpdir(), "evals-profile-sh-"))
  try {
    const profile = join(root, "profile")
    const env = { PATH: process.env.PATH, EVALS_PROFILE: profile, EVALS_STORE: join(root, "store"), HOME: "/real-home", OPENCODE_SERVER_PASSWORD: "x", XDG_DATA_HOME: "/real-home/.local/share" }
    const out = spawnSync("bash", [join(SCRIPT, "evals-profile.sh"), "--", "sh", "-c", 'printf "%s|%s|%s|%s|%s" "$HOME" "$OPENCODE_TEST_HOME" "$CLAUDE_CONFIG_DIR" "$OPENCODE_DISABLE_CLAUDE_CODE" "${XDG_DATA_HOME}"'], { env, encoding: "utf8" })
    assert.equal(out.status, 0, out.stderr)
    assert.equal(out.stdout, `${profile}|${profile}|${profile}/.claude|1|${profile}/.local/share`)
    assert.ok(existsSync(join(profile, ".claude")))
    assert.deepEqual(readdirLinks(profile), [], "find -type l prints nothing")
    assert.deepEqual(JSON.parse(readFileSync(join(profile, ".config", "opencode", "opencode.json"), "utf8")).policies, profileConfig().policies)
    symlinkSync("/real-home", join(profile, ".claude-link"))
    const refused = spawnSync("bash", [join(SCRIPT, "evals-profile.sh"), "--", "true"], { env, encoding: "utf8" })
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /symbolic link/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const readdirLinks = (dir) => linksIn(dir)

test("the active credential and its digests come out of an export without the token leaving the call", () => {
  const credential = activeCredential(exported("x", "ACCESS-TOKEN-ABCDEFGH", "REFRESH-TOKEN-ABCDEFG"), "x")
  const digests = digestsOf(credential)
  assert.match(digests.access, /^[0-9a-f]{64}$/)
  assert.notEqual(digests.access, digests.refresh)
  assert.equal(activeCredential("not json", "x"), null)
  assert.equal(activeCredential("[]", "x"), null)
  assert.ok(Object.keys(IDENTITY).length === 14)
})

test("check-real.sh, keeper.mjs and evals-profile.sh are installed where the round expects them, from this repository's copies", () => {
  for (const file of ["check-real.sh", "check-real.mjs", "keeper.mjs", "evals-profile.sh", "profile-lib.mjs", "install.sh"]) assert.ok(existsSync(join(SCRIPT, file)), file)
  const text = readFileSync(join(SCRIPT, "check-real.sh"), "utf8")
  assert.match(text, /EVALS_STORE="\$\{EVALS_STORE:-/, "every script exports EVALS_STORE")
  for (const file of ["check-real.sh", "evals-profile.sh", "install.sh"]) assert.match(readFileSync(join(SCRIPT, file), "utf8"), /export EVALS_STORE=/, file)
  const usage = spawnSync("node", [join(SCRIPT, "check-real.mjs")], { encoding: "utf8" })
  assert.equal(usage.status, 2)
  assert.match(usage.stderr, /usage: check-real\.sh <integration>/)
})
