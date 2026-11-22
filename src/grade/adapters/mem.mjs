// Only the Memory synthetic fixture's durable capture, never a model's output, supplies state facts.
// Missing/oversized/malformed captures return null so the existing grader BLOCKS instead of passing.
export function memState(files) {
  if (!Array.isArray(files)) return null
  const captures = files.filter((f) => f.path === "mem-fixture/capture.json" && f.change !== "deleted")
  if (captures.length !== 1 || typeof captures[0].text !== "string") return null
  let data
  try { data = JSON.parse(captures[0].text) } catch { return null }
  if (data.schema !== "oc-mem-capture/1" || data.fixture !== "mem-synthetic-v1" || !Array.isArray(data.requests)) return null
  const facts = {}
  for (const space of ["personal", "shared"]) {
    const before = data.before?.[space], after = data.after?.[space]
    if (!Array.isArray(before?.records) || !Array.isArray(after?.records) || !after.raw || typeof after.raw !== "object" || Array.isArray(after.raw)) return null
    if (!Object.values(after.raw).every((v) => typeof v === "string")) return null
    facts[space] = {
      records: after.records.length,
      memories: after.records.filter((r) => r.kind === "memory").length,
      pages: after.records.filter((r) => r.kind === "page").length,
      commitments: after.records.filter((r) => r.kind === "commitment").length,
      wiki: { files: Object.keys(after.raw).length, text: Object.keys(after.raw).sort().map((k) => after.raw[k]).join("\n") },
      bodies: Object.fromEntries(["memory", "page", "commitment"].map((kind) => [kind, after.records.filter((r) => r.kind === kind).map((r) => r.body).join("\n")])),
      changed: JSON.stringify(before) !== JSON.stringify(after),
    }
  }
  facts.receipts = Object.fromEntries(["stored", "queued", "denied", "processing", "unsupported"].map((status) => [status, data.requests.filter((r) => r.status === status).length]))
  facts.requests = data.requests.length
  const reads = data.requests.filter((r) => r.status === "read")
  const last = reads.at(-1)?.output
  facts.reads = { count: reads.length, last_text: last?.content ?? (last?.records ?? []).map((r) => r.body).join("\n") }
  const lists = data.requests.filter((r) => r.method === "records.list")
  facts.list = { more: lists.at(-1)?.output?.more ?? false }
  facts.capture = data
  return { mem: facts }
}
