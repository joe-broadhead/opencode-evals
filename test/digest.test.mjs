import { test } from "node:test"
import assert from "node:assert/strict"
import { canonical, digestOf, sha256, short } from "../src/util/canonical.mjs"

test("canonical JSON sorts keys and drops undefined", () => {
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }))
  assert.equal(canonical({ a: undefined, b: 1 }), '{"b":1}')
  assert.equal(canonical({ a: [2, 1] }), '{"a":[2,1]}', "array order is data")
})

test("a digest is stable and order-insensitive at the key level only", () => {
  assert.equal(digestOf({ x: 1, y: [1, 2] }), digestOf({ y: [1, 2], x: 1 }))
  assert.notEqual(digestOf({ y: [1, 2] }), digestOf({ y: [2, 1] }))
  assert.equal(sha256("abc").length, 64)
  assert.equal(short("abcdef123456789", 6), "abcdef")
})
