// `evals compile` refuses a prompt with a literal `<placeholder>` in it (104 lane cases had them), unless the prompt really quotes angle brackets and says so.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
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
  for (const plugin of ["x", "history", "charts"]) {
    for (const file of readdirSync(join(ROOT, "cases", plugin)).filter((f) => f.endsWith(".md"))) {
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
  // the list is the corpus as it stood: every committed case of the three plugins, and nothing else
  for (const plugin of ["history", "x", "charts"]) {
    const files = readdirSync(join(ROOT, "cases", plugin)).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")).sort()
    assert.deepEqual(legacy.cases[plugin], files, `${plugin}: the list is the corpus`)
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
