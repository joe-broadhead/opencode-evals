// `evals compile` refuses a prompt with a literal `<placeholder>` in it (104 lane cases had them), unless the prompt really quotes angle brackets and says so.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { compileCase, angleTokens } from "../src/case/compile.mjs"

const ROOT = join(import.meta.dirname, "..")
const text = (prompt, { header = "", plugin = "slack", id = "tools-read-a", set = "wide" } = {}) =>
  `# ${id}\n- Plugin: ${plugin}\n- Skill under test: ${plugin}\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: seeded\n- Set: ${set}\n${header}\n## Prompt\n${prompt}\n\n## Items\n- [SLK-OC01] major · It answers.\n  evidence: text:any matches /./\n`
const compile = (prompt, options) => compileCase(`cases/slack/${options?.id ?? "tools-read-a"}.md`, text(prompt, options))

test("a literal <placeholder> in a prompt is a compile error that names it and says what to write instead", () => {
  for (const prompt of ["look at <github sandbox repo> please", "post in <your channel>", "what is in <X test topic: a harmless topic>", "see <ENG-123>", "mail <jo@example.org>"]) {
    assert.throws(() => compile(prompt), /the prompt has a literal placeholder: <.+>\. Write the value, or use \{\{target:<plugin>\.<name>\}\} \/ \{\{canary:<name>\}\}/, prompt)
  }
  assert.throws(() => compile("first <one thing> then <another>"), /placeholder: <one thing> <another>/, "every distinct one, up to four")
  assert.throws(() => compile("post in <the channel> and <the channel>"), /placeholder: <the channel>\./, "once")
})

test("what is not a placeholder compiles: comparisons, arrows, the store's own {{...}} fills, ordinary prose", () => {
  for (const prompt of ["is 3 < 5 and 7 > 2", "values a<=3 and b>=2", "x < y and y > z", "a -> b and c => d", "post in {{target:slack.sandbox_channel}} the word {{canary:slack_word}}", "the rate is 5%\nsecond line with a > b", "a <\n b>"]) {
    assert.doesNotThrow(() => compile(prompt), prompt)
  }
  assert.deepEqual(angleTokens("a < b and c > d"), [])
  assert.deepEqual(angleTokens("one <two> and <three four>"), ["<two>", "<three four>"])
  assert.deepEqual(angleTokens("<<TODO write this>>"), [], "a skeleton's TODO has its own error")
  assert.throws(() => compile("<<TODO write the task>>"), /still a skeleton's <<TODO>>/)
})

test("a prompt that really quotes angle brackets lists each token in `Angle brackets:`; a token it lists must be in the prompt, and an unlisted one is still refused", () => {
  const html = "wrap the title in <h1> and </h1> tags, nothing else"
  assert.throws(() => compile(html), /placeholder: <h1> <\/h1>/)
  const c = compile(html, { header: "- Angle brackets: <h1>, </h1>\n" })
  assert.equal(c.prompt, html)
  assert.throws(() => compile(`${html} and <b>`, { header: "- Angle brackets: <h1>, </h1>\n" }), /placeholder: <b>/, "one unlisted among the listed")
  assert.throws(() => compile("no brackets here", { header: "- Angle brackets: <h1>\n" }), /lists <h1>, which the prompt does not contain/)
  assert.throws(() => compile("a <github sandbox repo> and <h1>", { header: "- Angle brackets: <h1>\n" }), /placeholder: <github sandbox repo>/)
})

test("the History, X and Charts corpora written before the round are left as they are: their <X test ...> gaps are filled from their own worlds", () => {
  let seen = 0
  // the LEGACY cases only (the frozen list): a case a later pull request adds to these directories is a new case, and meets every rule (it is not read here)
  const legacyList = JSON.parse(readFileSync(join(ROOT, "src", "case", "legacy-cases.json"), "utf8"))
  for (const plugin of ["x", "history", "charts"]) {
    for (const id of legacyList.cases[plugin]) {
      const file = `${id}.md`
      const source = readFileSync(join(ROOT, "cases", plugin, file), "utf8")
      if (angleTokens(source.split("## Prompt")[1]?.split("##")[0] ?? "").length) seen++
      assert.doesNotThrow(() => compileCase(`cases/${plugin}/${file}`, source), `${plugin}/${file}`)
    }
  }
  assert.ok(seen > 0, "the corpus really holds prompts with a <gap>; the exemption is exercised")
  // but a round case of the same plugin is not exempt
  assert.throws(() => compileCase("cases/x/tools-a.md", text("search <X test topic>", { plugin: "x", id: "tools-a" })), /literal placeholder/)
})

test("the legacy exemption is a frozen list of case ids, not a rule about the plugin: a new History, X or Charts case meets every round rule, and p0 is no plugin to hide behind", () => {
  const legacy = JSON.parse(readFileSync(join(ROOT, "src", "case", "legacy-cases.json"), "utf8"))
  // The list is the exemption set and nothing but that: sorted, with no duplicate, and every listed case is still in the corpus (a legacy case may not be deleted and its exemption
  // quietly reused). It is NOT "every file of the directory": a case a later pull request adds to history, x or charts is new, is not in the list, and must meet every rule.
  const sizes = { history: 83, x: 14, charts: 15 }
  for (const plugin of ["history", "x", "charts"]) {
    const ids = legacy.cases[plugin]
    assert.deepEqual([...ids].sort(), ids, `${plugin}: sorted`)
    assert.equal(new Set(ids).size, ids.length, `${plugin}: no duplicate`)
    assert.equal(ids.length, sizes[plugin], `${plugin}: the exemption set is frozen at the corpus as it stood (a change to it is a reviewed change)`)
    const files = new Set(readdirSync(join(ROOT, "cases", plugin)).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")))
    assert.deepEqual(ids.filter((id) => !files.has(id)), [], `${plugin}: every listed case is still in the corpus`)
  }
  assert.equal(legacy.cases.p0, undefined)
  const body = (plugin, id, extra = "") => `# ${id}\n- Plugin: ${plugin}\n- Skill under test: ${plugin}\n- Tier: T3\n- Source: t\n- Decision tested: x\n${extra}\n## Prompt\nsearch <X test topic> and <another gap>\n\n## Items\n- [XX-OC01] major · It answers.\n  evidence: text:any matches /./\n`
  // the reviewer's cases: a brand-new x, history and charts case with no Set, no Data and two <placeholders> used to compile
  for (const plugin of ["x", "history", "charts"]) {
    assert.throws(() => compileCase(`cases/${plugin}/brand-new.md`, body(plugin, "brand-new")), /Data is required|literal placeholder/, `a new ${plugin} case`)
    assert.throws(() => compileCase(`cases/${plugin}/brand-new.md`, body(plugin, "brand-new", "- Data: synthetic\n")), /literal placeholder/, `a new ${plugin} case with a Data but a placeholder`)
  }
  // p0 is the harness's own probes: it has to declare its data like anyone, and its prompt is checked
  assert.throws(() => compileCase("cases/p0/shell-curl.md", body("p0", "shell-curl")), /Data is required|literal placeholder/)
  assert.throws(() => compileCase("cases/p0/shell-curl.md", body("p0", "shell-curl", "- Data: synthetic\n")), /literal placeholder/)
  // a listed case is as it was; the same id in a round set is not exempt
  const firstX = legacy.cases.x.find((id) => /<X test/.test(readFileSync(join(ROOT, "cases", "x", `${id}.md`), "utf8").split("## Prompt")[1]?.split("##")[0] ?? ""))
  assert.ok(firstX, "an x case with a gap")
  assert.doesNotThrow(() => compileCase(`cases/x/${firstX}.md`, readFileSync(join(ROOT, "cases", "x", `${firstX}.md`), "utf8")))
  assert.throws(() => compileCase(`cases/x/${firstX}.md`, readFileSync(join(ROOT, "cases", "x", `${firstX}.md`), "utf8").replace("\n## Prompt", "\n- Set: deep\n\n## Prompt")), /a case in set deep has an id like deep-<slug>|Data is required|placeholder/)
  // an id not in the list is new, however it is spelt like an old one
  assert.throws(() => compileCase(`cases/x/${firstX}-v2.md`, readFileSync(join(ROOT, "cases", "x", `${firstX}.md`), "utf8").replace(`# ${firstX}`, `# ${firstX}-v2`)), /Data is required|literal placeholder/)
})

test("a case ADDED to the history, x or charts corpus does not break the frozen list, is not exempt (a `<…>` placeholder is refused, a clean one compiles), and the legacy cases stay exempt", () => {
  const legacy = JSON.parse(readFileSync(join(ROOT, "src", "case", "legacy-cases.json"), "utf8"))
  const dir = mkdtempSync(join(tmpdir(), "evals-legacy-"))
  try {
    for (const plugin of ["history", "x", "charts"]) {
      mkdirSync(join(dir, plugin))
      for (const file of readdirSync(join(ROOT, "cases", plugin)).filter((f) => f.endsWith(".md"))) writeFileSync(join(dir, plugin, file), readFileSync(join(ROOT, "cases", plugin, file)))
    }
    // a new charts case, as a case lane adds one, in the copied corpus: with a placeholder, and a clean one
    const newCase = (id, prompt) => `# ${id}\n- Plugin: charts\n- Skill under test: charts\n- Tier: T3\n- Source: t\n- Decision tested: x\n- Data: synthetic\n- Set: wide\n\n## Prompt\n${prompt}\n\n## Items\n- [C-OC01] major · It draws.\n  evidence: absent:execute\n`
    writeFileSync(join(dir, "charts", "tools-new-gap.md"), newCase("tools-new-gap", "draw a chart of <X test sales> by region"))
    writeFileSync(join(dir, "charts", "tools-new-clean.md"), newCase("tools-new-clean", "draw a bar chart of sales by region"))
    // the list still describes only the legacy cases: every listed case is in the copied corpus, and the new ones are not listed
    const files = new Set(readdirSync(join(dir, "charts")).map((f) => f.replace(/\.md$/, "")))
    assert.deepEqual(legacy.cases.charts.filter((id) => !files.has(id)), [])
    assert.equal(legacy.cases.charts.includes("tools-new-gap") || legacy.cases.charts.includes("tools-new-clean"), false)
    assert.ok(files.has("tools-new-gap") && files.has("tools-new-clean"), "the added cases are in the corpus the check reads")
    // the new case with a placeholder is refused; the clean one compiles; neither is exempt
    assert.throws(() => compileCase("cases/charts/tools-new-gap.md", readFileSync(join(dir, "charts", "tools-new-gap.md"), "utf8")), /literal placeholder: <X test sales>/)
    assert.doesNotThrow(() => compileCase("cases/charts/tools-new-clean.md", readFileSync(join(dir, "charts", "tools-new-clean.md"), "utf8")))
    // the legacy cases of the same corpus stay exempt, gaps and all
    for (const id of legacy.cases.charts) assert.doesNotThrow(() => compileCase(`cases/charts/${id}.md`, readFileSync(join(dir, "charts", `${id}.md`), "utf8")), id)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
