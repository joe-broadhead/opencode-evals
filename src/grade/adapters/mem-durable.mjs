// Independent durable proof. No expected answer, transcript, or claimed receipt repairs missing state.
import { canonical } from "../../util/canonical.mjs"
import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { coreWikiParagraph } from "./mem-core-markdown.mjs"

const ARRAYS = ["atoms", "records", "commitments", "knowledge", "conversations", "skills", "assets", "teamMembers", "agents", "acl", "jobs", "wikiFiles"]
const OBJECTS = ["scenarios", "core", "curated", "failures", "usage", "control"]
const plain = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v))
export function completeState(state) {
  return plain(state) && ARRAYS.every((k) => Array.isArray(state[k])) && OBJECTS.every((k) => plain(state[k])) && Number.isInteger(state.seq)
}

// The frozen stub seeds only these three families. Content is compared in full,
// including unknown nested fields; only documented seed/projector additions vary.
export function initialSeedFailure(core) {
  const before=core.before, seed=core.seed
  if (!completeState(before) || !plain(seed) || Object.keys(seed).some(k=>!["atoms","knowledge","assets"].includes(k))) return "complete frozen initial seed proof is missing"
  const expected=Object.fromEntries([...ARRAYS.map(k=>[k,structuredClone(seed[k]??[])]),...OBJECTS.map(k=>[k,k==="control"?{resources:[],grants:[],controlLog:[]} : {}]),["seq",before.seq]])
  const actual=structuredClone(before)
  if(before.seq<0 || !["atoms","knowledge","assets"].every(k=>Array.isArray(expected[k])&&actual[k].length===expected[k].length)) return "before-state differs from the frozen seed"
  const timestamp=v=>typeof v==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))
  for(const [i,atom] of actual.atoms.entries()) {
    const frozen=expected.atoms[i]
    if(!plain(atom)||!plain(frozen)) return "unverifiable initial atom shape"
    for(const [key,valid] of Object.entries({id:v=>typeof v==="string"&&/^m_\d{4,}$/.test(v),version:v=>v===1,created_at:timestamp,updated_at:timestamp})) {
      if(!Object.hasOwn(frozen,key)&&Object.hasOwn(atom,key)) {if(!valid(atom[key]))return "invalid initial atom metadata";delete atom[key]}
    }
  }
  for(const [i,w] of actual.knowledge.entries()) {
    const frozen=expected.knowledge[i]
    if(!plain(w)||!plain(frozen))return "unverifiable initial knowledge shape"
    const space=["local","eval-container-personal"].includes(frozen.team_id)?"personal":frozen.team_id==="eval-container-shared"?"shared":frozen.team_id
    if(!Object.hasOwn(frozen,"space")&&Object.hasOwn(w,"space")) {if(w.space!==space)return "invalid initial knowledge scope";delete w.space}
    if(!Object.hasOwn(frozen,"raw_versions")&&Object.hasOwn(w,"raw_versions")) {
      const versions=Object.fromEntries(Object.entries(frozen.raw??{}).map(([file,body])=>[file,{digest:createHash("sha256").update(body).digest("hex"),revision:0}]))
      if(!isDeepStrictEqual(w.raw_versions,versions))return "invalid initial RAW versions"
      delete w.raw_versions
    }
  }
  // derivedState() materializes these exact references from seeded RAW bytes.
  expected.wikiFiles=expected.knowledge.filter(w=>w.type==="llm_wiki").flatMap(w=>Object.entries(w.raw??{}).map(([filename,content])=>({team_id:w.team_id??null,wiki:w.name,wiki_id:w.knowledge_id,filename,content:String(content)})))
  return isDeepStrictEqual(actual,expected)?null:"before-state contains content outside the frozen seed"
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
  const initial=initialSeedFailure(core)
  if(initial)return initial
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
// State/operation predicates do not depend on successful native-call coverage.
// These are the two document instructions, not a selector over arbitrary state JSON or an answer fallback.
export function wikiWriteProofFailure(core) {
  if (core.proof_schema !== "oc-mem-durable-proof/2" || !completeState(core.before) || !completeState(core.state) || !Array.isArray(core.operations) || core.operations.some((o)=>!plain(o))) return "typed RAW document proof is missing"
  const initial=initialSeedFailure(core)
  if(initial)return initial
  const wikis = core.state.knowledge
  if (core.before.knowledge.length || wikis.length !== 1) return "the requested new wiki is not the only created wiki"
  const wiki = wikis[0], id = wiki.knowledge_id, file = "README.md"
  if (typeof id !== "string" || !id || wiki.space !== "personal" || wiki.name !== "Core Notes") return "wiki resource/name/private scope differs"
  const ops = core.operations
  const scope = (o, turn) => o.binding === "bound" && o.case_id === core.case_id && typeof core.trial_id === "string" && core.trial_id && o.trial_id === core.trial_id && typeof o.call_id === "string" && o.call_id && o.request_session === o.session && o.turn === turn && o.session === core.turns[turn-1].session && o.space === "personal" && o.wiki_id === id
  const select = (turn, operation, status) => ops.filter((o) => scope(o,turn) && o.operation === operation && o.status === status && o.filename === file)
  const create = ops.filter((o) => scope(o,1) && o.operation === "wiki.create" && o.status === "stored" && (o.filename === undefined || o.filename === file)), first = select(1, "wiki.raw.write", "stored"), append = select(2, "wiki.raw.write", "stored")
  const read = ops.filter((o) => scope(o,3) && ["wiki.raw.read", "wiki.page.read"].includes(o.operation) && o.status === "read" && o.filename === file)
  if (create.length !== 1 || first.length !== 1 || append.length !== 1 || read.length !== 1) return "per-turn create/write/append/read observations are incomplete"
  const a = first[0], b = append[0], r = read[0]
  if (create[0].name !== "Core Notes" || !coreWikiParagraph(a.body,"initial") || a.before_version !== null || a.version !== sha(a.body) || a.revision !== 1) return "initial RAW README was not successfully created"
  if (typeof b.body !== "string" || b.before_body !== a.body || !b.body.startsWith(a.body) || !coreWikiParagraph(b.body.slice(a.body.length),"append") || b.before_version !== a.version || b.version !== sha(b.body) || b.version === a.version || b.revision !== 2) return "the actual append did not preserve and extend the initial RAW body/version"
  const raw = wiki.raw?.[file], version = wiki.raw_versions?.[file]
  if (Object.keys(wiki.raw??{}).length !== 1) return "an unrequested RAW document was written"
  const required = new Set([create[0],a,b,read[0]])
  if (ops.some((o)=>!required.has(o) && !([1,2].includes(o.turn) && scope(o,o.turn) && o.filename===file && o.status==="read" && ["wiki.raw.read","wiki.page.read"].includes(o.operation) && [a,b].some((v)=>o.body===v.body&&o.version===v.version&&o.revision===v.revision)))) return "unrelated, failed, or extra non-read operations occurred"
  if (raw !== b.body || version?.digest !== b.version || version?.revision !== b.revision || r.body !== raw || r.version !== b.version || r.revision !== b.revision) return "final RAW state and readback are not the appended document/version"
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

// Called only after the independent state/operation proof. Each obligation uses
// its own turn's coverage. An unavailable turn cannot erase another turn's error.
export function wikiWriteCallEvidence(core) {
  const wiki=core.state.knowledge[0],file="README.md",successful=[]
  let unavailable=false
  for(const [index,actions]of [["create"],["append"],["read","search"]].entries()){
    const turn=core.turns[index],calls=turn.calls.filter(c=>/^(?:mem_|mem\.)wiki$/.test(c.tool))
    const called=calls.find(c=>c.status==="completed"&&plain(c.args)&&actions.includes(c.args.action)&&(index===0?c.args.name==="Core Notes"&&(c.args.filename===undefined||c.args.filename===file):c.args.wiki_id===wiki.knowledge_id&&c.args.filename===file))
    successful[index]=called
    if(called)continue
    if(calls.some(c=>c.status==="error"||c.status==="completed"))return {state:"fail",detail:`wiki turn ${index+1} has no successful invocation with the required input`}
    if(turn.calls_complete===false||calls.some(c=>c.status!=="completed"&&c.status!=="error"))unavailable=true
    else return {state:"fail",detail:`wiki turn ${index+1} has no required invocation`}
  }
  // Output attribution needs the successful read, but not successful write captures.
  if(successful[2]&&!text(successful[2].output).includes(text(wiki.raw[file])))return {state:"fail",detail:"native read output does not contain the final document body"}
  return unavailable?{state:"unverifiable",detail:"successful wiki invocation coverage is unavailable"}:{state:"ok"}
}
