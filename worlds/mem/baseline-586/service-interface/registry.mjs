// Bounded projections of the existing records query contract (§2.4), not a
// second read policy. Semantic validation and pagination stay at the gateway.
import { KINDS, STATUSES } from "../records/src/model.js"

export class ReadError extends Error {
  constructor(code, status = 400) {
    super(`Memory read failed (${code}).`)
    this.name = "ReadError"
    this.code = code
    this.status = status
  }
  toJSON() { return { code: this.code, status: this.status, message: this.message } }
}

export const LIMITS = Object.freeze({ bytes: 65536, depth: 12, inflight: 16, deadlineMs: 10000, outputBytes: 4 * 1024 * 1024 })
const text = maxLength => ({ type: "string", minLength: 1, maxLength })
const strings = (maxItems, maxLength) => ({ type: "array", maxItems, items: text(maxLength) })
const choice = values => ({ anyOf: [{ type: "string", enum: values }, { type: "array", maxItems: 20, items: { type: "string", enum: values } }] })
const filter = { anyOf: [text(200), strings(20, 200)] }
const schema = (properties) => ({ type: "object", additionalProperties: false, properties })
export const readRegistry = Object.freeze([
  { name: "records.get", description: "Read up to 50 records by id or path in one authorized Memory space.", inputSchema: schema({ ids: strings(50, 2048), paths: strings(50, 2048) }) },
  { name: "records.list", description: "List authorized records, newest first. Pass the returned cursor unchanged; no snapshot or replay guarantee.", inputSchema: schema({
    kind: choice(Object.keys(KINDS)), type: choice([...new Set(Object.values(KINDS).flat())]), status: choice([...STATUSES, "all"]),
    path_prefix: text(2048), limit: { type: "integer", minimum: 1, maximum: 200 }, cursor: text(4096), full: { type: "boolean" },
    created_after: text(100), created_before: text(100), updated_after: text(100), updated_before: text(100),
    author_agent: filter, task: filter, stated_by: filter, source_session: filter, contains: text(200),
  }) },
].map(tool => Object.freeze({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } })))

export function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
export function bounded(value, depth = 0) {
  if (depth > LIMITS.depth) throw new ReadError("invalid_request")
  if (value && typeof value === "object") for (const item of Object.values(value)) bounded(item, depth + 1)
  return value
}
function matches(value, rule) {
  if (rule.anyOf) return rule.anyOf.some(part => matches(value, part))
  if (rule.type === "array") return Array.isArray(value) && value.length <= rule.maxItems && value.every(item => matches(item, rule.items))
  if (rule.type === "string") return typeof value === "string" && (!rule.minLength || value.length >= rule.minLength) && (!rule.maxLength || value.length <= rule.maxLength) && (!rule.enum || rule.enum.includes(value))
  if (rule.type === "boolean") return typeof value === "boolean"
  return Number.isInteger(value) && value >= rule.minimum && value <= rule.maximum
}
export function validateRead(name, input = {}) {
  const tool = readRegistry.find(tool => tool.name === name)
  if (!tool) throw new ReadError("invalid_method")
  if (!object(input)) throw new ReadError("invalid_request")
  bounded(input)
  if (Buffer.byteLength(JSON.stringify(input)) > LIMITS.bytes) throw new ReadError("payload_too_large", 413)
  for (const [key, value] of Object.entries(input)) {
    const rule = tool.inputSchema.properties[key]
    if (!Object.hasOwn(tool.inputSchema.properties, key) || !matches(value, rule)) throw new ReadError("invalid_request")
  }
  if (name === "records.get" && (!(input.ids?.length || input.paths?.length) || (input.ids?.length ?? 0) + (input.paths?.length ?? 0) > 50)) throw new ReadError("invalid_request")
  return input
}

const safeCodes = new Set(["invalid_request", "invalid_cursor", "invalid_space", "invalid_method", "forbidden", "refused", "not_found", "records_unavailable", "unauthorized", "space_not_found", "space_role_required", "rate_limited"])
export function safeError(error) {
  if (error instanceof ReadError) return error
  const status = Number(error?.status) || (error?.name === "AbortError" || error?.name === "TimeoutError" ? 408 : 502)
  return new ReadError(safeCodes.has(error?.code) ? error.code : ({ 400: "invalid_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 408: "timeout", 429: "rate_limited" }[status] ?? "upstream_unavailable"), status)
}
