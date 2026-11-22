// Closed Memory-specific extractors. No local:true bypass: implicit writes resolve to the container's reserved scope.
import {discoveryShape} from "./mem-discovery-shapes.mjs"
export const validMemoryBinding = (b) => b?.schema === "oc-mem-contained/1" && b.fixture === "mem-synthetic-v1" && b.backend === "container" && b.origin === "http://127.0.0.1:4617"
const OPS = {
  page: { read: ["list", "read", "links", "history"], write: ["write", "append", "replace", "move", "delete", "export"] },
  wiki: { read: ["list", "search", "read", "status", "graph", "documents", "pages"], write: ["create", "write", "append", "delete"] },
  commitments: { read: ["list"], write: ["add", "update", "delete"] },
  revise: { read: ["history"], write: ["correct", "confirm", "retire", "restore", "forget"] },
}
const KEYS = {
  recall: ["query", "task", "visibility", "in", "types", "status", "limit", "space", "filter", "cursor"],
  remember: ["content", "kind", "why", "links", "supersedes", "stated_by", "task", "visibility"],
  page: ["action", "path", "prefix", "type", "title", "content", "section", "to", "depth", "confirm", "space"],
  wiki: ["action", "query", "knowledge_id", "wiki_id", "name", "filename", "content", "ingest", "ref", "confirm", "path", "visibility", "type", "space", "cursor"],
  commitments: ["action", "id", "what", "owner", "due", "trigger", "state", "project", "link", "due_before"],
  revise: ["action", "id", "ids", "content", "reason"],
}
const familyOf = (tool) => /^(?:mem_|mem\.)(recall|remember|page|wiki|commitments|revise|spaces|read|code)$/.exec(tool)?.[1]
const pathOK = (p) => typeof p === "string" && /^[a-z0-9-]+(?:\/[a-z0-9-]+)*\/?$/.test(p)

export function memoryCall(tool, input, binding = {}) {
  const family = familyOf(tool)
  if (!family) return null
  if(["spaces","read","code"].includes(family))return discoveryShape(family,input)
  const fail = (error) => ({ family, error, write: true })
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !KEYS[family].includes(k))) return fail("unknown or malformed Memory input")
  if (family === "recall") return typeof input.query === "string" && input.query.trim() ? { family, action: "recall", write: false } : fail("missing recall query")
  const action = family === "remember" ? "remember" : input.action
  if(family==="wiki"&&["graph","documents","pages"].includes(action)){
    if(Object.keys(input).some(k=>!["action","wiki_id","space","cursor"].includes(k))||["wiki_id","space"].some(k=>input[k]!==undefined&&(typeof input[k]!=="string"||!input[k]||input[k].length>200))||input.cursor!==undefined&&(typeof input.cursor!=="string"||input.cursor.length>4096))return fail("invalid closed wiki read arguments")
  }
  const read = OPS[family]?.read.includes(action) ?? false
  if (family !== "remember" && !read && !OPS[family].write.includes(action)) return fail("unknown Memory action")
  if (read) return { family, action, write: false }
  if (family === "remember" && (typeof input.content !== "string" || !["fact", "decision", "preference", "constraint", "procedure"].includes(input.kind) || (input.visibility !== undefined && input.visibility !== "private"))) return fail("invalid private memory arguments")
  if (family === "page") {
    if (action !== "export" && !pathOK(input.path ?? input.prefix)) return fail("invalid page path")
    if (action === "move" && !pathOK(input.to)) return fail("invalid page destination")
    if (["write", "append", "replace"].includes(action) && typeof input.content !== "string") return fail("missing page content")
  }
  if (family === "wiki") {
    if (action !== "create" && !["wiki-eval-personal", "wiki-eval-shared"].includes(input.wiki_id) && !binding.wiki_spaces?.[input.wiki_id]) return fail("only reserved synthetic wikis are writable")
    if (["write", "append"].includes(action) && (typeof input.content !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(input.filename))) return fail("invalid flat document write")
  }
  const ids = input.ids ?? (input.id ? [input.id] : [])
  if ((family === "revise" || (family === "commitments" && action !== "add")) && (!Array.isArray(ids) || !ids.length || ids.some((id) => !/^rec_[A-Za-z0-9_]{1,128}$/.test(id)))) return fail("only registered synthetic record ids are writable")
  if (family === "commitments" && action === "add" && typeof input.what !== "string") return fail("missing commitment text")
  const recordScopes = ids.map((id) => binding.record_spaces?.[id])
  if (ids.length && (recordScopes.some((s) => !["spc-eval-personal", "spc-eval-shared"].includes(s)) || new Set(recordScopes).size !== 1)) return fail("record target scope is unknown or mixed")
  const scope = input.space ?? recordScopes[0] ?? binding.wiki_spaces?.[input.wiki_id] ?? (input.wiki_id === "wiki-eval-shared" ? "shared" : "personal")
  const target = ({ personal: "spc-eval-personal", shared: "spc-eval-shared", "spc-eval-personal": "spc-eval-personal", "spc-eval-shared": "spc-eval-shared" })[scope]
  if (!target) return fail("only reserved synthetic spaces are writable")
  if (family === "wiki" && input.wiki_id && target !== (binding.wiki_spaces?.[input.wiki_id] ?? (input.wiki_id === "wiki-eval-shared" ? "spc-eval-shared" : "spc-eval-personal"))) return fail("wiki id and requested scope disagree")
  if (recordScopes.length && recordScopes[0] !== target) return fail("record id and requested scope disagree")
  return { family, action, write: true, target }
}
