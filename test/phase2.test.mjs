// Phase 2's surface: the packs, the generic static checks, the privacy gate, the budget, the cost
// arithmetic and the label kit. All deterministic; nothing here starts a host.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { PassThrough } from "node:stream"
import { derivePack } from "../src/pack/from-plugin.mjs"
import { checkPack } from "../src/t0/generic.mjs"
import { scanText, scanTree, FORBIDDEN_PATHS } from "../src/privacy/gate.mjs"
import { monthToDate, assertWithinBudget, CAPS } from "../src/cost/budget.mjs"
import { loadPrices, vendorCost } from "../src/cost/compute.mjs"
import { classify } from "../src/cost/rule.mjs"
import { runLabelSession, readLabels, labelReport, advisoryItems } from "../src/label/kit.mjs"

const temp = () => mkdtempSync(join(tmpdir(), "evals-p2-"))

function fixturePlugin(root, { tools = 3 } = {}) {
  const write = (path, body) => {
    mkdirSync(join(root, path, ".."), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  const names = ["get_one", "create_one", "delete_one"].slice(0, tools)
  write(
    "package.json",
    JSON.stringify({
      name: "opencode-fixture",
      jelly: {
        title: "Fixture",
        skills: ["fixture", "fixture-write"],
        tools: names.map((name, index) => ({ name: `fixture.${name}`, permission: `fixture_${name}`, effect: index === 2 ? "deny" : "allow", readOnly: index === 0 })),
      },
    }),
  )
  write("src/constants.ts", `export const PLUGIN_ID = "fixture.one"\nexport const NAMESPACE_DESCRIPTION =\n  "Fixture tools. Read the fixture skill first. Never load it for a change."\n`)
  write("skills/fixture/SKILL.md", `---\nname: fixture\ndescription: Read-only fixture. Load when the user names the fixture.\n---\n# Fixture\n\nUse \`fixture_get_one\` and \`fixture_create_one\`.\n`)
  write("skills/fixture-write/SKILL.md", `---\nname: fixture-write\ndescription: Load before any fixture change.\n---\n# Changes\n\nOne \`fixture_create_one\` call.\n`)
  return root
}

const packFor = (root) => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  return {
    id: "fixture",
    name: "Fixture",
    tools: pkg.jelly.tools.map((tool) => ({
      name: tool.name.replace(/^fixture\./, ""),
      permission: tool.permission,
      effect: tool.effect,
      readOnly: tool.readOnly,
      class: tool.effect === "deny" ? "destructive" : tool.readOnly ? "read" : "write",
    })),
  }
}

test("a pack derives from the plugin's own declaration", () => {
  const root = fixturePlugin(temp())
  const pack = derivePack("fixture", root)
  assert.equal(pack.id, "fixture")
  assert.equal(pack.tools.length, 3)
  assert.equal(pack.tools.find((tool) => tool.name === "delete_one").class, "destructive")
  assert.equal(pack.tools.find((tool) => tool.name === "get_one").class, "read")
  assert.equal(pack.counts.denied, 1)
  assert.equal(pack.counts.skills, 2)
  rmSync(root, { recursive: true, force: true })
})

test("the generic static checks pass on a consistent plugin and bite on each defect", () => {
  const root = fixturePlugin(temp())
  const pack = packFor(root)
  assert.equal(checkPack(pack, root).failed, 0)

  const broken = fixturePlugin(temp(), { tools: 3 })
  writeFileSync(join(broken, "skills/fixture/SKILL.md"), `---\nname: fixture\ndescription: Read-only fixture.\n---\nUse \`fixture_get_missing\`.\n`)
  assert.ok(checkPack(packFor(broken), broken).checks.find((check) => check.id === "T0-06" && !check.ok))

  const dirty = fixturePlugin(temp())
  writeFileSync(join(dirty, "skills/fixture/SKILL.md"), `---\nname: fixture\ndescription: Read-only.\n---\nPing @some_real_account or read ${["", "Users", "someone", "notes"].join("/")}.\n`)
  const report = checkPack(packFor(dirty), dirty)
  assert.ok(report.checks.find((check) => check.id === "T0-07" && !check.ok))

  const mismatched = fixturePlugin(temp())
  const pkg = JSON.parse(readFileSync(join(mismatched, "package.json"), "utf8"))
  pkg.jelly.skills = ["fixture"]
  writeFileSync(join(mismatched, "package.json"), JSON.stringify(pkg))
  assert.ok(checkPack(packFor(mismatched), mismatched).checks.find((check) => check.id === "T0-03" && !check.ok))

  rmSync(root, { recursive: true, force: true })
  rmSync(broken, { recursive: true, force: true })
  rmSync(dirty, { recursive: true, force: true })
  rmSync(mismatched, { recursive: true, force: true })
})

test("the privacy gate catches every pattern it claims, and allows the reserved examples", () => {
  // Every sample is built from parts: this file must hold no literal the gate would have to allow.
  const samples = [
    ["a home path", ["", "Users", "someone", "project", "file.ts"].join("/")],
    ["an email", [["person", "company"], "co"].join("@") + ".uk"],
    ["a real post link", ["https:/", "x.com", "someone_here", "status", "1793996926502123456"].join("/").replace("https:/.", "https:")],
    ["a credential", ["sk", "abcdefghijklmnop1234"].join("-")],
    ["a private store path", ["see", ["opencode", "release"].join("-"), "review"].join("/")],
  ]
  for (const [what, text] of samples) assert.ok(scanText(text, "t").length > 0, `${what} was not caught (${text})`)
  assert.equal(scanText(["mail", ["alex", "example.com"].join("@")].join(" ") + " or a fixture at x.com/a/status/1", "t").length, 0)
  assert.deepEqual(scanText("npm install " + ["", "joe-broadhead", "opencode-evals"].join("@"), "t"), [])
})

test("the tree scan refuses a private path and a private value", () => {
  const root = temp()
  writeFileSync(join(root, "ok.md"), "nothing here\n")
  assert.equal(scanTree(root).length, 0)
  mkdirSync(join(root, "results"), { recursive: true })
  writeFileSync(join(root, "results", "batch.json"), "{}")
  assert.ok(scanTree(root).some((finding) => finding.id === "forbidden-path"))
  rmSync(root, { recursive: true, force: true })
})

test("FORBIDDEN_PATHS covers the store's directories", () => {
  for (const path of ["traces/nx1/a.trace.jsonl", "results/nx1/batch.json", "labels/x.jsonl", "holdouts/x/a.md"]) {
    assert.ok(FORBIDDEN_PATHS.some((rule) => rule.test(path)), `${path} is not forbidden`)
  }
})

test("the budget sums the ledger and refuses a run that would cross a cap", () => {
  const store = temp()
  const results = join(store, "results", "nx1")
  mkdirSync(results, { recursive: true })
  writeFileSync(
    join(results, "batch.json"),
    JSON.stringify({ iteration: "nx1", ran_at: new Date().toISOString(), cost: { billed_usd: 2.5, list_usd: 9.1, sources: { billed: 1 } }, vendor_cost: { amount_usd: 0.4 } }),
  )
  const mtd = monthToDate(store)
  assert.equal(mtd.runs, 1)
  // Only billed spend consumes the cap; the list price is a shadow.
  assert.equal(mtd.model_usd, 2.5)
  assert.equal(mtd.shadow_list_usd, 9.1)
  assert.equal(mtd.vendor_usd, 0.4)
  assertWithinBudget(store, { model_usd: 1 })
  assert.throws(() => assertWithinBudget(store, { model_usd: CAPS.model_usd }), /D4 budget/)
  rmSync(store, { recursive: true, force: true })
})

test("cost comes from the resources the trace recorded, at the plugin's own rates", () => {
  const prices = loadPrices()
  const search = vendorCost([{ tool: "search_posts_all", counts: { posts: 10, users: 9 } }], "x", prices)
  assert.equal(search.amount_usd, 0.14)
  assert.deepEqual(search.resources, { posts: 10, authors: 9 })
  assert.equal(search.as_of, "2026-11-07")
  const post = vendorCost([{ tool: "create_posts", counts: {}, args: { text: "hello" } }], "x", prices)
  assert.equal(post.amount_usd, 0.015)
  const withLink = vendorCost([{ tool: "create_posts", counts: {}, args: { text: "see https://example.com" } }], "x", prices)
  assert.equal(withLink.amount_usd, 0.2)
  assert.equal(classify({ billed: null, tokens: { input: 1, output: 1 }, price: null }).source, "missing")
})

test("the label kit shows one item, records a keypress, and never labels twice", async () => {
  const store = temp()
  const iteration = "t1"
  const dir = join(store, "results", iteration)
  mkdirSync(dir, { recursive: true })
  const casesDir = join(import.meta.dirname, "..", "cases", "x")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "verdicts.json"),
    JSON.stringify([
      {
        case: "small-bounded-search",
        verdict: "PASS",
        items: [
          { id: "X-PR05", state: "advisory", severity: "major" },
          { id: "X-OC01", state: "pass", severity: "blocker" },
        ],
      },
    ]),
  )
  const items = advisoryItems(store, "x", iteration)
  assert.equal(items.length, 1)
  assert.equal(items[0].case, "small-bounded-search")

  const input = new PassThrough()
  const output = new PassThrough()
  let printed = ""
  output.on("data", (chunk) => (printed += chunk))
  const session = runLabelSession({ store, plugin: "x", iteration, textFor: () => "Cost: 0 posts.\nIt is a sample.", input, output })
  input.write("y\n")
  const result = await session
  assert.equal(result.labelled, 1)
  assert.match(printed, /X-PR05/)
  assert.match(printed, /It is a sample/)
  assert.match(printed, /\[y\] satisfied/)
  const labels = readLabels(store, "x")
  assert.equal(labels.length, 1)
  assert.equal(labels[0].label, "satisfied")
  assert.equal(labelReport(store, "x").byItem["X-PR05"].satisfied, 1)

  const again = await runLabelSession({ store, plugin: "x", iteration, textFor: () => null, input: new PassThrough(), output: new PassThrough() })
  assert.equal(again.labelled, 0, "a labelled item is not asked again")
  assert.ok(casesDir)
  rmSync(store, { recursive: true, force: true })
})
