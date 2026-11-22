import { LIMITS, ReadError, bounded, object, readRegistry, safeError, validateRead } from "./registry.mjs"

export const MODERN = "2026-07-28"
export const LEGACY = "2025-11-25"
export const versions = Object.freeze([MODERN, LEGACY])
const info = Object.freeze({ name: "memory-portable-reads", version: "0.1.0-experimental" })
export class RpcError extends Error {
  constructor(code, message, status = 400, data) { super(message); this.code = code; this.status = status; this.data = data }
}
export function rpcFailure(id, error) {
  const rpc = error instanceof RpcError ? error : new RpcError(-32603, "Memory request failed", safeError(error).status, safeError(error).toJSON())
  return { jsonrpc: "2.0", ...(id !== undefined ? { id } : {}), error: { code: rpc.code, message: rpc.message, ...(rpc.data ? { data: rpc.data } : {}) } }
}
export function validId(id) { return typeof id === "string" && id.length <= 200 || Number.isSafeInteger(id) }
export function validateMessage(message) {
  bounded(message)
  if (!object(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string" || message.method.length > 200 || (Object.hasOwn(message, "id") && !validId(message.id)) || (message.params !== undefined && !object(message.params)) || Object.hasOwn(message, "result") || Object.hasOwn(message, "error")) throw new RpcError(-32600, "Invalid request")
}
export function requestVersion(message, legacy) {
  const meta = message.params?._meta
  if (meta !== undefined && !object(meta)) throw new RpcError(-32602, "Invalid metadata")
  const version = meta?.["io.modelcontextprotocol/protocolVersion"]
  if (version !== undefined) {
    if (version !== MODERN) throw new RpcError(-32022, "Unsupported protocol version", 400, { supported: versions, ...(typeof version === "string" && /^\d{4}-\d{2}-\d{2}$/.test(version) ? { requested: version } : {}) })
    if (!object(meta["io.modelcontextprotocol/clientCapabilities"])) throw new RpcError(-32602, "Missing client capabilities")
    return MODERN
  }
  if (message.method === "initialize" || legacy?.ready || message.method === "ping" && legacy?.initialized) return LEGACY
  throw new RpcError(-32602, "Missing per-request protocol metadata")
}
function keys(params, allowed) {
  if (Object.keys(params).some(key => !allowed.includes(key))) throw new RpcError(-32602, "Invalid params")
}

/** Shared protocol adapter over the same SDK read facade. Legacy state carries
 * handshake flags ONLY, never an identity, space, credential, or read result. */
export async function dispatch(message, { sdk, token, signal, legacy }) {
  validateMessage(message)
  if (!Object.hasOwn(message, "id")) {
    if (message.method === "notifications/initialized" && legacy?.initialized) legacy.ready = true
    return undefined
  }
  const version = requestVersion(message, legacy)
  const params = message.params ?? {}
  let result
  switch (message.method) {
    case "initialize": {
      if (version !== LEGACY) throw new RpcError(-32601, "Method not found", 404)
      if (!legacy || legacy.initialized) throw new RpcError(-32600, "Invalid initialization")
      keys(params, ["protocolVersion", "capabilities", "clientInfo"])
      if (typeof params.protocolVersion !== "string" || !object(params.capabilities) || !object(params.clientInfo) || typeof params.clientInfo.name !== "string" || typeof params.clientInfo.version !== "string") throw new RpcError(-32602, "Invalid initialization")
      legacy.initialized = true
      result = { protocolVersion: LEGACY, capabilities: { tools: {} }, serverInfo: info }
      break
    }
    case "server/discover":
      if (version !== MODERN) throw new RpcError(-32601, "Method not found", 404)
      keys(params, ["_meta"])
      result = { supportedVersions: versions, capabilities: { tools: {} } }
      break
    case "ping":
      keys(params, ["_meta"])
      result = {}
      break
    case "tools/list":
      keys(params, ["_meta", "cursor"])
      if (params.cursor !== undefined) throw new RpcError(-32602, "Invalid cursor")
      result = { tools: readRegistry.map(tool => ({ ...tool, inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, space: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", maxLength: 200 } } } })) }
      break
    case "tools/call": {
      keys(params, ["_meta", "name", "arguments"])
      if (!readRegistry.some(tool => tool.name === params.name) || !object(params.arguments)) throw new RpcError(-32602, "Invalid tool call")
      const { space, ...input } = params.arguments
      try {
        validateRead(params.name, input)
        const data = await sdk.records[params.name.slice(8)](input, { token, signal, space })
        result = { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, isError: false }
      } catch (error) {
        const data = { error: safeError(error).toJSON() }
        result = { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, isError: true }
      }
      break
    }
    default: throw new RpcError(-32601, "Method not found", 404)
  }
  return { jsonrpc: "2.0", id: message.id, result: { ...result, ...(version === MODERN ? { resultType: "complete", _meta: { "io.modelcontextprotocol/serverInfo": info } } : {}) } }
}

export function decodeHeader(value) {
  if (typeof value !== "string" || /[^\x20-\x7e\t]/.test(value)) return undefined
  if (value.startsWith("=?base64?") && value.endsWith("?=")) {
    const encoded = value.slice(9, -2)
    const bytes = Buffer.from(encoded, "base64")
    if (bytes.toString("base64") !== encoded) return undefined
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes) } catch { return undefined }
  }
  return value.trim() === value ? value : undefined
}
export function validateHeaders(message, headers, legacy) {
  if (!Object.hasOwn(message, "id")) return
  const modern = message.params?._meta?.["io.modelcontextprotocol/protocolVersion"] !== undefined
  if (modern) {
    if (!headers["mcp-protocol-version"] || headers["mcp-protocol-version"] !== message.params._meta["io.modelcontextprotocol/protocolVersion"] || headers["mcp-method"] !== message.method || (message.method === "tools/call" && (headers["mcp-name"] === undefined || decodeHeader(headers["mcp-name"]) !== message.params?.name))) throw new RpcError(-32020, "Header mismatch")
  } else if (message.method !== "initialize" && (!legacy || headers["mcp-protocol-version"] !== LEGACY)) throw new RpcError(-32020, "Header mismatch")
  requestVersion(message, legacy)
}

export function limitsError() { return new ReadError("capacity_exceeded", 429) }
export { LIMITS }
