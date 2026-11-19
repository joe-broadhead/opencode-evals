// The harness's own fake MCP server (Streamable HTTP, JSON answers, no stream), for a plugin whose tools come from a vendor's MCP server (GitHub, Jira).
// It serves the tool list a user sees (packs/<id>/mcp.json: names, descriptions, input schemas, annotations) and answers `tools/call` from a small
// synthetic fixture (src/fake/fixtures/<plugin>.mjs): invented names only, never real data. It reaches nothing and every request it gets is logged.
//
//   bun mcp-server.ts <port> <log file> <catalog.json> <fixture.mjs> [<loopback ip> <tls key> <tls cert>]
//
// <port> is a plain-HTTP loopback port (the health check, and the whole server where no TLS is asked for). With an ip, key and cert it also answers TLS on that
// address, port 443: fake mode maps the vendor's own host name there (`--add-host`), so the plugin runs on its default URL and sees no conflict.
//
// The log (one JSON line per request: method, tool, arguments, header NAMES) is what the fake-mode probe reads to show what the model asked for.
import { appendFileSync, readFileSync } from "node:fs"

const port = Number(process.argv[2] ?? 0)
const logFile = process.argv[3] ?? "/dev/null"
const catalog = JSON.parse(readFileSync(process.argv[4] ?? "", "utf8")) as { plugin: string; tools: { name: string; description: string; inputSchema: unknown; annotations?: unknown }[] }
const fixture = (await import(process.argv[5] ?? "")) as { call: (name: string, args: Record<string, unknown>) => { text: string; isError?: boolean } }
const log = (entry: Record<string, unknown>) => {
  try {
    appendFileSync(logFile, JSON.stringify({ t: Date.now(), ...entry }) + "\n")
  } catch {
    // the log is best-effort
  }
}
const known = new Set(catalog.tools.map((t) => t.name))

const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result })
const failure = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } })

function handle(message: any, headers: string[], host: string | null) {
  const { id, method, params } = message ?? {}
  if (method === "initialize") {
    log({ ev: "initialize", client: params?.clientInfo?.name ?? null, headers, host })
    return reply(id, { protocolVersion: params?.protocolVersion ?? "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: `fake-${catalog.plugin}`, version: "1.0.0" } })
  }
  if (method === "notifications/initialized" || method?.startsWith("notifications/")) return null
  if (method === "ping") return reply(id, {})
  if (method === "tools/list") {
    log({ ev: "tools/list", count: catalog.tools.length, host })
    return reply(id, { tools: catalog.tools })
  }
  if (method === "tools/call") {
    const name = String(params?.name ?? "")
    const args = (params?.arguments ?? {}) as Record<string, unknown>
    if (!known.has(name)) {
      log({ ev: "tools/call", tool: name, arguments: args, unknown: true, host })
      return failure(id, -32602, `Unknown tool: ${name}`)
    }
    const out = fixture.call(name, args)
    log({ ev: "tools/call", tool: name, arguments: args, error: Boolean(out.isError), host })
    return reply(id, { content: [{ type: "text", text: out.text }], ...(out.isError ? { isError: true } : {}) })
  }
  if (method === "resources/list") return reply(id, { resources: [] })
  if (method === "prompts/list") return reply(id, { prompts: [] })
  return failure(id, -32601, `Method not found: ${method}`)
}

async function serve(request: Request) {
  const url = new URL(request.url)
  if (url.pathname === "/health") return new Response("ok")
  // The vendor's own paths (/v2/mcp, /mcp/) answer; discovery documents do not exist, so a client that asks finds no sign-in to do.
  if (url.pathname.startsWith("/.well-known/")) return new Response("not found", { status: 404 })
  const host = request.headers.get("host")
  // No server-sent stream: a GET (the client's optional listening stream) is refused as the spec allows.
  if (request.method === "GET") return new Response("no stream", { status: 405 })
  if (request.method === "DELETE") return new Response(null, { status: 200 })
  let body: any
  try {
    body = await request.json()
  } catch {
    return Response.json(failure(null, -32700, "Parse error"), { status: 400 })
  }
  const headers = [...request.headers.keys()].sort()
  if (Array.isArray(body)) {
    const out = body.map((m) => handle(m, headers, host)).filter((x) => x !== null)
    return out.length ? Response.json(out) : new Response(null, { status: 202 })
  }
  const out = handle(body, headers, host)
  return out === null ? new Response(null, { status: 202 }) : Response.json(out, { headers: { "mcp-session-id": "fake-session" } })
}

const server = Bun.serve({ port, hostname: "127.0.0.1", idleTimeout: 0, fetch: serve })
const [tlsIp, tlsKey, tlsCert] = process.argv.slice(6)
if (tlsIp && tlsKey && tlsCert) {
  const secure = Bun.serve({ port: 443, hostname: tlsIp, idleTimeout: 0, tls: { key: Bun.file(tlsKey), cert: Bun.file(tlsCert) }, fetch: serve })
  log({ ev: "listening-tls", ip: tlsIp, port: secure.port })
}
log({ ev: "listening", port: server.port, plugin: catalog.plugin })
console.log(server.port)
