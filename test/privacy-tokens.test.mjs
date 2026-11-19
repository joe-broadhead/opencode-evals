// G0 review 3.5: the privacy scan catches the token shapes a vendor issues. Each gold string is assembled here from pieces, so this
// file holds no token itself; a normal hex digest is not flagged, and an obviously made-up value (a fixture) is not either.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { scanText, TOKEN_SHAPES } from "../src/privacy/gate.mjs"

const r = (n, alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") => {
  // deterministic, random-looking, and never holding a run the scan reads as made-up
  let out = ""
  let h = createHash("sha256").update(String(n) + alphabet.length).digest()
  while (out.length < n) {
    for (const byte of h) out += alphabet[byte % alphabet.length]
    h = createHash("sha256").update(h).digest()
  }
  return out.slice(0, n)
}
const URLSAFE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
const gold = {
  "token-anthropic": [`sk-ant-oat01-${r(40, URLSAFE)}`, `sk-ant-api03-${r(40, URLSAFE)}`, `sk-ant-ort01-${r(40, URLSAFE)}`],
  "token-sk": [`sk-proj-${r(40, URLSAFE)}`, `sk-or-v1-${r(48)}`],
  "credential": [`sk-${r(40)}`, `ghp_${r(36)}`, `xoxb-${r(12, "0123456789")}-${r(24)}`],
  "token-slack": [`xoxp-${r(12, "0123456789")}-${r(12, "0123456789")}-${r(24)}`, `xoxe.xoxp-1-${r(48)}`, `xoxa-2-${r(30)}`, `xapp-1-A0${r(20)}-${r(30)}`],
  "token-github": [`gho_${r(36)}`, `ghu_${r(36)}`, `ghs_${r(36)}`, `ghr_${r(36)}`, `github_pat_${r(22)}_${r(40)}`],
  "token-google": [`ya29.${r(60, URLSAFE)}`, `1//0${r(50, URLSAFE)}`],
  "token-jwt": [`eyJ${r(20, URLSAFE)}.eyJ${r(40, URLSAFE)}.${r(43, URLSAFE)}`],
  "token-linear": [`lin_oauth_${r(40)}`, `lin_api_${r(40)}`],
  "token-notion": [`ntn_${r(40)}`, `secret_${r(43)}`],
  "token-atlassian": [`ATATT3xFfGF0${r(60, URLSAFE)}=${r(8)}`],
  "token-aws": [`AKIA${r(16, "ABCDEFGHJKLMNPQRSTUVWXYZ2345679")}`],
  "token-vendor-key": [`tvly-${r(32)}`, `AIza${r(35, URLSAFE)}`, `sk_${r(40, "0123456789abcdef")}`],
  "token-bearer": [`Authorization: Bearer ${r(8)}1`, `Bearer ${r(40, URLSAFE)}`],
  "token-oauth-field": [`"access_token": "${r(40, URLSAFE)}"`, `refresh_token = '${r(40, URLSAFE)}'`],
  "private-key": ["-----BEGIN RSA " + "PRIVATE KEY-----"],
}

test("every vendor token shape is flagged, each by its own rule", () => {
  for (const [id, strings] of Object.entries(gold)) {
    for (const text of strings) {
      const found = scanText(`line one\nconst v = ${text}\n`, "x.mjs")
      assert.ok(found.length >= 1, `${id}: ${text.slice(0, 18)}… was not flagged`)
      assert.ok(found.some((f) => f.id === id || (id === "token-anthropic" && f.id === "credential") || (id === "credential" && /^(credential|token-)/.test(f.id))), `${id}: flagged only as ${found.map((f) => f.id).join(",")}`)
      assert.equal(found[0].line, 2)
      assert.ok(found[0].sample.length <= 41, "the finding shows a sample, never the whole value")
    }
  }
  const ids = new Set(TOKEN_SHAPES.map(([id]) => id))
  for (const id of ids) assert.ok(gold[id], `${id} has a gold test`)
})

test("the six strings the reviewer tried are flagged", () => {
  const six = [`sk-ant-oat01-${r(44, URLSAFE)}`, `xoxp-${r(11, "0123456789")}-${r(11, "0123456789")}-${r(11, "0123456789")}-${r(32)}`, `ya29.${r(70, URLSAFE)}`, `lin_oauth_${r(40)}`, `ntn_${r(44)}`, `eyJ${r(24, URLSAFE)}.eyJ${r(36, URLSAFE)}.${r(43, URLSAFE)}`]
  for (const text of six) assert.ok(scanText(text, "x").length >= 1, text.slice(0, 12))
})

test("a normal hex digest, a commit id, a UUID and ordinary words are not flagged", () => {
  const sha = createHash("sha256").update("anything").digest("hex")
  const clean = [sha, createHash("sha1").update("x").digest("hex"), "6f1ed002-ab5d-42e0-868f-9d2c2a1c4d6e", "the Bearer scheme and a Bearer token", "tokenType: \"Bearer\"", "a secret_value and an access_token variable", "const token = readToken()", `sha256:${sha}`, "sk-ant- is the prefix", "ya29. alone", "xoxb-"]
  for (const text of clean) assert.deepEqual(scanText(text, "x"), [], text)
})

test("a value that is obviously made up is not flagged, so fixtures can say what they are", () => {
  for (const text of ["sk-ant-oat01-0123456789abcdef-dummy", "ya29.a0AfH6SMB-token_0123456789/abcdefghijklmnopqrstuvwxyz", "Bearer dummy-token-value-1", "gho_canary0000000000000000000000000000", "xoxp-example-workspace-token", "lin_oauth_dummydummydummydummy"]) assert.deepEqual(scanText(text, "x"), [], text)
})
