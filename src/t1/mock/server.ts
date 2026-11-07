// Scriptable OpenAI-compatible mock: POST /v1/chat/completions (SSE), GET /v1/models.
// The behaviour is chosen by a directive in the last user message:
//   [[mock:text:SOME TEXT]]   plain text answer
//   [[mock:slow:N]]           N one-second chunks, then "slow done"
//   [[mock:tool:NAME:JSON]]   one tool call to NAME with JSON arguments, then text after the tool result
// A request without tools (title generation etc.) gets a short text answer.
// Usage: bun mock/server.ts <port> <logFile>
import { appendFileSync } from "node:fs"

const port = Number(process.argv[2] ?? 0)
const logFile = process.argv[3] ?? "/dev/null"
const log = (entry: Record<string, unknown>) => appendFileSync(logFile, JSON.stringify({ t: Date.now(), ...entry }) + "\n")

type Message = { role: string; content?: unknown; tool_calls?: unknown[] }
const text = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map(part => (part as { text?: string }).text ?? "").join("") : ""

function chunk(delta: Record<string, unknown>, finish: string | null = null) {
  return `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "m1", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
}

function stream(write: (send: (s: string) => void, signal: AbortSignal) => Promise<void>, signal: AbortSignal) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    async start(controller) {
      const send = (s: string) => { try { controller.enqueue(encoder.encode(s)) } catch {} }
      try { await write(send, signal) } catch (error) { log({ ev: "stream-error", error: String(error) }) }
      try { controller.close() } catch {}
    },
  }), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
}

const usage = (send: (s: string) => void) =>
  send(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "m1", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`)

function textAnswer(answer: string, signal: AbortSignal) {
  return stream(async send => {
    send(chunk({ role: "assistant", content: "" }))
    send(chunk({ content: answer }))
    send(chunk({}, "stop"))
    usage(send)
    send("data: [DONE]\n\n")
  }, signal)
}

const server = Bun.serve({
  port, hostname: "127.0.0.1", idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "m1", object: "model", owned_by: "mock" }] })
    if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
    const body = await request.json() as { messages: Message[]; tools?: { function: { name: string; parameters?: unknown } }[]; stream?: boolean }
    const messages = body.messages ?? []
    const last = messages[messages.length - 1]
    const lastUser = [...messages].reverse().find(m => m.role === "user")
    const userText = text(lastUser?.content)
    const tools = (body.tools ?? []).map(t => t.function.name)
    const all = JSON.stringify(body)
    log({ ev: "request", mentions: ["d_only_tool", "spike_probe", "schedule_create", "schedule_list", "opencode_schedule"].filter(word => all.includes(word)), stream: body.stream, roles: messages.map(m => m.role), lastRole: last?.role, userText: userText.slice(0, 200), tools, lastContent: text(last?.content).slice(0, 400) })
    const signal = request.signal
    if (!tools.length) return textAnswer("Spike title", signal)
    if (last?.role === "tool") return textAnswer(`after-tool: ${text(last.content).slice(0, 300)}`, signal)
    // The prompt can arrive JSON-escaped (`\"query\":\"x\"`), which would break both the directive match and the
    // arguments the scripted tool call carries. Unescape once, before reading either.
    const unescaped = userText.replace(/\\"/g, '"').replace(/\\n/g, "\n")
    const directive = /\[\[mock:(\w+)(?::([^\]]*))?\]\]/.exec(unescaped)
    const kind = directive?.[1] ?? "text"
    const arg = directive?.[2] ?? "hello from mock"
    if (kind === "slow") {
      const seconds = Number(arg) || 30
      return stream(async (send, signal) => {
        send(chunk({ role: "assistant", content: "" }))
        for (let i = 0; i < seconds; i++) {
          if (signal.aborted) { log({ ev: "slow-aborted", at: i }); return }
          send(chunk({ content: `tick${i} ` }))
          await Bun.sleep(1000)
        }
        log({ ev: "slow-finished" })
        send(chunk({ content: "slow done" }))
        send(chunk({}, "stop"))
        usage(send)
        send("data: [DONE]\n\n")
      }, signal)
    }
    if (kind === "tool") {
      const [name, ...rest] = arg.split(":")
      const args = rest.join(":") || "{}"
      return stream(async send => {
        send(chunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: "function", function: { name, arguments: "" } }] }))
        send(chunk({ tool_calls: [{ index: 0, function: { arguments: args } }] }))
        send(chunk({}, "tool_calls"))
        usage(send)
        send("data: [DONE]\n\n")
      }, signal)
    }
    if (kind === "schema") {
      log({ ev: "schema", tools: body.tools })
      return textAnswer("schema logged", signal)
    }
    return textAnswer(arg, signal)
  },
})
log({ ev: "listening", port: server.port })
console.log(server.port)
