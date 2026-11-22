import { coreCases } from "../../../packs/mem/core.mjs"
import { selectCalls } from "../select.mjs"
const norm = (v) => String(v).trim().toLowerCase().replace(/[.$,]/g, "").replace(/\s+/g, " ")

export function memoryCoreEvidence(id, view) {
  const s = coreCases.find((c) => c.original_id === id)
  if (!s?.seed) return { state: "unverifiable", detail: `core ${id}: frozen typed truth is missing; coverage blocked, never n/a` }
  const fail = (detail) => ({ state: "fail", detail: `core ${id}: ${detail}` })
  const capture = view.state?.mem?.capture
  if (!capture) return { state: "unverifiable", detail: `core ${id}: no authoritative Memory fixture capture` }
  if (JSON.stringify(capture.before?.personal?.records?.map((r) => r.body)) !== JSON.stringify(s.seed)) return fail("seed bodies/scopes do not match frozen truth")
  if (JSON.stringify(capture.after) !== JSON.stringify(capture.before)) return fail("a read-only core case changed durable state")
  const support = s.polarity ? "freeze" : norm(s.answers[0])
  const read = capture.requests?.some((r) => r.space === "personal" && r.status === "read" && ["records.list", "records.search", "records.get"].includes(r.method) && (r.output?.records ?? []).some((v) => s.seed.includes(v.body) && norm(v.body).includes(support)))
  if (!read) return fail("answer was not backed by the fixture read")
  const calls = selectCalls(view.calls, "mem.recall")
  if (!calls.some((c) => typeof (c.raw_args ?? c.args)?.query === "string" && (c.raw_args ?? c.args).query.trim())) return fail("no correctly typed recall call")
  let answer
  try { answer = JSON.parse(view.answer.text) } catch { return fail("answer is not the frozen JSON contract") }
  if (!answer || typeof answer !== "object" || Array.isArray(answer) || !Object.hasOwn(answer, "value") || Object.keys(answer).some((k) => !["value", "evidence"].includes(k))) return fail("answer has the wrong typed shape")
  const value = s.polarity ? norm(answer.value).split(" ")[0] : norm(answer.value)
  if (!s.answers.some((v) => norm(v) === value)) return fail("answer value contradicts literal truth")
  return { state: "ok", detail: `core ${id}: frozen seed, read and JSON value agree` }
}
