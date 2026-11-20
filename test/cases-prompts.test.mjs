// A prompt must never carry a literal `<…>` placeholder.
//
// A model either asks the user for the value — the right behaviour — and fails the case's `count:… >= 1` blocker, or it
// passes the literal text, which satisfies every `args.<field> present` item. Either way the case does not measure the
// tool. The value belongs in the private store as a `{{target:<alias>}}`, or in the prompt as a concrete invented value
// that an outcome item then checks.
//
// This belongs in the harness, as part of `evals compile`: the prompts are right there, every lane gets it, and a case
// that cannot run should never be committed. It sits here until the harness takes it, because the case lanes do not
// change `src/case/`.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const PLACEHOLDER = /<[^<>\n]{1,120}>/

test("no case prompt carries a literal <…> placeholder", () => {
  const bad = []
  const dir = join(ROOT, "cases")
  for (const plugin of readdirSync(dir)) {
    const at = join(dir, plugin)
    if (!existsSync(at)) continue
    for (const file of readdirSync(at).filter((name) => name.endsWith(".json"))) {
      const one = JSON.parse(readFileSync(join(at, file), "utf8"))
      const hit = PLACEHOLDER.exec(String(one.prompt ?? ""))
      if (hit) bad.push(`${plugin}/${file}: ${hit[0]}`)
    }
  }
  assert.deepEqual(bad, [], `a prompt with a literal placeholder cannot measure its tool:\n  ${bad.join("\n  ")}`)
})

test("the guard catches a placeholder and leaves a filled prompt alone", () => {
  assert.match("read <the broadcast id> and tell me", PLACEHOLDER)
  assert.match("what does <a post URL> say?", PLACEHOLDER)
  assert.doesNotMatch("read {{target:x.broadcast}} and tell me", PLACEHOLDER)
  assert.doesNotMatch("what are people posting about sourdough baking this week?", PLACEHOLDER)
})
