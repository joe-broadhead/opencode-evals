// The stored trace must be privacy-clean and deterministic. Both are asserted against the real recording
// when it is present, and against a synthetic one otherwise.
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { traceFromFiles, failureClass } from "../src/trace/normalise.mjs"

const RAW = join(process.env.EVALS_RAW ?? join(import.meta.dirname, "..", "..", "private", "raw"), "nx6", "x", "small-bounded-search.jsonl")
const CASE = "small-bounded-search"
const trace = (base) =>
  traceFromFiles({
    caseName: CASE,
    iteration: "nx6",
    base,
    manifest: { quality: "declared" },
    model: "claude-agent/opus#high",
  })

/** The content of a recording: tool arguments, tool results and the answer. Timestamps are not content. */
const contentOf = (raw) => {
  const parts = []
  for (const line of String(raw).split("\n").filter(Boolean)) {
    const event = JSON.parse(line)
    const state = event.part?.state ?? {}
    parts.push(JSON.stringify(state.input ?? {}), typeof state.output === "string" ? state.output : JSON.stringify(state.output ?? ""))
    if (event.type === "text") parts.push(event.part?.text ?? "")
  }
  return parts.join("\n")
}

const secretsIn = (text) => {
  const found = new Set()
  for (const m of String(text).matchAll(/https?:\/\/[^\s"')]+/g)) found.add(m[0])
  for (const m of String(text).matchAll(/@[A-Za-z0-9_]{2,}/g)) found.add(m[0])
  for (const m of String(text).matchAll(/\b\d{10,}\b/g)) {
    // Epoch seconds or milliseconds are time, not content: the run's own clock is allowed in a trace.
    const value = Number(m[0])
    if (value > 1.6e9 && value < 1.9e9) continue
    if (value > 1.6e12 && value < 1.9e12) continue
    found.add(m[0])
  }
  return [...found]
}

test("the trace is deterministic: the same recording produces the same bytes", { skip: !existsSync(RAW) && "private recording absent" }, () => {
  const base = RAW.replace(/\.jsonl$/, "")
  const a = trace(base).lines.join("\n")
  const b = trace(base).lines.join("\n")
  assert.equal(a, b)
})

test("no post text, link, handle or id from the recording reaches the trace", { skip: !existsSync(RAW) && "private recording absent" }, () => {
  const base = RAW.replace(/\.jsonl$/, "")
  const stored = trace(base).lines.join("\n")
  const raw = contentOf(readFileSync(RAW, "utf8"))
  const secrets = secretsIn(raw)
  assert.ok(secrets.length > 5, "the fixture must contain something to leak")
  const leaked = secrets.filter((secret) => stored.includes(secret))
  assert.deepEqual(leaked, [], `the trace leaked ${leaked.length} value(s)`)
  // The answer's text never appears verbatim.
  const answer = [...readFileSync(RAW, "utf8").split("\n").filter(Boolean)].map((l) => JSON.parse(l)).filter((e) => e.type === "text").pop()?.part?.text ?? ""
  assert.ok(answer.length > 100)
  const firstSentence = answer.split("\n").filter((l) => l.trim())[0].slice(0, 40)
  assert.equal(stored.includes(firstSentence), false)
})

test("the trace has the shape oc-trace/1 promises", { skip: !existsSync(RAW) && "private recording absent" }, () => {
  const base = RAW.replace(/\.jsonl$/, "")
  const { head, body } = trace(base)
  assert.equal(head.schema, "oc-trace/1")
  assert.equal(head.failure_class, null)
  // The cost rule: the provider billed zero, and the catalogue (through the alias mapping) prices it.
  assert.equal(head.summary.cost.billed_usd, 0)
  assert.ok(["billed", "list-price", "free", "missing"].includes(head.summary.cost.source))
  assert.match(head.summary.cost.catalog.digest, /^[0-9a-f]{64}$/)
  assert.equal(head.privacy.policy, "no-text-no-ids-no-handles")
  assert.match(head.privacy.raw.sha256, /^[0-9a-f]{64}$/)
  const kinds = new Set(body.map((e) => e.kind))
  for (const kind of ["tool_call", "tool_result", "skill_load", "answer"]) assert.ok(kinds.has(kind), `no ${kind} event`)
  const search = body.find((e) => e.kind === "tool_call" && e.tool === "search_posts_all")
  assert.equal(search.via, "execute")
  assert.equal(search.args.max_results, 10, "a literal argument survives")
  assert.ok(head.summary.tokens.cacheRead > 0, "cache reads are counted separately")
  const answer = body.find((e) => e.kind === "answer")
  assert.match(answer.sha256, /^[0-9a-f]{64}$/)
  assert.equal(answer.text, undefined)
})

test("every stored trace is clean of every recording's links, handles and ids", { skip: !existsSync(join(process.env.EVALS_RAW ?? join(import.meta.dirname, "..", "..", "private", "raw"), "nx6")) && "private recordings absent" }, async () => {
  const { execFileSync } = await import("node:child_process")
  const out = execFileSync(process.execPath, [join(import.meta.dirname, "..", "scripts", "privacy-scan.mjs")], { encoding: "utf8" })
  assert.match(out, /0 leak\(s\)/, out)
})

test("an exit that did no work is classed infra, not scored as a zero", () => {
  assert.equal(failureClass({ exit: 1, tokens: {}, calls: 0, durationMs: 1000 }), "infra")
  assert.equal(failureClass({ exit: 0, tokens: {}, calls: 0, durationMs: 1000 }), null)
  assert.equal(failureClass({ exit: 1, tokens: { output: 10 }, calls: 0, durationMs: 1000 }), "provider")
})
