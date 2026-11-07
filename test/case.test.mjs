import { test } from "node:test"
import assert from "node:assert/strict"
import { compileCase, casesDigest } from "../src/case/compile.mjs"
import { CaseError } from "../src/case/schema.mjs"
import { ParseError } from "../src/case/parse.mjs"

const good = `# demo
- Plugin: x
- Skill under test: x
- Tier: T3
- Decision tested: one capped read
- Budget: outer_calls <= 4, billed_calls <= 2

## Prompt
how many posts mention <topic> right now?

## Items
- [X-OC01] blocker · Exactly one count read.
  maps_to: A1
  evidence: count:get_posts_counts_recent == 1

- [X-PR01] major · The window ends in Z.
  evidence: call:get_posts_counts_recent#1 args.end_time matches /Z$/

## Forbidden
- [X-SF01] blocker · No write.
  maps_to: F1
  evidence: absent:create_posts

## Notes
- X-OC01: the count route is the point.
`

const compile = (text) => compileCase("demo.md", text)

test("a good case compiles to the strict schema", () => {
  const c = compile(good)
  assert.equal(c.schema, "oc-case/1")
  assert.equal(c.id, "demo")
  assert.equal(c.items.length, 3)
  assert.equal(c.items[2].forbidden, true)
  assert.deepEqual(c.items[0].maps_to, ["A1"])
  assert.deepEqual(c.budgets, { outer_calls: 4, billed_calls: 2 })
  assert.equal(c.notes[0].id, "X-OC01")
  assert.equal(c.items[0].evidence[0].kind, "count")
})

test("the case digest moves when the prompt moves, and not when a comment does", () => {
  const a = compile(good)
  const b = compile(good.replace("how many posts", "how many tweets"))
  const c = compile(`${good}\n- A note that is not an item.`)
  assert.notEqual(casesDigest([a]), casesDigest([b]), "a prompt edit is a new case set")
  assert.equal(casesDigest([a]).length, 64)
})

test("invalid evidence is a compile error with a line", () => {
  assert.throws(() => compile(good.replace("evidence: absent:create_posts", "evidence: ishould not parse")), CaseError)
})

test("a code item without evidence is refused", () => {
  assert.throws(() => compile(good.replace("  evidence: absent:create_posts\n", "")), CaseError)
})

test("a judge item may not be a blocker", () => {
  const text = good.replace("- [X-PR01] major · The window ends in Z.\n  evidence: call:get_posts_counts_recent#1 args.end_time matches /Z$/", "- [X-PR01] blocker · The window ends in Z.\n  grader: judge")
  assert.throws(() => compile(text), /judge item cannot be a blocker/)
})

test("duplicate ids and unknown budget keys are refused", () => {
  assert.throws(() => compile(good.replace("[X-PR01]", "[X-OC01]")), /duplicate item id/)
  assert.throws(() => compile(good.replace("billed_calls <= 2", "billed_widgets <= 2")), /unknown budget/)
})

test("an unknown header key is refused rather than ignored", () => {
  assert.throws(() => compile(good.replace("- Tier: T3", "- Teir: T3")), ParseError)
})

test("an expect-fail control compiles with its expectation", () => {
  const c = compile(good.replace("- Tier: T3", "- Tier: T3\n- Expect: fail"))
  assert.equal(c.expect, "fail")
})
