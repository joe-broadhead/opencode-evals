// One rule for reading one integration's credential out of an `auth export` answer, shared by the walk and the harness.

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)

/** A name compared by its letters: lowercase, whitespace removed. */
export const normName = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, "")

/** Is this element credential-shaped (OpenCode's Credential.Entry): a string id and integrationID, a boolean active, an object value with
 *  a string type, and no RpcError/_tag or error key? An export is only an answer when every element is. */
export const credentialShaped = (c) =>
  isObject(c) &&
  typeof c.id === "string" &&
  typeof c.integrationID === "string" &&
  typeof c.active === "boolean" &&
  isObject(c.value) &&
  typeof c.value.type === "string" &&
  !("_tag" in c) &&
  !("error" in c)

/** The active credential of an integration from an `auth export <name>` answer, or null. Returns the parsed object (secrets inside: keep it in
 *  memory). The integration id is matched first, then the name (a credential's label; the host resolves `auth export` by the integration's
 *  name, and an MCP server's name becomes its label), then every entry of that integration, and only the ACTIVE one is returned: never a
 *  stale inactive credential. */
export function activeCredential(exported, integration) {
  let list
  try {
    list = JSON.parse(exported)
  } catch {
    return null
  }
  if (!Array.isArray(list)) list = list?.credentials ?? []
  const want = normName(integration)
  const named = list.filter((c) => credentialShaped(c) && normName(c?.integrationID) === want)
  // (a re-sign-in's label gets a number: `Linear 2`, `X app 2`)
  const byLabel = (c) => normName(c?.label) === want || normName(c?.label).replace(/\d+$/, "") === want
  const hits = named.length ? named : list.filter((c) => credentialShaped(c) && byLabel(c))
  const ids = new Set(hits.map((c) => c.integrationID))
  return list.find((c) => credentialShaped(c) && ids.has(c?.integrationID) && c?.active) ?? null
}
