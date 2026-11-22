import http from "node:http"
import { createHash, randomBytes } from "node:crypto"
import { credentialToken, trustedOrigin } from "./index.mjs"
import { LEGACY, LIMITS, RpcError, dispatch, limitsError, rpcFailure, validateHeaders, validateMessage, validId } from "./mcp.mjs"
import { ReadError, safeError } from "./registry.mjs"

const fingerprint = token => createHash("sha256").update(token).digest("hex")
const CANCEL_INFLIGHT = 4
function readBody(request, signal) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0, large = false
    const abort = () => { cleanup(); request.resume(); reject(new ReadError("timeout", 408)) }
    const data = chunk => {
      size += chunk.length
      if (size > LIMITS.bytes) { large = true; chunks.length = 0 }
      else if (!large) chunks.push(chunk)
    }
    const error = () => { cleanup(); reject(new ReadError("invalid_request")) }
    const end = () => {
      cleanup()
      if (large) return reject(new RpcError(-32600, "Message too large", 413))
      try { resolve(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))) }
      catch { reject(new RpcError(-32700, "Parse error")) }
    }
    function cleanup() { signal.removeEventListener("abort", abort); request.off("data", data); request.off("error", error); request.off("end", end) }
    if (signal.aborted) return abort()
    signal.addEventListener("abort", abort, { once: true })
    request.on("data", data).once("error", error).once("end", end)
  })
}

/** Loopback-only experimental token profile. gatewayAuthorize MUST verify the
 * CURRENT token at the SAME public gateway used by sdk; there is no default
 * boolean, operator credential, forwarded identity header or OAuth claim. */
export function createMemoryHttpServer({ sdk, gatewayAuthorize, allowedOrigins = [] }) {
  if (typeof gatewayAuthorize !== "function") throw new ReadError("gateway_authorization_unconfigured", 503)
  const origins = new Set(allowedOrigins.map(trustedOrigin))
  const sessions = new Map(), active = new Map()
  const intake = new Set(), data = new Set(), cancellations = new Set()
  const server = http.createServer(async (request, response) => {
    const controller = new AbortController()
    let message, key, legacy, timer
    const send = (status, body, headers = {}) => {
      if (response.destroyed || response.writableEnded) return
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers })
      response.end(body === undefined ? undefined : JSON.stringify(body))
    }
    const closed = () => { if (!response.writableEnded && !legacy) controller.abort() }
    request.once("aborted", closed)
    response.once("close", closed)
    try {
      const port = server.address()?.port
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host)) throw new ReadError("host_forbidden", 403)
      const origin = request.headers.origin
      if (origin !== undefined && !origins.has(origin)) throw new ReadError("origin_forbidden", 403)
      if (origin) {
        response.setHeader("access-control-allow-origin", origin)
        response.setHeader("vary", "Origin")
        response.setHeader("access-control-expose-headers", "Mcp-Session-Id")
      }
      if (request.url !== "/mcp") throw new RpcError(-32601, "Method not found", 404)
      if (request.method !== "POST") { send(405, undefined, { allow: "POST" }); return }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) throw new ReadError("invalid_request", 415)
      const accept = (request.headers.accept ?? "").split(",").map(value => value.trim().split(";")[0])
      if (!accept.includes("application/json") || !accept.includes("text/event-stream")) throw new ReadError("invalid_request", 406)
      const token = credentialToken(/^Bearer ([\x21-\x7e]+)$/.exec(request.headers.authorization ?? "")?.[1])
      if (intake.size >= LIMITS.inflight) throw limitsError()
      // Bounded authentication/body intake is independent of dispatched work:
      // sixteen slow reads must not consume the cancellation intake capacity.
      key = Symbol()
      active.set(key, controller)
      intake.add(key)
      timer = setTimeout(() => controller.abort(new ReadError("timeout", 408)), LIMITS.deadlineMs)
      const verified = await gatewayAuthorize({ token, signal: controller.signal })
      if (!verified || typeof verified.principal !== "string" || !verified.principal) throw new ReadError("invalid_gateway_context", 502)
      message = await readBody(request, controller.signal)
      validateMessage(message)
      const modern = message.params?._meta?.["io.modelcontextprotocol/protocolVersion"] !== undefined
      const owner = fingerprint(token)
      // Legacy sessions are bounded, opaque, credential-bound handshake state;
      // possessing an id is NEVER authentication. All requests reauth above.
      const now = Date.now()
      for (const [id, session] of sessions) if (session.expires < now) {
        for (const pending of session.active.values()) pending.abort()
        sessions.delete(id)
      }
      let sessionId
      if (!modern) {
        if (message.method === "initialize") {
          if (sessions.size >= 128) throw limitsError()
          legacy = { owner, principal: verified.principal, expires: now + 300000, active: new Map() }
          sessionId = randomBytes(32).toString("base64url")
        } else {
          const id = request.headers["mcp-session-id"]
          if (id === undefined) throw new RpcError(-32602, "Missing per-request protocol metadata")
          legacy = typeof id === "string" ? sessions.get(id) : undefined
          if (!legacy || legacy.owner !== owner || legacy.principal !== verified.principal) throw new ReadError("session_not_found", 404)
        }
      }
      validateHeaders(message, request.headers, legacy)
      const cancellation = !modern && !Object.hasOwn(message, "id") && message.method === "notifications/cancelled"
      // Classify only from the validated body after current gateway auth and
      // credential-bound session checks. No header can buy a data-read slot.
      const slots = cancellation ? cancellations : data
      if (slots.size >= (cancellation ? CANCEL_INFLIGHT : LIMITS.inflight)) throw limitsError()
      slots.add(key)
      intake.delete(key)
      if (!Object.hasOwn(message, "id")) {
        if (cancellation) {
          legacy.active.get(message.params?.requestId)?.abort()
        } else await dispatch(message, { sdk, token, signal: controller.signal, legacy })
        send(202)
        return
      }
      if (legacy) {
        if (legacy.active.has(message.id)) throw new RpcError(-32600, "Duplicate in-flight request id")
        legacy.active.set(message.id, controller)
      }
      const result = await dispatch(message, { sdk, token, signal: controller.signal, legacy })
      if (controller.signal.aborted) {
        // Legacy explicit cancellation, unlike a mere disconnect, ends work
        // without a later JSON-RPC response for the cancelled request.
        if (legacy && !(controller.signal.reason instanceof ReadError)) { response.destroy(); return }
        throw new ReadError("timeout", 408)
      }
      if (sessionId) sessions.set(sessionId, legacy)
      send(200, result, sessionId ? { "mcp-session-id": sessionId } : {})
    } catch (error) {
      const status = error instanceof RpcError ? error.status : safeError(error).status
      send(status, rpcFailure(validId(message?.id) ? message.id : undefined, error))
    } finally {
      clearTimeout(timer)
      if (key) active.delete(key)
      intake.delete(key)
      data.delete(key)
      cancellations.delete(key)
      if (legacy?.active.get(message?.id) === controller) legacy.active.delete(message.id)
      request.off("aborted", closed)
      response.off("close", closed)
      if (!request.complete) request.resume()
    }
  })
  server.requestTimeout = LIMITS.deadlineMs
  server.headersTimeout = LIMITS.deadlineMs
  server.keepAliveTimeout = 1000
  server.maxConnections = 64
  return {
    listen: (port = 0) => server.listen(port, "127.0.0.1"),
    server,
    close: () => {
      for (const controller of active.values()) controller.abort()
      sessions.clear()
      return new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
    },
  }
}
