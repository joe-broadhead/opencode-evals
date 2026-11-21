// scripts/seed-canaries.mjs against a fake service: sandbox containers only, idempotent, the evals profile only, a plan on --dry-run.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { seedCanaries, manifestProblems, fill, pick, unwrap, MANIFEST_SCHEMA } from "../scripts/seed-canaries.mjs"
import { loadCanaries, flatten } from "../src/grade/targets.mjs"

const ROOT = join(import.meta.dirname, "..")
const TARGETS = { linear: { team: "T-SANDBOX", project: "P-SANDBOX" }, slack: { sandbox_channel: "C0SANDBOX" }, notion: { sandbox_page: "P-SANDBOX-0001" } }

const MANIFEST = {
  schema: MANIFEST_SCHEMA,
  canaries: [
    { name: "linear_issue", plugin: "linear", container: "linear.team", content: "Quillfeather sync stalls {{token}}", find: { method: "list_issues", input: { team: "{{container}}", query: "{{content}}" }, items: "issues", where: "title", id: "id" }, create: { method: "save_issue", input: { team: "{{container}}", title: "{{content}}", description: "Invented for the round." }, id: "id" } },
    { name: "linear_release", plugin: "linear", container: "linear.team", content: "Marlowe release {{token}}", find: { method: "list_issues", input: { team: "{{container}}", query: "{{content}}" }, items: "issues", where: "title", id: "id" }, create: { method: "save_issue", input: { team: "{{container}}", title: "{{content}}" }, id: "id" } },
    // a vendor-assigned id is the value: Slack chooses the ts
    { name: "slack_pinned_ts", plugin: "slack", container: "slack.sandbox_channel", content: "pinned fixture note for the round", value: "id", find: { method: "slack_read_channel", input: { channel_id: "{{container}}" }, items: "messages", where: "text", id: "ts", match: "includes" }, create: { method: "slack_send_message", input: { channel_id: "{{container}}", message: "{{content}}" }, id: "ts" } },
  ],
}

// One canary of each Linear kind whose find is a list inside the tools-RPC envelope: a rerun of any of them must reuse.
const FIVE = {
  schema: MANIFEST_SCHEMA,
  canaries: [
    MANIFEST.canaries[0],
    { name: "linear_document", plugin: "linear", container: "linear.team", content: "Evals spec marlin", value: "content", find: { method: "list_documents", input: { teamId: "{{container}}", query: "{{content}}" }, items: "documents", where: "title", id: "id" }, create: { method: "save_document", input: { team: "{{container}}", title: "{{content}}" }, id: "id" } },
    { name: "linear_milestone", plugin: "linear", container: "linear.project", content: "Phase one heron", value: "content", find: { method: "list_milestones", input: { project: "{{container}}" }, items: "milestones", where: "name", id: "id" }, create: { method: "save_milestone", input: { project: "{{container}}", name: "{{content}}" }, id: "id" } },
    { name: "linear_issue_label", plugin: "linear", container: "linear.team", content: "flaky-test 5c2e", value: "content", find: { method: "list_issue_labels", input: { team: "{{container}}", name: "{{content}}" }, items: "labels", where: "name", id: "id" }, create: { method: "create_issue_label", input: { teamId: "{{container}}", name: "{{content}}" }, id: "id" } },
    { name: "linear_project_label", plugin: "linear", container: "linear.team", content: "evals 232 7d1a", value: "content", find: { method: "list_project_labels", input: { team: "{{container}}", name: "{{content}}" }, items: "labels", where: "name", id: "id" }, create: { method: "save_project_label", input: { teamId: "{{container}}", name: "{{content}}" }, id: "id" } },
  ],
}

/** A fake `opencode`: the evals profile's service, with a sandbox in memory, session rules enforced as the real service does. */
function fake({ profile, signedIn = ["linear", "slack"], realPort = "49374", profilePort = "47950" } = {}) {
  const calls = []
  const sessions = new Map()
  const made = [] // every session body, kept after the session itself is deleted
  const deleted = []
  const entities = [] // { kind, container, text, id }
  let n = 0
  let sessionN = 0
  // The tools-RPC answer as the service makes it: { output: { output: <the tool's value>, text } }.
  const envelope = (value, text = "ok") => ({ output: { output: value, text } })
  const rpc = (route, method, body) => {
    const session = sessions.get(body.input.sessionID)
    if (!session) return { code: 1, stdout: "", stderr: "no session" }
    const plugin = route.split(".")[0]
    const action = {
      list_issues: "linear_list_issues", save_issue: "linear_save_issue",
      list_documents: "linear_list_documents", save_document: "linear_save_document",
      list_milestones: "linear_list_milestones", save_milestone: "linear_save_milestone",
      list_issue_labels: "linear_list_issue_labels", create_issue_label: "linear_create_issue_label",
      list_project_labels: "linear_list_project_labels", save_project_label: "linear_save_project_label",
      slack_read_channel: "slack_slack_read_channel", slack_send_message: "slack_slack_send_message",
    }[method]
    // the last matching rule wins; only an allow runs
    const rule = [...session.permissions].reverse().find((r) => r.action === action || (r.action.endsWith("*") && action.startsWith(r.action.slice(0, -1))))
    if (rule?.effect !== "allow") return { code: 0, stdout: JSON.stringify({ error: { message: `PERMISSION_DENIED ${action}` } }), stderr: "" }
    const input = body.input.input
    const listed = (kind, container, field, query) => ({
      output: {
        output: {
          [field]: entities.filter((e) => e.kind === kind && e.container === container && (query === undefined || e.text.includes(query))).map((e) => ({ id: e.id, [kind === "issue" || kind === "document" ? "title" : "name"]: e.text })),
        },
        text: "1 found",
      },
    })
    if (method === "list_issues") return { code: 0, stdout: JSON.stringify(listed("issue", input.team, "issues", input.query)), stderr: "" }
    if (method === "save_issue") {
      const e = { kind: "issue", container: input.team, text: input.title, id: `ISS-${++n}` }
      entities.push(e)
      return { code: 0, stdout: JSON.stringify(envelope({ id: e.id, title: e.text })), stderr: "" }
    }
    if (method === "list_documents") return { code: 0, stdout: JSON.stringify(listed("document", input.teamId, "documents", input.query)), stderr: "" }
    if (method === "save_document") {
      const e = { kind: "document", container: input.team, text: input.title, id: `DOC-${++n}` }
      entities.push(e)
      return { code: 0, stdout: JSON.stringify(envelope({ id: e.id, title: e.text })), stderr: "" }
    }
    if (method === "list_milestones") return { code: 0, stdout: JSON.stringify(listed("milestone", input.project, "milestones")), stderr: "" }
    if (method === "save_milestone") {
      const e = { kind: "milestone", container: input.project, text: input.name, id: `MIL-${++n}` }
      entities.push(e)
      return { code: 0, stdout: JSON.stringify(envelope({ id: e.id, name: e.text })), stderr: "" }
    }
    if (method === "list_issue_labels") return { code: 0, stdout: JSON.stringify(listed("issue_label", input.team, "labels", input.name)), stderr: "" }
    if (method === "create_issue_label") {
      const e = { kind: "issue_label", container: input.teamId, text: input.name, id: `LBL-${++n}` }
      entities.push(e)
      return { code: 0, stdout: JSON.stringify(envelope({ id: e.id, name: e.text })), stderr: "" }
    }
    if (method === "list_project_labels") return { code: 0, stdout: JSON.stringify(listed("project_label", input.team, "labels", input.name)), stderr: "" }
    if (method === "save_project_label") {
      const e = { kind: "project_label", container: input.teamId, text: input.name, id: `PLB-${++n}` }
      entities.push(e)
      return { code: 0, stdout: JSON.stringify(envelope({ id: e.id, name: e.text })), stderr: "" }
    }
    if (method === "slack_read_channel") return { code: 0, stdout: JSON.stringify(envelope({ content: [{ type: "text", text: JSON.stringify({ messages: entities.filter((e) => e.kind === "message" && e.container === input.channel_id).map((e) => ({ ts: e.id, text: e.text })) }) }] })), stderr: "" }
    if (method === "slack_send_message") {
      const e = { kind: "message", container: input.channel_id, text: input.message, id: `17570000${String(++n).padStart(2, "0")}.00${n}100` }
      entities.push(e)
      return { code: 0, stdout: JSON.stringify(envelope({ ts: e.id })), stderr: "" }
    }
    return { code: 1, stdout: "", stderr: `no method ${method}` }
  }
  const exec = (command, args, { env } = {}) => {
    calls.push({ args, home: env?.HOME })
    if (args[0] === "service" && args[1] === "get") return { code: 0, stdout: `${env?.HOME === profile ? profilePort : realPort}\n`, stderr: "" }
    if (args[0] === "auth" && args[1] === "export") return signedIn.includes(args[2]) ? { code: 0, stdout: JSON.stringify([{ id: "cred_x", integrationID: args[2], label: args[2], active: true, value: { type: "oauth", access: `tok-${args[2]}-00001`, refresh: `ref-${args[2]}-00001` } }]), stderr: "" } : { code: 1, stdout: "", stderr: "" }
    if (args[0] === "api" && args[1] === "post") {
      const path = args[2]
      const body = JSON.parse(args[args.indexOf("--data") + 1])
      if (path === "/api/session") {
        const id = `ses_${++sessionN}`
        sessions.set(id, body)
        made.push({ id, ...body })
        return { code: 0, stdout: JSON.stringify({ data: { id } }), stderr: "" }
      }
      const m = /^\/api\/rpc\/([^/]+)\/([^/]+)$/.exec(path)
      if (m) return rpc(m[1], m[2], body)
    }
    if (args[0] === "api" && args[1] === "delete") {
      const m = /^\/api\/session\/(ses_[A-Za-z0-9]+)$/.exec(args[2])
      if (!m || !sessions.has(m[1])) return { code: 1, stdout: "", stderr: "no such session" }
      sessions.delete(m[1])
      deleted.push(m[1])
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }
    }
    return { code: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` }
  }
  return { exec, calls, sessions, made, deleted, entities, rpcCalls: () => calls.filter((c) => /^\/api\/rpc\//.test(c.args[2] ?? "")) }
}

function setup(t, { targets = TARGETS } = {}) {
  const root = mkdtempSync(join(tmpdir(), "evals-seed-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const store = join(root, "store")
  const profile = join(root, "profile")
  mkdirSync(store)
  mkdirSync(profile)
  writeFileSync(join(store, "targets.json"), JSON.stringify(targets))
  return { root, store, profile, env: { PATH: process.env.PATH, EVALS_REAL_HOME: join(root, "real-home") } }
}
const seed = (s, extra = {}) => seedCanaries({ manifest: MANIFEST, store: s.store, profile: s.profile, env: s.env, ...extra })
const canariesOf = (s) => JSON.parse(readFileSync(join(s.store, "canaries.json"), "utf8"))

test("--dry-run prints the plan and touches nothing: no call to the service, no write to the store", (t) => {
  const s = setup(t)
  const svc = fake({ profile: s.profile })
  const out = seed(s, { dryRun: true, exec: svc.exec })
  assert.equal(out.dry, true)
  assert.equal(svc.calls.length, 0, "not even a port read")
  assert.equal(existsSync(join(s.store, "canaries.json")), false)
  assert.deepEqual(out.plan.map((p) => [p.name, p.plugin, p.alias, p.container]), [["linear_issue", "linear", "linear.team", "T-SANDBOX"], ["linear_release", "linear", "linear.team", "T-SANDBOX"], ["slack_pinned_ts", "slack", "slack.sandbox_channel", "C0SANDBOX"]])
  assert.match(out.plan[0].content, /\{\{token\}\}/, "the token is made by a real run")
  // and through the CLI, with no profile and no service at all
  const cli = spawnSync(process.execPath, [join(ROOT, "scripts", "seed-canaries.mjs"), "--manifest", join(s.root, "m.json"), "--dry-run"], { encoding: "utf8", env: { PATH: process.env.PATH, EVALS_STORE: s.store, HOME: s.root } })
  assert.notEqual(cli.status, 0)
  writeFileSync(join(s.root, "m.json"), JSON.stringify(MANIFEST))
  const ok = spawnSync(process.execPath, [join(ROOT, "scripts", "seed-canaries.mjs"), "--manifest", join(s.root, "m.json"), "--dry-run"], { encoding: "utf8", env: { PATH: process.env.PATH, EVALS_STORE: s.store, HOME: s.root } })
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /dry run: nothing is created, nothing is written\): 3 canaries/)
  assert.match(ok.stdout, /linear_issue\s+linear in linear\.team \(T-SANDBOX\): find list_issues, create save_issue/)
  assert.equal(existsSync(join(s.store, "canaries.json")), false)
})

test("every canary is created in its sandbox container and nowhere else, recorded with its id, and the grader reads the values", (t) => {
  const s = setup(t)
  const svc = fake({ profile: s.profile })
  const out = seed(s, { exec: svc.exec })
  assert.deepEqual(out.created, ["linear_issue", "linear_release", "slack_pinned_ts"])
  assert.deepEqual(svc.entities.map((e) => [e.kind, e.container]), [["issue", "T-SANDBOX"], ["issue", "T-SANDBOX"], ["message", "C0SANDBOX"]], "only the sandbox containers")
  for (const call of svc.rpcCalls()) {
    const body = JSON.parse(call.args[call.args.indexOf("--data") + 1]).input.input
    assert.ok([body.team, body.channel_id].some((v) => ["T-SANDBOX", "C0SANDBOX"].includes(v)), `every call names a sandbox container: ${JSON.stringify(body)}`)
  }
  const book = canariesOf(s)
  assert.match(book.linear_issue, /^Quillfeather sync stalls [0-9a-f]{6}$/)
  assert.match(book.slack_pinned_ts, /^\d{10}\.\d+$/, "a vendor-assigned id is the value")
  assert.deepEqual(book._ids, { linear_issue: "ISS-1", linear_release: "ISS-2", slack_pinned_ts: book.slack_pinned_ts })
  // the grader reads them (a `_`-prefixed key is not a canary) and none is weak
  const read = loadCanaries({ EVALS_STORE: s.store })
  assert.deepEqual([...read.keys()].sort(), ["linear_issue", "linear_release", "slack_pinned_ts"])
  assert.equal(readFileSync(join(s.store, "canaries.json"), "utf8").includes("tok-"), false, "no credential in the store file")
})

test("idempotent: a rerun finds and reuses what is there, creates nothing, and keeps the content, the token and the ids", (t) => {
  const s = setup(t)
  const svc = fake({ profile: s.profile })
  seed(s, { exec: svc.exec })
  const first = canariesOf(s)
  const again = seed(s, { exec: svc.exec })
  assert.deepEqual(again.created, [])
  assert.deepEqual(again.reused, ["linear_issue", "linear_release", "slack_pinned_ts"])
  assert.equal(svc.entities.length, 3, "nothing duplicated")
  assert.deepEqual(canariesOf(s), first)
  // one that was deleted in the sandbox is created again with the same content; the others are reused
  svc.entities.splice(0, 1)
  const third = seed(s, { exec: svc.exec })
  assert.deepEqual(third.created, ["linear_issue"])
  assert.deepEqual(third.reused, ["linear_release", "slack_pinned_ts"])
  assert.equal(canariesOf(s).linear_issue, first.linear_issue)
  assert.equal(svc.entities.length, 3)
  // --only plants some
  const s2 = setup(t)
  const svc2 = fake({ profile: s2.profile })
  assert.deepEqual(seed(s2, { exec: svc2.exec, only: ["slack_pinned_ts"] }).created, ["slack_pinned_ts"])
  assert.throws(() => seed(s2, { exec: svc2.exec, only: ["nope"] }), /no canary nope in the manifest/)
})

test("a container that is not a sandbox alias is refused before anything is created", (t) => {
  const bad = (change) => ({ ...MANIFEST, canaries: [MANIFEST.canaries[0], { ...MANIFEST.canaries[1], ...change }] })
  for (const [why, change, match] of [
    ["an alias the store lacks", { container: "linear.production" }, /container linear\.production is not an alias in targets\.json: a canary is created in a sandbox container only/],
    ["a raw id", { container: "T-REAL-TEAM" }, /container must be a targets\.json alias such as linear\.team, not "T-REAL-TEAM"/],
    ["no container", { container: undefined }, /container must be a targets\.json alias/],
  ]) {
    const s = setup(t)
    const svc = fake({ profile: s.profile })
    assert.throws(() => seedCanaries({ manifest: bad(change), store: s.store, profile: s.profile, env: s.env, exec: svc.exec }), match, why)
    assert.equal(svc.calls.length, 0, `${why}: nothing was called, not even for the first, good canary`)
    assert.equal(existsSync(join(s.store, "canaries.json")), false)
  }
  // an alias with two values is not one container; no targets file at all
  const s = setup(t, { targets: { linear: { team: ["T-A", "T-B"] }, slack: { sandbox_channel: "C0SANDBOX" } } })
  assert.throws(() => seed(s, { exec: fake({ profile: s.profile }).exec }), /names 2 values: a canary goes in one container/)
  const none = setup(t)
  rmSync(join(none.store, "targets.json"))
  assert.throws(() => seed(none, { exec: fake({ profile: none.profile }).exec }), /targets\.json does not exist/)
})

test("a create or a find that does not name {{container}} is refused: a canary says where it goes", (t) => {
  const s = setup(t)
  const svc = fake({ profile: s.profile })
  for (const step of ["create", "find"]) {
    const m = JSON.parse(JSON.stringify(MANIFEST))
    m.canaries[0][step].input = { team: "T-SANDBOX", title: "{{content}}", query: "{{content}}" } // the value written in by hand, not the alias
    assert.throws(() => seed(s, { manifest: m, exec: svc.exec }), new RegExp(`${step}\\.input does not name \\{\\{container\\}\\}`), step)
  }
  assert.equal(svc.calls.length, 0)
  const problems = (change) => manifestProblems({ ...MANIFEST, canaries: [{ ...MANIFEST.canaries[0], ...change }] }, { targets: flatten(TARGETS) })
  assert.match(problems({ plugin: "nopack" })[0], /no pack for plugin "nopack"/)
  assert.match(problems({ plugin: "github" })[0], /runs with no account \(fake\)/, "fake mode has nothing to seed")
  assert.match(problems({ name: "Bad-Name" })[0], /lower-case letters, digits and underscores/)
  assert.match(problems({ content: "short" })[0], /at least 8 characters/)
  assert.match(problems({ value: "both" })[0], /value is "content" or "id"/)
  assert.match(problems({ create: { method: "save_issue", input: { team: "{{container}}", t: "{{nope}}" } } })[0], /\{\{nope\}\}, which is not available/)
  assert.match(problems({ find: { ...MANIFEST.canaries[0].find, where: undefined } })[0], /find\.where/)
  assert.match(manifestProblems({ ...MANIFEST, canaries: [MANIFEST.canaries[0], MANIFEST.canaries[0]] }, { targets: flatten(TARGETS) })[0], /listed twice/)
  assert.match(manifestProblems({ schema: "x" }, { targets: flatten(TARGETS) })[0], /schema is "x"/)
  assert.match(manifestProblems({ schema: MANIFEST_SCHEMA, canaries: [] }, { targets: flatten(TARGETS) })[0], /lists no canary/)
  assert.match(problems({ value: "id", content: "fixed {{token}}", create: { ...MANIFEST.canaries[0].create, id: "id" } })[0], /fixed text the canary is found by: it has no \{\{token\}\}/)
})

test("it never runs against the normal profile: no profile, the real home, the real service's port, an unsigned plugin", (t) => {
  const s = setup(t)
  const svc = fake({ profile: s.profile })
  assert.throws(() => seed(s, { profile: undefined, exec: svc.exec }), /EVALS_PROFILE is not set/)
  const realHome = join(s.root, "real-home")
  mkdirSync(realHome)
  assert.throws(() => seed(s, { profile: realHome, exec: svc.exec }), /is the real home/)
  assert.throws(() => seed(s, { profile: join(s.root, "missing"), exec: svc.exec }), /does not exist: run evals-profile\.sh/)
  // its service is the real service's: refused before any plugin is read (the real port comes from the environment, never a real-env command)
  const samePort = fake({ profile: s.profile, realPort: "47950", profilePort: "47950" })
  assert.throws(() => seed(s, { exec: samePort.exec, env: { ...s.env, EVALS_REAL_SERVICE_PORT: "47950" } }), /service port \(47950\) is the real service's/)
  assert.equal(samePort.rpcCalls().length, 0)
  // a plugin the evals profile is not signed in to
  const unsigned = fake({ profile: s.profile, signedIn: ["linear"] })
  assert.throws(() => seed(s, { exec: unsigned.exec }), /holds no credential for slack: sign it in/)
  assert.equal(unsigned.rpcCalls().length, 0)
  assert.equal(existsSync(join(s.store, "canaries.json")), false)
  // and every call of a good run carries the evals profile's environment, never the real home's
  const ok = fake({ profile: s.profile })
  seed(s, { exec: ok.exec })
  assert.ok(ok.calls.length > 5)
  assert.ok(ok.calls.every((c) => c.home === s.profile || c.args[0] === "service" /* the real port is read from the real home */), JSON.stringify(ok.calls.filter((c) => c.home !== s.profile).map((c) => c.args)))
  assert.ok(ok.calls.filter((c) => c.args[0] === "api" || c.args[0] === "auth").every((c) => c.home === s.profile), "every api and auth call ran in the evals profile")
})

test("the session of the seeding denies every tool of the plugins it touches except the find and create methods it names", (t) => {
  const s = setup(t)
  const svc = fake({ profile: s.profile })
  seed(s, { exec: svc.exec })
  assert.equal(svc.made.length, 1, "one session")
  const [session] = svc.made
  assert.equal(session.agent, "build")
  assert.deepEqual(session.location, { directory: join(s.profile, "canary-seeding") })
  assert.deepEqual(session.permissions, [
    { action: "linear_*", resource: "*", effect: "deny" },
    { action: "slack_*", resource: "*", effect: "deny" },
    { action: "linear_list_issues", resource: "*", effect: "allow" },
    { action: "linear_save_issue", resource: "*", effect: "allow" },
    { action: "slack_slack_read_channel", resource: "*", effect: "allow" },
    { action: "slack_slack_send_message", resource: "*", effect: "allow" },
  ])
  // a method the manifest did not name is refused by the service as the rules say
  const m = JSON.parse(JSON.stringify(MANIFEST))
  m.canaries = [m.canaries[0]]
  m.canaries[0].create.method = "save_issue_label"
  assert.throws(() => seed(setup(t), { manifest: m, exec: fake({ profile: s.profile }).exec }), /./)
})

test("the helpers: dotted paths, templates, and the answers a service gives", () => {
  assert.equal(pick({ a: { b: [{ c: 7 }] } }, "a.b.0.c"), 7)
  assert.equal(pick({ a: 1 }, "a.b.c"), undefined)
  assert.deepEqual(fill({ q: "{{content}} in {{container}}", n: ["{{token}}", 3], keep: "{{other}}" }, { content: "x", container: "T", token: "ab12cd" }), { q: "x in T", n: ["ab12cd", 3], keep: "{{other}}" })
  assert.deepEqual(unwrap(JSON.stringify({ output: { id: 1 } })), { id: 1 })
  assert.deepEqual(unwrap(JSON.stringify({ data: { id: 2 } })), { id: 2 })
  assert.deepEqual(unwrap(JSON.stringify({ output: { content: [{ type: "text", text: '{"id":3}' }] } })), { id: 3 })
  assert.deepEqual(unwrap(JSON.stringify({ output: '{"id":4}' })), { id: 4 })
  // A tools-RPC answer is { output: { output: <the tool's value>, text } }: the descent is what find reads.
  assert.deepEqual(unwrap(JSON.stringify({ output: { output: { milestones: [{ id: "m1", name: "X" }] }, text: "1 found" } })), { milestones: [{ id: "m1", name: "X" }] })
  assert.deepEqual(unwrap(JSON.stringify({ output: { output: { content: [{ type: "text", text: '{"issues":[{"id":"i1"}]}' }] }, text: "1 found" } })), { issues: [{ id: "i1" }] })
  assert.throws(() => unwrap(JSON.stringify({ error: { message: "PERMISSION_DENIED x" } })), /the service refused: PERMISSION_DENIED x/)
  assert.throws(() => unwrap("not json"), /did not answer JSON/)
})

test("a value too weak to be a canary is refused when it comes back from the service, and nothing is recorded for it", (t) => {
  const s = setup(t)
  const svc = fake({ profile: s.profile })
  const m = JSON.parse(JSON.stringify(MANIFEST))
  m.canaries = [m.canaries[2]]
  // the service gives back an id the grader would find in ordinary text
  const exec = (c, a, o) => {
    const out = svc.exec(c, a, o)
    return /slack_send_message/.test(a[2] ?? "") ? { ...out, stdout: JSON.stringify({ output: { output: { ts: "1" }, text: "ok" } }) } : out
  }
  assert.throws(() => seed(s, { manifest: m, exec }), /too weak to be a canary/)
  assert.equal(existsSync(join(s.store, "canaries.json")), false)
})

test("a find descends the tools-RPC {output:{output,text}} envelope: every kind reuses on a rerun, and a created id is recorded", (t) => {
  const s = setup(t)
  const svc = fake({ profile: s.profile })
  const first = seedCanaries({ manifest: FIVE, store: s.store, profile: s.profile, env: s.env, exec: svc.exec })
  assert.deepEqual(first.created, FIVE.canaries.map((c) => c.name))
  assert.deepEqual(first.reused, [])
  assert.equal(svc.entities.length, 5)
  const book = canariesOf(s)
  const kindOf = { linear_issue: "issue", linear_document: "document", linear_milestone: "milestone", linear_issue_label: "issue_label", linear_project_label: "project_label" }
  for (const [name, kind] of Object.entries(kindOf)) {
    const entity = svc.entities.find((e) => e.kind === kind)
    assert.equal(book._ids[name], entity.id, `${name} records the id its create answer returned inside the envelope`)
  }
  // The rerun finds each one inside the envelope: no create, no duplicate.
  const again = seedCanaries({ manifest: FIVE, store: s.store, profile: s.profile, env: s.env, exec: svc.exec })
  assert.deepEqual(again.created, [])
  assert.deepEqual(again.reused, FIVE.canaries.map((c) => c.name))
  assert.equal(svc.entities.length, 5, "nothing duplicated")
  assert.deepEqual(canariesOf(s), book)
})

test("a find answer without the items list is refused, never turned into a create", (t) => {
  const s = setup(t)
  const svc = fake({ profile: s.profile })
  const one = { ...MANIFEST, canaries: [MANIFEST.canaries[0]] }
  const answer = (value) => (c, a, o) => /\/list_issues$/.test(a[2] ?? "") ? { code: 0, stdout: JSON.stringify({ output: { output: value, text: "" } }), stderr: "" } : svc.exec(c, a, o)
  assert.throws(() => seedCanaries({ manifest: one, store: s.store, profile: s.profile, env: s.env, exec: answer({}) }), /has no issues list: the seed does not understand this answer/)
  assert.equal(svc.entities.length, 0, "no create")
  assert.equal(existsSync(join(s.store, "canaries.json")), false)
  assert.equal(svc.deleted.length, 1, "the session is deleted on the failing path")
  assert.equal(svc.sessions.size, 0)
  // A value at the path that is not a list is an answer shape the seed does not understand either.
  assert.throws(() => seedCanaries({ manifest: one, store: s.store, profile: s.profile, env: s.env, exec: answer({ issues: {} }) }), /is not a list: the seed does not understand this answer/)
  assert.equal(svc.entities.length, 0)
})

test("the one seeding session is deleted on success and on failure, and a failed delete is reported", (t) => {
  const s = setup(t)
  const svc = fake({ profile: s.profile })
  const out = seed(s, { exec: svc.exec })
  assert.equal(out.leftover, undefined)
  assert.deepEqual(svc.deleted, ["ses_1"])
  assert.equal(svc.sessions.size, 0)
  assert.equal(svc.made.length, 1, "one session made, one deleted")
  // A session that cannot be deleted is named in the result, as the walk's withCheckSession does.
  const s2 = setup(t)
  const svc2 = fake({ profile: s2.profile })
  const noDelete = (c, a, o) => a[0] === "api" && a[1] === "delete" ? { code: 1, stdout: "", stderr: "delete failed" } : svc2.exec(c, a, o)
  assert.equal(seed(s2, { exec: noDelete }).leftover, "ses_1")
  // And when the seeding already failed, the undeleted session is the error that is raised.
  const s3 = setup(t)
  const svc3 = fake({ profile: s3.profile })
  const badAndNoDelete = (c, a, o) => {
    if (/\/list_issues$/.test(a[2] ?? "")) return { code: 0, stdout: JSON.stringify({ output: { output: {}, text: "" } }), stderr: "" }
    if (a[0] === "api" && a[1] === "delete") return { code: 1, stdout: "", stderr: "delete failed" }
    return svc3.exec(c, a, o)
  }
  assert.throws(() => seedCanaries({ manifest: { ...MANIFEST, canaries: [MANIFEST.canaries[0]] }, store: s3.store, profile: s3.profile, env: s3.env, exec: badAndNoDelete }), /could not be deleted/)
})
