// Independent durable proof. No expected answer, transcript, or claimed receipt repairs missing state.
import { canonical } from "../../util/canonical.mjs"
import { createHash } from "node:crypto"

const ARRAYS = ["atoms", "records", "commitments", "knowledge", "conversations", "skills", "assets", "teamMembers", "agents", "acl", "jobs", "wikiFiles"]
const OBJECTS = ["scenarios", "core", "curated", "failures", "usage", "control"]
const plain = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v))
export function completeState(state) {
  return plain(state) && ARRAYS.every((k) => Array.isArray(state[k])) && OBJECTS.every((k) => plain(state[k])) && Number.isInteger(state.seq)
}

const READS = new Set([
  "/v1/context", "/v1/spaces", "/v1/grants", "/v1/resources",
  "/v3/atomic/count", "/v3/conversation/count", "/v3/scenario/ls", "/v3/scenario/count", "/v3/scenario/read", "/v3/core/read", "/v3/knowledge/list",
  "/v3/meta/team-member/list", "/v3/meta/agent/list", "/v3/meta/asset/list-accessible",
  ...["atomic", "conversation"].flatMap((f) => ["search", "query", "list", "get"].map((a) => `/v3/${f}/${a}`)),
  ...["list", "get", "graph", "raw/read", "page/read", "page/ls"].map((a) => `/v3/wiki/${a}`),
  ...["list", "get", "status", "files", "search", "callers", "callees", "impact", "explore", "node"].map((a) => `/v3/code-graph/${a}`),
  ...["list", "get"].map((a) => `/v3/skill/${a}`),
  ...["records.get", "records.list", "records.search", "records.history", "records.links", "records.backlinks", "space.stats", "sources.list", "agents.mine"].map((a) => `/records/v1/${a}`),
])
function technicalRequest(request, before) {
  if (request.verb !== "POST" || request.method !== "/v3/meta/asset/touch-usage") return false
  const input = request.input
  return plain(input) && Object.keys(input).every((k) => ["asset_id", "user_id", "agent_id", "team_id"].includes(k)) && before.assets.some((a) => a.asset_id === input.asset_id)
}
function readRequest(request) {
  if (typeof request.method !== "string") return false
  if (request.verb === "GET") return typeof request.method === "string" && !/[%.]/.test(request.method) && /^\/v1\/(?:context|spaces|grants|resources)(?:$|[/?])/.test(request.method)
  return request.verb === "POST" && !request.method.startsWith("/v1/") && READS.has(request.method)
}
function metadataOnly(state, before) {
  const copy = structuredClone(state)
  // Only the stub's request sequence and seeded-asset usage bookkeeping are exempt.
  delete copy.seq
  if (!plain(copy.usage) || Object.entries(copy.usage).some(([id, n]) => !before.assets.some((a) => a.asset_id === id) || !Number.isInteger(n) || n < 0)) return null
  delete copy.usage
  for (const asset of copy.assets) {
    if (asset.usage_count !== undefined && (!Number.isInteger(asset.usage_count) || asset.usage_count < 0)) return null
    if (asset.last_used_at !== undefined && !Number.isFinite(Date.parse(asset.last_used_at))) return null
    delete asset.usage_count
    delete asset.last_used_at
  }
  return copy
}
function readCall(call) {
  const family = String(call.tool).replace(/^mem[._]/, "")
  if (family === "recall") return true
  const actions = {
    wiki: ["list", "search", "read", "status"], page: ["list", "read", "links", "history"],
    commitments: ["list"], revise: ["history"], spaces: ["current", "list", "health", "members", "access"],
  }
  return plain(call.args) && Boolean(actions[family]?.includes(call.args.action))
}

export function readonlyProofFailure(core) {
  if (core.proof_schema !== "oc-mem-durable-proof/2" || !completeState(core.before) || !completeState(core.state)) return "complete authoritative before/after state is missing"
  // The frozen core seeds contain only atoms, knowledge and assets. An injected baseline is not permission.
  if (Object.keys(core.before).some((k)=>![...ARRAYS,...OBJECTS,"seq"].includes(k)) || ARRAYS.filter((k)=>!["atoms","knowledge","assets"].includes(k)).some((k)=>core.before[k].length) || OBJECTS.filter((k)=>k!=="control").some((k)=>Object.keys(core.before[k]).length) || canonical(core.before.control)!==canonical({resources:[],grants:[],controlLog:[]}) || canonical(core.before.assets)!==canonical(core.seed.assets??[])) return "before-state contains content outside the frozen seed"
  const before = metadataOnly(core.before, core.before), after = metadataOnly(core.state, core.before)
  if (!before || !after || canonical(before) !== canonical(after)) return "read-only durable content changed in a family or space"
  if (!Array.isArray(core.effects) || core.effects.length) return "read-only case has a write effect"
  if (!Array.isArray(core.operations) || core.operations.some((o) => !plain(o) || !["wiki.raw.read", "wiki.page.read"].includes(o.operation))) return "read-only case has a non-read operation"
  if (!Array.isArray(core.requests) || core.requests.some((r) => !plain(r) || (!readRequest(r) && !technicalRequest(r, core.before)))) return "read-only case has a non-read or untyped backend request"
  if (core.turns.some((t) => t.calls.some((c) => String(c.tool).startsWith("mem") && !readCall(c)))) return "read-only case invoked a content-changing Memory action"
  return null
}

const text = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase()
const sha = (s) => createHash("sha256").update(s).digest("hex")
// These are the two document instructions, not a selector over arbitrary state JSON or an answer fallback.
const INITIAL_README = "The gateway resolves context before routing."
const APPENDED_DECISION = "The control plane uses PostgreSQL for PITR."
export function wikiWriteProofFailure(core) {
  if (core.proof_schema !== "oc-mem-durable-proof/2" || !completeState(core.before) || !completeState(core.state) || !Array.isArray(core.operations) || core.operations.some((o)=>!plain(o))) return "typed RAW document proof is missing"
  const wikis = core.state.knowledge
  if (core.before.knowledge.length || wikis.length !== 1) return "the requested new wiki is not the only created wiki"
  const wiki = wikis[0], id = wiki.knowledge_id, file = "README.md"
  if (typeof id !== "string" || !id || wiki.space !== "personal" || wiki.name !== "Core Notes") return "wiki resource/name/private scope differs"
  const native = core.turns.map((t) => t.calls.filter((c) => /^(?:mem_|mem\.)wiki$/.test(c.tool)))
  const called = (turn, actions) => native[turn - 1].find((c) => c.status === "completed" && plain(c.args) && actions.includes(c.args.action) && (turn === 1 ? c.args.name === "Core Notes" && (c.args.filename === undefined || c.args.filename === file) : c.args.wiki_id === id && c.args.filename === file))
  if (!called(1, ["create"]) || !called(2, ["append"]) || !called(3, ["read", "search"])) return "successful typed create/append/read calls are missing"
  const ops = core.operations
  const scope = (o, turn) => o.turn === turn && o.session === core.turns[turn-1].session && o.space === "personal" && o.wiki_id === id
  const select = (turn, operation, status) => ops.filter((o) => scope(o,turn) && o.operation === operation && o.status === status && o.filename === file)
  const create = ops.filter((o) => scope(o,1) && o.operation === "wiki.create" && o.status === "stored" && (o.filename === undefined || o.filename === file)), first = select(1, "wiki.raw.write", "stored"), append = select(2, "wiki.raw.write", "stored")
  const read = ops.filter((o) => scope(o,3) && ["wiki.raw.read", "wiki.page.read"].includes(o.operation) && o.status === "read" && o.filename === file)
  if (create.length !== 1 || first.length !== 1 || append.length !== 1 || read.length !== 1) return "per-turn create/write/append/read observations are incomplete"
  const a = first[0], b = append[0], r = read[0]
  if (create[0].name !== "Core Notes" || typeof a.body !== "string" || text(a.body) !== text(INITIAL_README) || a.before_version !== null || a.version !== sha(a.body) || a.revision !== 1) return "initial RAW README was not successfully created"
  if (typeof b.body !== "string" || b.before_body !== a.body || !b.body.startsWith(a.body) || text(b.body.slice(a.body.length)) !== text(APPENDED_DECISION) || b.before_version !== a.version || b.version !== sha(b.body) || b.version === a.version || b.revision !== 2) return "the actual append did not preserve and extend the initial RAW body/version"
  const raw = wiki.raw?.[file], version = wiki.raw_versions?.[file]
  if (Object.keys(wiki.raw??{}).length !== 1) return "an unrequested RAW document was written"
  const required = new Set([create[0],a,b,read[0]])
  if (ops.some((o)=>!required.has(o) && !([1,2].includes(o.turn) && scope(o,o.turn) && o.filename===file && o.status==="read" && ["wiki.raw.read","wiki.page.read"].includes(o.operation) && [a,b].some((v)=>o.body===v.body&&o.version===v.version&&o.revision===v.revision)))) return "unrelated, failed, or extra non-read operations occurred"
  if (raw !== b.body || version?.digest !== b.version || version?.revision !== b.revision || r.body !== raw || r.version !== b.version || r.revision !== b.revision) return "final RAW state and readback are not the appended document/version"
  if (!text(called(3, ["read", "search"]).output).includes(text(raw))) return "native read output does not contain the final document body"
  // The user authorized one private document, not records or content in another family/space.
  const before = metadataOnly(core.before, core.before), after = metadataOnly(core.state, core.before)
  if (!before || !after) return "invalid durable snapshot"
  delete before.knowledge; delete after.knowledge
  if (before.wikiFiles.length || after.wikiFiles.some((f)=>f.wiki_id!==id||f.filename!==file||f.content!==raw||f.wiki!=="Core Notes"||!["local","eval-container-personal"].includes(f.team_id))) return "derived RAW files escaped the requested document"
  delete before.wikiFiles; delete after.wikiFiles
  const assets = after.assets
  if (assets.length && assets.some((a) => a.content_ref !== id || a.asset_type !== "llm_wiki" || a.visibility !== "private" || a.owner_user_id !== "eval" || !["local", "eval-container-personal"].includes(a.team_id))) return "a wiki asset escaped the requested private resource"
  delete before.assets; delete after.assets
  if (canonical(before) !== canonical(after)) return "wiki-only request changed another durable family/space"
  return null
}
