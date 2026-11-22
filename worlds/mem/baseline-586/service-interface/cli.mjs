#!/usr/bin/env node
import { createMemoryReads, credentialToken } from "./index.mjs"
import { safeError } from "./registry.mjs"
import { serveStdio } from "./stdio.mjs"
import { createMemoryHttpServer } from "./http.mjs"

try {
  const [command, json = "{}", space, ...rest] = process.argv.slice(2)
  const sdk = createMemoryReads({ origin: process.env.MEMORY_ORIGIN })
  if (command === "mcp-http" && process.argv.length === 3) {
    // MEMORY_TOKEN is deliberately not read in this mode.
    const port = Number(process.env.MEMORY_PORT ?? 8422)
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("invalid port")
    const server = createMemoryHttpServer({ sdk, gatewayAuthorize: sdk.gatewayAuthorize, allowedOrigins: process.env.MEMORY_ALLOWED_ORIGINS ? JSON.parse(process.env.MEMORY_ALLOWED_ORIGINS) : [] })
    server.server.on("error", () => { process.stderr.write('{"error":"listener_unavailable"}\n'); process.exitCode = 1 })
    server.server.once("listening", () => process.stderr.write(`${JSON.stringify({ listening: `http://127.0.0.1:${server.server.address().port}` })}\n`))
    server.listen(port)
    const stop = () => { void server.close().then(() => process.exit(0)) }
    process.once("SIGTERM", stop)
    process.once("SIGINT", stop)
  } else if (command === "mcp-stdio" && process.argv.length === 3) {
    const token = credentialToken(process.env.MEMORY_TOKEN)
    serveStdio({ sdk, token, onClose: () => process.stdout.end(() => process.exit(0)) })
  } else {
    if (rest.length || !["records.get", "records.list"].includes(command)) throw new Error("usage")
    const token = credentialToken(process.env.MEMORY_TOKEN)
    const input = JSON.parse(json)
    const result = await sdk.records[command.slice(8)](input, { token, ...(space ? { space } : {}) })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: safeError(error) })}\n`)
  process.exitCode = 1
}
