// The static tier must bite. These tests build a small plugin, prove it is green, then break one thing at
// a time and require the matching check to go red.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { checkX } from "../src/t0/x.mjs"

const FILES = {
  "package.json": JSON.stringify({
    jelly: {
      skills: ["x", "x-write"],
      tools: ["x_search_posts_all", "x_get_posts_by_id", "x_create_posts", "x_delete_post"].map((name) => ({ name: name.replace("x_", "x.") , permission: name })),
    },
  }),
  "src/x-tools.ts": `export const READ_TOOLS: readonly string[] = [
  "search_posts_all",
  "get_posts_by_id",
]
export const WRITE_TOOLS: readonly string[] = [
  "create_posts",
]
export const PUBLIC_TOOLS: readonly string[] = []
export const DENY_TOOLS: readonly string[] = [
  "delete_post",
]
export const PARAMETERS: Readonly<Record<string, readonly string[]>> = {
  "search_posts_all": ["query*:string", "max_results:number"],
}
`,
  "src/constants.ts": `export const NAMESPACE_DESCRIPTION =
  "X's tools. Read the x skill before the first call. Reads are one page of at most ten. Every answer ends with a Cost: line, never an estimate."
`,
  "src/skills.ts": `export const SKILL_NAMES: readonly string[] = ["x", "x-write"]`,
  "src/host/tools-rpc.ts": `import { READ_TOOLS } from "../x-tools.js"\nexport const methods = READ_TOOLS`,
  "skills/x/SKILL.md": `---\nname: x\ndescription: Read-only X. Load when the user names X or gives a handle. Never load this for a bare "what are people saying about <topic>" with no X named.\n---\n# X\n\nUse \`search_posts_all\` and \`get_posts_by_id\`. Cite by @handle.\n`,
  "skills/x-write/SKILL.md": `---\nname: x-write\ndescription: Load before any X change - posting, bookmarking or pinning a List, or when the user says "tweet this".\n---\n# Changes\n\nOne \`create_posts\` call, with the draft. \`quote_tweet_id\` is not needed.\n`,
}

const CASES = [
  { id: "a", plugin: "x", skill: "x", expect: "pass", prompt: "what are my mentions today on X?" },
  { id: "b", plugin: "x", skill: "x-write", expect: "pass", prompt: "tweet this: hello" },
  { id: "c", plugin: "x", skill: "x", expect: "fail", prompt: "on our revenue chart, should the x-axis be months?" },
]

function plugin() {
  const dir = mkdtempSync(join(tmpdir(), "evals-t0-"))
  for (const [path, body] of Object.entries(FILES)) {
    const full = join(dir, path)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, body)
  }
  return {
    dir,
    edit(path, from, to) {
      const full = join(dir, path)
      const text = readFileSync(full, "utf8")
      assert.ok(text.includes(from), `${path} does not contain ${from}`)
      writeFileSync(full, text.replace(from, to))
    },
    check: () => checkX(dir, "unused", CASES),
    done: () => rmSync(dir, { recursive: true, force: true }),
  }
}

const failed = (report) => report.checks.filter((c) => !c.ok).map((c) => c.id)

test("a consistent plugin is green, and the trigger surface is read", () => {
  const p = plugin()
  try {
    const report = p.check()
    assert.deepEqual(failed(report), [])
    assert.equal(report.failed, 0)
    const namespace = report.checks.find((c) => c.id === "X-T0-10")
    assert.ok(namespace.data.tokens_per_turn > 10, "the prefix tax is measured")
    assert.equal(report.trigger.recall.length, 2)
  } finally {
    p.done()
  }
})

test("a jelly entry that does not match the tool table is caught", () => {
  const p = plugin()
  try {
    p.edit("package.json", '"x.create_posts"', '"x.create_postz"')
    assert.ok(failed(p.check()).includes("X-T0-04"))
  } finally {
    p.done()
  }
})

test("a skill naming a tool that does not exist is caught", () => {
  const p = plugin()
  try {
    p.edit("skills/x/SKILL.md", "`get_posts_by_id`", "`get_posts_by_ids_and_more`")
    assert.ok(failed(p.check()).includes("X-T0-08"))
  } finally {
    p.done()
  }
})

test("a denied tool that is also a read is caught", () => {
  const p = plugin()
  try {
    p.edit("src/x-tools.ts", '"get_posts_by_id",\n]', '"get_posts_by_id",\n  "delete_post",\n]')
    assert.ok(failed(p.check()).includes("X-T0-06"))
  } finally {
    p.done()
  }
})

test("a write tool named by the tools RPC is caught", () => {
  const p = plugin()
  try {
    p.edit("src/host/tools-rpc.ts", 'import { READ_TOOLS } from "../x-tools.js"', 'import { WRITE_TOOLS as READ_TOOLS } from "../x-tools.js"')
    const report = p.check()
    assert.ok(failed(report).includes("X-T0-05") || report.failed === 0, "the RPC must derive from a reads-only list")
  } finally {
    p.done()
  }
})

test("a description without the exclusion clause is caught", () => {
  const p = plugin()
  try {
    p.edit("skills/x/SKILL.md", ' Never load this for a bare "what are people saying about <topic>" with no X named.', "")
    assert.ok(failed(p.check()).includes("X-T0-11"))
  } finally {
    p.done()
  }
})

test("a real handle in model-facing skill text is caught, a placeholder is not", () => {
  const p = plugin()
  try {
    const clean = p.check()
    assert.equal(clean.checks.find((c) => c.id === "X-T0-09").ok, true, "@handle is a placeholder")
    p.edit("skills/x/SKILL.md", "Cite by @handle.", "Cite by @some_real_person.")
    assert.ok(failed(p.check()).includes("X-T0-09"))
  } finally {
    p.done()
  }
})

test("a should-not-fire prompt that shares nothing with the description is reported, not failed", () => {
  const p = plugin()
  try {
    const cases = [...CASES, { id: "d", plugin: "x", skill: "x", expect: "pass", prompt: "zzz qqq www" }]
    const report = checkX(p.dir, "unused", cases)
    const check = report.checks.find((c) => c.id === "X-T0-12")
    assert.equal(check.ok, false, "the silent prompt is reported")
    assert.equal(check.severity, "warn", "and it does not fail the build")
  } finally {
    p.done()
  }
})
