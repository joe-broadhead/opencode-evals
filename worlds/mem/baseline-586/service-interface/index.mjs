import { createRecordsClient } from "../src/backend/records.js"
import { LIMITS, ReadError, object, safeError, validateRead } from "./registry.mjs"
export { ReadError, readRegistry } from "./registry.mjs"

export function trustedOrigin(value) {
  let url
  try { url = new URL(value) } catch { throw new ReadError("invalid_origin") }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !["https:", "http:"].includes(url.protocol) || (url.protocol !== "https:" && !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname))) throw new ReadError("invalid_origin")
  return url.origin
}
export function credentialToken(value) {
  if (typeof value !== "string" || !value || value.length > 8192 || /[^\x21-\x7e]/.test(value)) throw new ReadError("unauthorized", 401)
  return value
}

// Redirects are disabled, including same-origin redirects. Consume bounded
// bodies inside the deadline, before the existing client parses the response.
async function boundedFetch(url, init, signal, fetchImpl) {
  const response = await fetchImpl(url, { ...init, redirect: "manual", signal: AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]) })
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel()
    throw new ReadError("redirect_refused", 502)
  }
  const chunks = []
  let size = 0
  for await (const chunk of response.body ?? []) {
    size += chunk.length
    if (size > LIMITS.outputBytes) throw new ReadError("response_too_large", 502)
    chunks.push(chunk)
  }
  return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers })
}

/** A two-method HTTP JSON SDK; no OpenCode context or cell credentials.
 * @param {{origin: string, credential?: () => string | Promise<string>, fetchImpl?: typeof fetch, deadlineMs?: number}} config
 */
export function createMemoryReads({ origin, credential, fetchImpl = fetch, deadlineMs = LIMITS.deadlineMs }) {
  const audience = trustedOrigin(origin)
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > LIMITS.deadlineMs) throw new ReadError("invalid_request")
  async function context(options = {}) {
    const token = credentialToken(options.token ?? await credential?.())
    if (options.space !== undefined && (typeof options.space !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(options.space))) throw new ReadError("invalid_space")
    return { token, signal: AbortSignal.any([AbortSignal.timeout(deadlineMs), ...(options.signal ? [options.signal] : [])]), space: options.space }
  }
  async function read(name, input, options) {
    let ctx
    try {
      validateRead(name, input)
      ctx = await context(options)
      const client = createRecordsClient({ controlURL: audience, timeoutMs: deadlineMs, retries: 0, timeZone: "UTC" }, {
        credentials: { bearer: async () => ctx.token, refresh: async () => "" },
        fetchImpl: (url, init) => boundedFetch(url, init, ctx.signal, fetchImpl),
      })
      return await client.call(name, input, { space: ctx.space, retries: 0 })
    } catch (error) {
      if (ctx?.signal.aborted) throw new ReadError(ctx.signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled", ctx.signal.reason?.name === "TimeoutError" ? 408 : 499)
      throw safeError(error)
    }
  }
  // Verification uses the existing PUBLIC context route, never internal
  // control credentials, guessed roles, or a nonempty-bearer boolean.
  async function gatewayAuthorize(options) {
    try {
      const ctx = await context(options)
      const response = await boundedFetch(`${audience}/v1/context`, { method: "POST", headers: { authorization: `Bearer ${ctx.token}`, "content-type": "application/json" }, body: JSON.stringify(ctx.space ? { space_id: ctx.space } : {}) }, ctx.signal, fetchImpl)
      if (!response.ok) throw new ReadError(response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : "upstream_unavailable", response.status)
      const data = await response.json()
      if (!object(data) || data.routing !== "gateway" || typeof data.user?.id !== "string" || !data.user.id) throw new ReadError("invalid_gateway_context", 502)
      return Object.freeze({ principal: data.user.id })
    } catch (error) { throw safeError(error) }
  }
  return Object.freeze({ records: Object.freeze({ get: (input, options) => read("records.get", input, options), list: (input = {}, options) => read("records.list", input, options) }), gatewayAuthorize })
}
