// The scripted model's directive: a `]` in an argument, a prompt that arrived JSON-escaped, and a `\"` inside a JSON
// string all reach the tool call intact, and a steps sequence reads `{{previous.<path>}}` out of whatever the host wrapped
// the last result in. The parser is a plain module, so this runs with no host, no container and no model.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { atPath, directiveOf, fillPrevious, parseToolDirective, previousValue, splitDirective } from "../src/t1/mock/directive.mjs"
import { mock, execute, steps } from "../src/p0/run.mjs"

const ROOT = join(import.meta.dirname, "..")

test("a directive's payload survives `]`, and a JSON argument that holds `\"` is not unescaped", () => {
  // No directive: the server's default answer.
  assert.deepEqual(directiveOf("plain words"), { kind: "text", arg: "hello from mock" })
  assert.deepEqual(directiveOf(`[[mock:text:hello]]`), { kind: "text", arg: "hello" })
  // The old `[^\]]*` regex stopped at the first `]`: an index or a `.map(...)` ended the directive early.
  const indexed = `[[mock:tool:execute:${JSON.stringify({ code: "return rows.map((row) => row[0]).join(',')" })}]]`
  assert.deepEqual(parseToolDirective("tool", directiveOf(indexed).arg), { name: "execute", args: { code: "return rows.map((row) => row[0]).join(',')" } })
  // Notion's live-writes entry: the code itself holds a JSON string, so the directive carries \" and \\\".
  const code = `return await Reflect.get(tools.notion, "notion-create-pages")({ pages: "{\\"properties\\":{\\"title\\":\\"x\\"}}".split("|").map((s) => JSON.parse(s)) })`
  const notion = mock("execute", { code })
  assert.ok(notion.includes("\\\\\\\""), "the directive carries escaped quotes")
  const parsed = parseToolDirective("tool", directiveOf(notion).arg)
  assert.deepEqual(parsed, { name: "execute", args: { code } }, "the code is byte-identical to what was scripted")
  // A prompt that reached the model as a JSON string is unescaped once, and only because its payload does not parse.
  const delayed = directiveOf(JSON.stringify(execute("return await tools.slack.slack_send_message({ text: 'hi' })")))
  assert.deepEqual(parseToolDirective("tool", delayed.arg), { name: "execute", args: { code: "return await tools.slack.slack_send_message({ text: 'hi' })" } })
  // The same for a steps list, whose JSON always holds `]`.
  const list = steps([{ code: "return 1" }, { tool: "gws_write", args: { planId: "{{previous.planId}}" } }])
  assert.deepEqual(directiveOf(list), { kind: "steps", arg: JSON.stringify([{ code: "return 1" }, { tool: "gws_write", args: { planId: "{{previous.planId}}" } }]) })
  assert.deepEqual(directiveOf(JSON.stringify(list)).kind, "steps", "an escaped steps directive is read too")
  assert.deepEqual(splitDirective("no directive here"), null)
  assert.deepEqual(splitDirective("[[mock:dump]]"), { kind: "dump", arg: "" })
  assert.equal(parseToolDirective("tool", "execute:not json"), null)
  // Unbalanced `]]` inside a JSON string (kills M1: scan must respect quotes) and unmatched quote in `mock:text` (F6).
  const unbalanced = mock("execute", { code: "return 'x]]]'" })
  assert.deepEqual(parseToolDirective("tool", directiveOf(unbalanced).arg), { name: "execute", args: { code: "return 'x]]]'" } })
  const openBrace = mock("execute", { code: "return '{'" })
  assert.deepEqual(parseToolDirective("tool", directiveOf(openBrace).arg), { name: "execute", args: { code: "return '{'" } })
  assert.deepEqual(directiveOf('[[mock:text:he said "hi]] trailing'), { kind: "text", arg: 'he said "hi' })
})

test("a step's {{previous.path}} reads the last result through the host's and the vendor's wrapping", () => {
  const plan = { planId: "plan_123", operation: "drive.files.create" }
  // The result as text, as a string of a JSON string, as Code Mode's own output object, and as an MCP content part.
  assert.equal(atPath(previousValue(JSON.stringify(plan)), "planId"), "plan_123")
  assert.equal(atPath(previousValue(JSON.stringify(JSON.stringify(plan))), "planId"), "plan_123")
  assert.equal(atPath(previousValue({ output: JSON.stringify(plan), title: "execute" }), "planId"), "plan_123")
  assert.equal(atPath(previousValue([{ type: "text", text: JSON.stringify(plan) }]), "planId", { fromMcpParts: true }), "plan_123")
  assert.equal(atPath(previousValue({ result: { content: [{ type: "text", text: JSON.stringify(plan) }] } }), "planId"), "plan_123")
  assert.equal(atPath(previousValue(JSON.stringify(plan)), "operation"), "drive.files.create", "a dotted first segment resolves from the root")
  // Arguments are filled at any depth, and a missing value is empty rather than the literal placeholder.
  assert.deepEqual(fillPrevious({ planId: "{{previous.planId}}", note: { ids: ["{{previous.missing}}", "{{previous.planId}}"] } }, plan), { planId: "plan_123", note: { ids: ["", "plan_123"] } })
  assert.deepEqual(fillPrevious("plan={{previous.planId}}", plan), "plan=plan_123")
  assert.equal(atPath({}, "planId"), undefined)
  // F1: a path that meets a primitive early returns undefined, never the intermediate primitive.
  assert.equal(atPath({ result: "oops: denied" }, "result.planId"), undefined)
  assert.equal(atPath({ planId: "p" }, "planId.x"), undefined)
  // F3/R1: vendor subtrees (`docs[0].planId`), vendor lists under envelopes (`result: [{planId}]`), and inherited properties (`constructor`) are never matched.
  assert.equal(atPath({ docs: [{ planId: "vendor-decoy" }] }, "result.planId"), undefined)
  assert.equal(atPath({ docs: [{ planId: "vendor-decoy" }] }, "planId"), undefined)
  assert.equal(atPath({ result: [{ planId: "decoy" }] }, "planId"), undefined)
  assert.equal(atPath([{ planId: "decoy" }], "planId"), undefined)
  assert.equal(atPath({}, "constructor"), undefined)
  const missed = []
  fillPrevious({ planId: "{{previous.planId}}" }, { other: 1 }, { missing: missed })
  assert.deepEqual(missed, ["planId"])
})

const hasBun = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0

test("the mock server executes a multi-step sequence and fills {{previous.planId}} from the prior tool result", { skip: !hasBun && "bun not on PATH" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-mock-steps-"))
  const logFile = join(dir, "mock.jsonl")
  const child = spawn("bun", [join(ROOT, "src/t1/mock/server.ts"), "0", logFile], { stdio: ["ignore", "pipe", "pipe"] })
  try {
    const port = await new Promise((resolve, reject) => {
      let buf = ""
      const timer = setTimeout(() => reject(new Error("mock server did not print port")), 10_000)
      child.stdout.on("data", (chunk) => {
        buf += chunk.toString()
        const line = buf.split("\n")[0]?.trim()
        if (/^\d+$/.test(line)) {
          clearTimeout(timer)
          resolve(Number(line))
        }
      })
      child.on("exit", (code) => {
        clearTimeout(timer)
        reject(new Error(`mock exited early (${code})`))
      })
    })
    const post = async (messages) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m1", stream: true, tools: [{ type: "function", function: { name: "execute" } }, { type: "function", function: { name: "gws_write" } }], messages }),
      })
      assert.equal(res.status, 200)
      const sse = await res.text()
      const chunks = sse.split("\n\n").filter((l) => l.startsWith("data: ") && !l.includes("[DONE]")).map((l) => JSON.parse(l.slice(6)))
      const name = chunks.map((c) => c.choices?.[0]?.delta?.tool_calls?.[0]?.function?.name).find(Boolean) ?? null
      const args = chunks.map((c) => c.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments ?? "").join("")
      const content = chunks.map((c) => c.choices?.[0]?.delta?.content ?? "").join("")
      return { name, args: args ? JSON.parse(args) : null, content }
    }
    const prompt = steps([
      { code: "return await tools.gws.plan({ operation: 'drive.files.create' })" },
      { tool: "gws_write", args: { planId: "{{previous.planId}}" } },
    ])
    const turn1 = await post([{ role: "user", content: prompt }])
    assert.equal(turn1.name, "execute")
    assert.match(turn1.args.code, /drive\.files\.create/)
    const turn2 = await post([
      { role: "user", content: prompt },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "execute", arguments: JSON.stringify(turn1.args) } }] },
      { role: "tool", tool_call_id: "c1", content: JSON.stringify({ output: JSON.stringify({ planId: "plan_live_77" }) }) },
    ])
    assert.equal(turn2.name, "gws_write")
    assert.deepEqual(turn2.args, { planId: "plan_live_77" })
    const turn3 = await post([
      { role: "user", content: prompt },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "execute", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "{}" },
      { role: "assistant", content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "gws_write", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c2", content: JSON.stringify({ ok: true }) },
    ])
    assert.equal(turn3.name, null)
    assert.equal(turn3.content, "steps done")
    // R3: server returns `bad step: missing planId` when the previous output lacks `planId`, and refuses `{{previous.*}}` in a `code` step.
    const missingTurn = await post([
      { role: "user", content: prompt },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "execute", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: JSON.stringify({ error: "no plan" }) },
    ])
    assert.equal(missingTurn.name, null)
    assert.equal(missingTurn.content, "bad step: missing planId")
    const codePrompt = steps([{ code: "return 1" }, { code: "return '{{previous.planId}}'" }])
    const codeTurn = await post([
      { role: "user", content: codePrompt },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "execute", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: JSON.stringify({ planId: "p1" }) },
    ])
    assert.equal(codeTurn.name, null)
    assert.match(codeTurn.content, /bad step:.*only allowed in tool args/)
    assert.ok(readFileSync(logFile, "utf8").includes("listening"))
  } finally {
    child.kill("SIGTERM")
    rmSync(dir, { recursive: true, force: true })
  }
})
