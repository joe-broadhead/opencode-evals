// Offline synthetic backend model. No listener, credentials, source plugins or arbitrary upstream forwarding.
// The later container transport must map the real plugin's HTTP requests to this finite contract.
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { resolve, join } from "node:path"

const empty = () => ({ personal: { records: [], raw: {} }, shared: { records: [], raw: {} } })
const WIKIS = { "wiki-eval-personal": "personal", "wiki-eval-shared": "shared" }
const METHODS = new Set(["wiki.raw.write", "wiki.raw.read", "records.put", "records.get", "records.list", "records.revise"])
const INPUTS = { "records.put": ["record", "space"], "records.get": ["id", "space"], "records.list": ["limit", "cursor", "space"], "records.revise": ["id", "action", "space"] }
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v)

export function openFixture(directory) {
  const dir = resolve(directory)
  if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw new Error("fixture directory must not be a symlink")
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, "capture.json")
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error("fixture capture must not be a symlink")
  let state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { schema: "oc-mem-capture/1", fixture: "mem-synthetic-v1", before: empty(), after: empty(), requests: [] }
  if (state.schema !== "oc-mem-capture/1" || state.fixture !== "mem-synthetic-v1") throw new Error("not a synthetic Memory fixture")
  const persist = () => {
    // Exclusive temporary creation prevents a planted link being followed. No values leave this directory.
    const temp = join(dir, `capture-${process.pid}-${state.requests.length}.tmp`)
    writeFileSync(temp, JSON.stringify(state), { flag: "wx", mode: 0o600 })
    renameSync(temp, file)
  }
  return {
    snapshot: () => structuredClone(state),
    call(method, input) {
      if (!METHODS.has(method)) throw new Error(`unsupported fixture method ${method}`)
      if (!plain(input)) throw new Error("input must be an object")
      const keys = INPUTS[method] ?? (method === "wiki.raw.write" ? ["wiki_id", "filename", "content"] : ["wiki_id", "filename"])
      if (Object.keys(input).some((key) => !keys.includes(key))) throw new Error("unsupported input field")
      const space = method.startsWith("records.") ? (input.space ?? "personal") : WIKIS[input.wiki_id]
      if (!["personal", "shared"].includes(space)) throw new Error("only reserved synthetic space aliases route")
      if (!space) throw new Error("only reserved synthetic wiki aliases route")
      if (method.startsWith("wiki.") && (typeof input.filename !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(input.filename))) throw new Error("filename must be flat")
      let output
      if (method === "records.put") {
        const record = input.record
        if (!plain(record) || Object.keys(record).some((k) => !["kind", "type", "body", "path"].includes(k)) || !["memory", "page", "commitment"].includes(record.kind) || typeof record.body !== "string" || record.body.length > 8192) throw new Error("unsupported record input")
        if (record.kind === "page" && (typeof record.path !== "string" || !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(record.path))) throw new Error("invalid page path")
        const saved = { ...record, id: `rec_eval_${state.after.personal.records.length + state.after.shared.records.length + 1}`, status: "current", version: 1 }
        state.after[space].records.push(saved)
        output = { status: "stored", record: saved }
      } else if (method === "records.get" || method === "records.revise") {
        const record = state.after[space].records.find((r) => r.id === input.id)
        if (!record) throw new Error("record not found")
        if (method === "records.revise") {
          if (!["retire", "restore"].includes(input.action)) throw new Error("unsupported revise action")
          record.status = input.action === "retire" ? "retired" : "current"
          record.version += 1
          output = { status: "stored", record }
        } else output = { status: "read", records: [record] }
      } else if (method === "records.list") {
        const limit = input.limit ?? 2
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("invalid limit")
        let offset = 0
        if (input.cursor !== undefined) {
          const match = /^mem-eval:(personal|shared):(\d+):(\d+)$/.exec(input.cursor)
          if (!match || match[1] !== space || Number(match[2]) !== limit) throw new Error("invalid cursor or changed arguments")
          offset = Number(match[3])
        }
        const records = state.after[space].records.slice(offset, offset + limit)
        const more = offset + limit < state.after[space].records.length
        output = { status: "read", records, more, cursor: more ? `mem-eval:${space}:${limit}:${offset + limit}` : null }
      } else if (method === "wiki.raw.write") {
        if (typeof input.content !== "string" || Buffer.byteLength(input.content) > 8192) throw new Error("content must be at most 8192 bytes")
        state.after[space].raw[input.filename] = input.content
        output = { status: "stored", filename: input.filename }
      } else {
        const content = state.after[space].raw[input.filename]
        if (content === undefined) throw new Error("source not found")
        output = { status: "read", filename: input.filename, content }
      }
      output = structuredClone(output)
      state.requests.push({ method, space, status: output.status, input: structuredClone(input), output })
      persist()
      return output
    },
  }
}
