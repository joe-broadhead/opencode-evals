// P0-13's capture server: a stand-in for the Anthropic Messages API on the trial's own loopback. It logs what the `claude`
// process sends (the system prompt, the tool names and descriptions, the headers' names), answers "ok", and, when asked, answers
// the next request with a `tool_use` of a built-in tool (Bash running a curl), so the probe can see whether anything runs it.
// It makes no model call and reaches nothing: every byte stays inside the trial.
//
//   bun capture-server.ts <port> <log file> [<tool_use json: {"name":"Bash","input":{"command":"curl ..."}}>]
import { appendFileSync } from "node:fs"

const port = Number(process.argv[2] ?? 0)
const logFile = process.argv[3] ?? "/dev/null"
const toolUse = process.argv[4] ? (JSON.parse(process.argv[4]) as { name: string; input: unknown }) : null
const log = (entry: Record<string, unknown>) => appendFileSync(logFile, JSON.stringify({ t: Date.now(), ...entry }) + "\n")

let requests = 0
let toolSent = false
let resultLogged = false

const sse = (events: [string, unknown][]) =>
  new Response(events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join(""), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })

const text = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((p: any) => p?.text ?? (p?.type === "tool_result" ? "[tool_result]" : "")).join("") : "")

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "GET") return Response.json({ data: [], has_more: false })
    if (url.pathname.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 })
    if (!url.pathname.includes("/v1/messages")) return new Response("not found", { status: 404 })
    const body = (await request.json().catch(() => ({}))) as any
    requests++
    const system = Array.isArray(body.system) ? body.system.map((p: any) => p?.text ?? "").join("\n") : String(body.system ?? "")
    const tools = (body.tools ?? []).map((t: any) => ({ name: t.name, description: String(t.description ?? "").slice(0, 400), description_bytes: String(t.description ?? "").length }))
    const messages = (body.messages ?? []).map((m: any) => ({ role: m.role, text: text(m.content).slice(0, 300) }))
    log({ ev: "request", n: requests, model: body.model, stream: body.stream, system_bytes: system.length, system_head: system.slice(0, 600), tools, messages, header_names: [...request.headers.keys()].sort() })
    const model = body.model ?? "claude-capture"
    // A tool result anywhere in the conversation (a system reminder may come after it).
    const results = (body.messages ?? []).flatMap((m: any) => (Array.isArray(m.content) ? m.content.filter((p: any) => p?.type === "tool_result") : []))
    const lastIsToolResult = results.length > 0
    const usage = { input_tokens: 10, output_tokens: 5 }
    // The tool_use is sent once, on the first real request that offers tools, then "done".
    if (toolUse && !toolSent && tools.length && !lastIsToolResult && messages.some((m: any) => m.role === "user" && m.text.length)) {
      toolSent = true
      log({ ev: "tool_use_sent", name: toolUse.name, in_tool_list: tools.some((t: any) => t.name === toolUse.name) })
      return sse([
        ["message_start", { type: "message_start", message: { id: "msg_capture1", type: "message", role: "assistant", model, content: [], stop_reason: null, usage } }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_capture1", name: toolUse.name, input: {} } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(toolUse.input) } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } }],
        ["message_stop", { type: "message_stop" }],
      ])
    }
    if (lastIsToolResult && !resultLogged) {
      resultLogged = true
      log({ ev: "tool_result_received", last: JSON.stringify(results.at(-1)?.content ?? "").slice(0, 400), is_error: results.some((r: any) => r?.is_error === true) })
    }
    const answer = lastIsToolResult ? "done" : "ok"
    return sse([
      ["message_start", { type: "message_start", message: { id: `msg_capture${requests}`, type: "message", role: "assistant", model, content: [], stop_reason: null, usage } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: answer } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }],
      ["message_stop", { type: "message_stop" }],
    ])
  },
})
log({ ev: "listening", port: server.port })
console.log(server.port)
