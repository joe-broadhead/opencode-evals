// A finite in-container gateway codec, not an HTTP client. Unknown methods never forward anywhere.
export const SYNTHETIC_TOKEN = "mem-eval-synthetic-only"
export const PORT = 4617
export const SPACE_IDS = Object.freeze({ "spc-eval-personal": "personal", "spc-eval-shared": "shared" })
const ROUTES = Object.freeze({
  "/records/v1/records.put": "records.put", "/records/v1/records.get": "records.get",
  "/records/v1/records.list": "records.list", "/records/v1/records.revise": "records.revise",
  "/v3/wiki/raw/write": "wiki.raw.write", "/v3/wiki/raw/read": "wiki.raw.read",
  "/knowledge/v3/wiki/raw/write": "wiki.raw.write", "/knowledge/v3/wiki/raw/read": "wiki.raw.read",
})
const response = (status, body) => ({ status, body })
export function fixtureResponse(fixture, { method, path, headers = {}, body = {} }) {
  if (typeof path !== "string" || !/^\/[a-z0-9/.-]+$/i.test(path) || path.includes("..") || path.startsWith("//")) return response(400, { error: "only closed local fixture paths are accepted" })
  if (method === "GET" && path === "/health") return response(200, { fixture: "mem-synthetic-v1" })
  if (headers.authorization !== `Bearer ${SYNTHETIC_TOKEN}`) return response(401, { error: "synthetic credential required" })
  const space = headers["x-mem-space-id"] ? SPACE_IDS[headers["x-mem-space-id"]] : "personal"
  if (!space) return response(403, { error: "only reserved synthetic spaces are routable" })
  if (!body || typeof body !== "object" || Array.isArray(body)) return response(400, { error: "object input required" })
  if (Object.keys(body).some((k) => ["space", "role", "user", "token", "authorization"].includes(k))) return response(400, { error: "the gateway owns identity and scope" })
  if (method !== "POST" || !Object.hasOwn(ROUTES, path)) return response(501, { error: "unsupported synthetic fixture route" })
  try {
    const op = ROUTES[path]
    const result = fixture.call(op, { ...body, ...(op.startsWith("records.") ? { space } : {}) })
    return response(200, op.startsWith("records.") ? result : { code: 0, data: result })
  } catch (e) { return response(/reserved/.test(e.message) ? 403 : 400, { error: e.message }) }
}
