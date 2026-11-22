#!/usr/bin/env node
/**
 * Local stand-in for the memory backend.
 *
 * Implements the subset of the `/v3/*` contract the plugin uses, plus a
 * simulated curation pipeline (L0 -> L1 -> L2 -> L3) and a wiki/code-graph tool
 * catalog. It exists so the plugin can be exercised end to end without a full
 * deployment.
 *
 * It is a test harness, not a production server: storage is a JSON file, search
 * is token overlap, and extraction is rule-based rather than model-based. It
 * models the *contract and lifecycle*, not the quality of a real LLM pipeline.
 */
import http from "node:http"
import { classify, clampVisibility, normalise, paraphrase, score } from "./text.js"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { actorFrom, handleRecords, openRecordsStore } from "./records-adapter.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.MEM_STUB_PORT || 8420)
const DATA_FILE = process.env.MEM_STUB_DATA || path.join(here, "data", "state.json")
/**
 * By default the stub keeps one global persona and one scenario map, which is
 * enough for a single-container plugin test. With `MEM_STUB_ISOLATE_CURATED=1`
 * L2 scenarios and the L3 persona are kept per (team_id, agent_id), the
 * isolation the gateway relies on upstream, so a test can hold two containers
 * on one stub (space export, import, and purge use it).
 */
const ISOLATE_CURATED = process.env.MEM_STUB_ISOLATE_CURATED === "1"
/**
 * L0 -> L1 extraction copies each user sentence verbatim by default. The
 * deployed core's extractor is a model and rewrites the wording. With
 * `MEM_STUB_EXTRACT=rewrite` the stub paraphrases each sentence
 * deterministically, as such an extractor does: function words go, every
 * second content word is dropped, the rest change number and lead the atom,
 * and the specific tokens follow. Numbers, identifiers, quoted text, and
 * capitalised names are kept verbatim. A client that matches an atom to its
 * turn by verbatim text passes under the default and fails under this one.
 */
const EXTRACT = process.env.MEM_STUB_EXTRACT === "rewrite" ? "rewrite" : "verbatim"
/**
 * Wiki ingestion finishes at once by default. With `MEM_STUB_INGEST_MS` (or
 * `POST /debug/ingest {ms}`) it takes that long, as the hub's does: the wiki
 * reports `processing`, refuses writes and deletes with `409 wiki is
 * processing`, refuses a second ingest with `409 busy`, and lists no pages
 * and finds nothing until it is ready.
 */
const DEFAULT_INGEST_MS = Math.max(0, Number(process.env.MEM_STUB_INGEST_MS ?? 0) || 0)
/** MEM_STUB_SEARCH_MS delays every L0/L1 search, so a test can stand in for a slow core. */
const SEARCH_MS = Math.max(0, Number(process.env.MEM_STUB_SEARCH_MS ?? 0) || 0)

function emptyState() {
  return {
    atoms: [],
    conversations: [],
    scenarios: {},
    core: {},
    skills: [],
    knowledge: [],
    assets: [],
    teamMembers: [],
    agents: [],
    acl: [],
    usage: {},
    jobs: [],
    // Per (team, agent) L2/L3 when ISOLATE_CURATED is set: key -> { scenarios, core }.
    curated: {},
    // Injected failures: route -> { times, status }.
    failures: {},
    seq: 0,
  }
}

function load() {
  try {
    return { ...emptyState(), ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) }
  } catch {
    return emptyState()
  }
}

let state = load()

/**
 * The records service (`/records/v1/*`, contract §2.4) through
 * `records-adapter.js`: lane REC's store, as the records service runs it. Kept
 * next to the state file, so a restarted stub keeps its records.
 */
const recordsStore = await openRecordsStore({ dataDir: `${DATA_FILE}.records`, now: () => new Date(iso()) })
const recordsRuns = new Map()
/** The debug view reads every space as its owner; a read records no meta. */
const DEBUG_READER = Object.freeze({ user: "stub-debug", role: "owner", grants: [] })

/**
 * Every space's records, for `GET /debug/state`: `records` lists them with
 * their container, and each commitment record also appears in `commitments`
 * in the shape the hub file used, so an eval reads one list either way.
 */
async function recordsState() {
  const records = []
  const commitments = []
  // listSpaces() answers every space's meta (contract §2.4): the space id and
  // the container its writes named, which evals label rows by.
  for (const meta of await recordsStore.listSpaces()) {
    const spaceId = meta.space
    const space = recordsStore.forSpace(spaceId)
    const team = meta.team ?? spaceId
    let cursor
    for (let page = 0; page < 50; page += 1) {
      const listed = await space.list({ status: "all", limit: 200, full: true, ...(cursor ? { cursor } : {}) }, DEBUG_READER)
      for (const record of listed.records) {
        records.push({ ...record, space_id: spaceId, team_id: team })
        if (record.kind === "commitment") {
          const fields = record.fields ?? {}
          commitments.push({
            id: record.id,
            what: fields.what ?? record.title,
            owner: fields.owner ?? "user",
            ...(fields.due ? { due: fields.due } : {}),
            ...(fields.trigger ? { trigger: fields.trigger } : {}),
            state: fields.state ?? "open",
            ...(fields.project ? { project: fields.project } : {}),
            ...(fields.link ? { link: fields.link } : {}),
            ...(fields.closed_at ? { closed: String(fields.closed_at).slice(0, 10) } : {}),
            ...(fields.legacy_id ? { legacy_id: fields.legacy_id } : {}),
            space_id: spaceId,
            team_id: team,
          })
        }
      }
      cursor = listed.cursor
      if (!cursor) break
    }
  }
  return { records, commitments }
}

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2))
}

/**
 * The next id with a prefix. Atoms are `m_…`, as the deployed core mints them
 * (`m_<ms>_<hex>`), so they never look like a records id (`rec_` + ULID).
 */
function nextID(prefix) {
  state.seq += 1
  return `${prefix}_${String(state.seq).padStart(4, "0")}`
}

function envelope(data, code = 0, message = "ok") {
  return { code, message, request_id: `stub-${Date.now()}`, data }
}

/**
 * `MEM_STUB_NOW` pins the stub's clock for evals that score dates: time starts
 * at that instant when the stub starts and runs forward from there, so write
 * order is kept.
 */
const CLOCK_BASE = process.env.MEM_STUB_NOW ? Date.parse(process.env.MEM_STUB_NOW) : NaN
const CLOCK_START = Date.now()

function iso() {
  const now = Number.isFinite(CLOCK_BASE) ? CLOCK_BASE + (Date.now() - CLOCK_START) : Date.now()
  return new Date(now).toISOString()
}

/** The reserved wiki that holds commitments, and its file (see src/records.js). */
const RECORDS_WIKI = "Memory records"
const RECORDS_FILE = "commitments.json"

/**
 * State an eval asserts on, derived from the wiki raw files: every source file
 * (`wikiFiles`) and every commitment in a records file (`commitments`), each
 * with the container it belongs to. Derived on read, so it never drifts from
 * what the plugin wrote.
 */
function derivedState() {
  const wikiFiles = []
  const commitments = []
  for (const wiki of state.knowledge) {
    if (wiki.type !== "llm_wiki") continue
    for (const [filename, content] of Object.entries(wiki.raw ?? {})) {
      wikiFiles.push({ team_id: wiki.team_id ?? null, wiki: wiki.name, wiki_id: wiki.knowledge_id, filename, content: String(content) })
      if (wiki.name !== RECORDS_WIKI || filename !== RECORDS_FILE) continue
      try {
        const parsed = JSON.parse(String(content))
        // A file the plugin migrated into records holds history, not current
        // commitments: the records list them (recordsState).
        if (parsed?.migrated) continue
        for (const item of Array.isArray(parsed?.items) ? parsed.items : []) {
          commitments.push({ ...item, team_id: wiki.team_id ?? null })
        }
      } catch {
        /* an unreadable records file holds no commitments */
      }
    }
  }
  return { wikiFiles, commitments }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8")
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    request.on("error", reject)
  })
}

// ---------------------------------------------------------------------------
// Curation pipeline simulation
// ---------------------------------------------------------------------------

/** L0 -> L1 extraction job. */
function extractAtoms(body, messages, scope = isolation(body)) {
  const job = { id: nextID("job"), kind: "l0_to_l1", status: "running", started_at: iso(), produced: 0 }
  const existing = new Set(state.atoms.map((atom) => normalise(atom.content)))
  for (const message of messages) {
    if (message.role !== "user") continue
    const raw = String(message.content ?? "")
    const marker = raw.match(/^\[mem:remember([^\]]*)\]\s*/i) ?? raw.match(/^Please remember this \w+ for later:\s*/i)
    const background = marker && marker[1] ? marker[1].trim() : ""
    const text = marker ? raw.slice(marker[0].length) : raw
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
      const clean = sentence.trim()
      if (clean.length < 12) continue
      const content = EXTRACT === "rewrite" ? paraphrase(clean) : clean
      const key = normalise(content)
      if (existing.has(key)) continue
      existing.add(key)
      state.atoms.push({
        id: nextID("m"),
        version: 1,
        type: classify(clean),
        content,
        background,
        team_id: scope.team_id,
        user_id: scope.user_id,
        agent_id: scope.agent_id,
        ...(scope.task_id ? { task_id: scope.task_id } : {}),
        visibility: String(scope.team_id ?? "").startsWith("personal") ? "private" : "team",
        created_at: iso(),
        updated_at: iso(),
      })
      job.produced += 1
    }
  }
  job.status = "succeeded"
  job.ended_at = iso()
  state.jobs.push(job)
  return job
}

/** L1 -> L2 / L3 rollup job. */
function curate(body = {}) {
  const job = { id: nextID("job"), kind: "l1_to_l2_l3", status: "running", started_at: iso(), produced: 0 }
  const groups = new Map()
  for (const atom of state.atoms) {
    if (body.team_id && atom.team_id !== body.team_id) continue
    const key = `${atom.team_id}/${atom.agent_id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(atom)
  }
  for (const [key, atoms] of groups) {
    const visibility = clampVisibility(atoms.map((atom) => atom.visibility))
    const byType = { instruction: [], persona: [], episodic: [] }
    for (const atom of atoms) (byType[atom.type] ?? byType.episodic).push(atom)

    const sections = []
    for (const type of ["instruction", "persona", "episodic"]) {
      if (byType[type].length === 0) continue
      sections.push(`### ${type}\n${byType[type].map((atom) => `- ${atom.content}`).join("\n")}`)
    }
    const content = sections.join("\n\n")
    const scenarioPath = `curated/${key.replace(/\//g, "/")}.md`
    if (ISOLATE_CURATED) {
      const slot = curatedSlot(atoms[0].team_id, atoms[0].agent_id, { create: true })
      const previous = slot.scenarios[scenarioPath]
      slot.scenarios[scenarioPath] = {
        content,
        summary: `Curated ${atoms.length} memories for ${key}`,
        version: (previous?.version ?? 0) + 1,
        visibility,
        sources: atoms.map((atom) => atom.id),
        created_at: previous?.created_at ?? iso(),
        updated_at: iso(),
      }
      job.produced += 1
      const stableAtoms = [...byType.instruction, ...byType.persona].slice(0, 8)
      if (stableAtoms.length > 0) {
        slot.core = {
          content: `## Stable facts\n${stableAtoms.map((atom) => `- ${atom.content}`).join("\n")}`,
          version: (slot.core?.version ?? 0) + 1,
          created_at: slot.core?.created_at ?? iso(),
          updated_at: iso(),
        }
        job.produced += 1
      }
      continue
    }
    const existing = state.scenarios[scenarioPath]
    state.scenarios[scenarioPath] = {
      content,
      summary: `Curated ${atoms.length} memories for ${key}`,
      version: (existing?.version ?? 0) + 1,
      visibility,
      sources: atoms.map((atom) => atom.id),
      created_at: existing?.created_at ?? iso(),
      updated_at: iso(),
    }
    job.produced += 1

    const stable = [...byType.instruction, ...byType.persona].slice(0, 8)
    if (stable.length > 0) {
      state.core = {
        content: `## Stable facts\n${stable.map((atom) => `- ${atom.content}`).join("\n")}`,
        version: (state.core.version ?? 0) + 1,
        visibility,
        sources: stable.map((atom) => atom.id),
        created_at: state.core.created_at ?? iso(),
        updated_at: iso(),
      }
      job.produced += 1
    }
  }
  job.status = "succeeded"
  job.ended_at = iso()
  state.jobs.push(job)
  save()
  return job
}

// ---------------------------------------------------------------------------
// Per (team, agent) L2/L3, used when ISOLATE_CURATED is set
// ---------------------------------------------------------------------------

function curatedKey(team, agent) {
  return `${team ?? ""}\u0000${agent ?? ""}`
}

/** The exact (team, agent) slot a write targets. */
function curatedSlot(team, agent, { create = false } = {}) {
  const key = curatedKey(team, agent)
  if (!state.curated[key] && create) {
    state.curated[key] = { team_id: team ?? null, agent_id: agent ?? null, scenarios: {}, core: {} }
  }
  return state.curated[key] ?? null
}

/** Every slot a read may see: each isolation field the request sets must match. */
function curatedSlots(scope) {
  return Object.values(state.curated).filter(
    (slot) =>
      (!scope.team_id || slot.team_id === scope.team_id) &&
      (!scope.agent_id || slot.agent_id === scope.agent_id),
  )
}

function scenarioEntries(scope, prefix = "") {
  if (!ISOLATE_CURATED) {
    return Object.entries(state.scenarios).filter(([key]) => key.startsWith(prefix))
  }
  return curatedSlots(scope).flatMap((slot) =>
    Object.entries(slot.scenarios).filter(([key]) => key.startsWith(prefix)),
  )
}

/** A knowledge item belongs to the request's team when both name one. */
function sameTeam(item, body) {
  return !body?.team_id || !item.team_id || item.team_id === body.team_id
}

// ---------------------------------------------------------------------------
// Knowledge (wiki / code-graph) tool catalog
// ---------------------------------------------------------------------------

const WIKI_TOOLS = ["get_info", "search", "list_pages", "read_page", "get_graph", "list_raw", "read_raw"]
const CODE_TOOLS = ["get_info", "search", "explore", "callers", "callees", "impact", "node", "status", "files"]

function knowledgeByID(id) {
  const item = state.knowledge.find((entry) => entry.knowledge_id === id)
  if (item?.type === "llm_wiki") settleIngest(item)
  return item
}

/** Build a wiki's pages from its source files, as a finished ingest does. */
function finishIngest(wiki) {
  wiki.pages = {}
  for (const [filename, content] of Object.entries(wiki.raw ?? {})) {
    // As the hub: a page is titled by its first # heading, and by its file name when it has none.
    const heading = String(content).match(/^\s*#\s+(.+)$/m)?.[1]?.trim()
    wiki.pages[filename] = { title: heading || filename.replace(/\.md$/i, ""), content: String(content) }
  }
  wiki.status = "ready"
  delete wiki.processing_until
  wiki.updated_at = iso()
}

/** A wiki whose ingest time has passed is ready; nothing changes before that. */
function settleIngest(wiki) {
  if (wiki.status !== "processing" || !Number.isFinite(wiki.processing_until)) return
  if (Date.now() < wiki.processing_until) return
  finishIngest(wiki)
  save()
}

/** As the hub's maybeWriteError: an ingesting wiki refuses writes and deletes. */
function refuseWhileProcessing(wiki) {
  if (wiki.status === "processing") throw Object.assign(new Error("wiki is processing; cannot write/delete"), { status: 409 })
}

/** The upstream code-graph detail shape (see `normalizeCodeGraph` in the console). */
function codeGraphView(graph, overrides = {}) {
  return {
    code_graph_id: graph.knowledge_id,
    repo_name: graph.repo_name ?? graph.name,
    repo_url: graph.repo_url ?? null,
    branch: graph.branch ?? null,
    status: graph.status,
    sync_error: graph.sync_error ?? null,
    stats: graph.stats ?? null,
    team_id: graph.team_id ?? null,
    owner_user_id: graph.owner_user_id ?? null,
    created_at: graph.created_at,
    updated_at: graph.updated_at,
    ...overrides,
  }
}

/** A code graph's nodes, in the shape the hub reports them. */
function codeNodes(graph) {
  return (graph?.graph?.nodes ?? graph?.nodes ?? []).map((node) => ({
    symbol: String(node.symbol ?? node.name),
    file: node.file ?? null,
    line: Number.isInteger(node.line) ? node.line : null,
    kind: node.kind ?? null,
    signature: node.signature ?? null,
  }))
}

/** A code graph's edges: `from` calls `to`. */
function codeEdges(graph) {
  return (graph?.graph?.edges ?? graph?.edges ?? []).map((edge) => ({ from: String(edge.from), to: String(edge.to) }))
}

/**
 * The neighbourhood of one symbol, as the hub's callers, callees and impact
 * routes answer it: the nodes reached and the edges walked, with each node's
 * depth from the symbol. `direction` is "in" for callers, "out" for callees,
 * "both" for explore.
 */
function walkGraph(graph, symbol, { direction = "both", depth = 1 } = {}) {
  const all = codeNodes(graph)
  const bySymbol = new Map(all.map((node) => [node.symbol, node]))
  if (!bySymbol.has(symbol)) throw Object.assign(new Error(`no symbol ${symbol} in this graph`), { status: 404 })
  const edges = codeEdges(graph)
  const nodes = [{ ...bySymbol.get(symbol), depth: 0 }]
  const seen = new Set([symbol])
  const walked = []
  let frontier = [symbol]
  for (let level = 1; level <= depth && frontier.length > 0; level += 1) {
    const next = []
    for (const at of frontier) {
      for (const edge of edges) {
        const other = edge.from === at ? (direction === "in" ? null : edge.to) : edge.to === at ? (direction === "out" ? null : edge.from) : null
        if (!other || seen.has(other) || !bySymbol.has(other)) continue
        seen.add(other)
        nodes.push({ ...bySymbol.get(other), depth: level })
        walked.push(edge)
        next.push(other)
      }
    }
    frontier = next
  }
  // The edges between nodes already reached complete the picture (a cycle, or
  // two paths to one symbol), never a duplicate.
  for (const edge of edges) if (seen.has(edge.from) && seen.has(edge.to) && !walked.some((entry) => entry.from === edge.from && entry.to === edge.to)) walked.push(edge)
  return { nodes, edges: walked }
}

/** One code graph's tool, as the hub's `tools/call` answers it (the read tools). */
function callCodeTool(graph, toolName, params) {
  switch (toolName) {
    case "get_info":
    case "status":
      return { code_graph_id: graph.knowledge_id, type: graph.type, name: graph.name, status: graph.status, synced_at: graph.synced_at ?? null }
    case "files":
      return { items: codeFiles(graph) }
    case "search": {
      const query = String(params?.query ?? "").toLowerCase()
      const results = codeNodes(graph)
        .map((node) => ({ ...node, score: String(`${node.symbol} ${node.file ?? ""}`).toLowerCase().split(query).length - 1 }))
        .filter((node) => query && node.score > 0)
        .sort((a, b) => b.score - a.score || String(a.symbol).localeCompare(String(b.symbol)))
        .slice(0, params?.limit ?? 20)
      return { results }
    }
    case "callers":
      return walkGraph(graph, params?.symbol, { direction: "in", depth: 1 })
    case "callees":
      return walkGraph(graph, params?.symbol, { direction: "out", depth: 1 })
    case "impact":
      return walkGraph(graph, params?.symbol, { direction: "in", depth: params?.depth ?? 3 })
    case "explore":
      return walkGraph(graph, params?.symbol, { direction: "both", depth: 1 })
    case "node": {
      const found = codeNodes(graph).find((node) => node.symbol === params?.symbol)
      if (!found) throw Object.assign(new Error(`no symbol ${params?.symbol} in this graph`), { status: 404 })
      const around = walkGraph(graph, found.symbol, { direction: "both", depth: 1 })
      return {
        ...found,
        callers: codeEdges(graph).filter((edge) => edge.to === found.symbol).map((edge) => edge.from),
        callees: codeEdges(graph).filter((edge) => edge.from === found.symbol).map((edge) => edge.to),
        nodes: around.nodes,
        edges: around.edges,
      }
    }
    case "get_graph":
      return walkGraph(graph, codeNodes(graph)[0]?.symbol, { direction: "out", depth: 64 })
    default:
      throw new Error(`unknown tool ${toolName}`)
  }
}

/** A code graph's files: what a seed gave it, else the files its nodes name. */
function codeFiles(graph) {
  if (Array.isArray(graph.files)) return graph.files.map((file) => ({ path: String(file.path ?? file.name), size: file.size ?? null }))
  return [...new Set(codeNodes(graph).map((node) => node.file).filter(Boolean))].sort().map((path) => ({ path, size: null }))
}

/**
 * Wiki pages as the deployed hub presents them (2.0.0-beta.1, read from the
 * image 2026-11-04): a page has an id (its file name without `.md`) and a
 * project-relative path `wiki/<file>`; `page/read` and a search hit's `path`
 * accept either. The stub keys its pages by file name.
 */
function pageID(key) {
  return String(key).replace(/\.md$/, "")
}

function pagePath(key) {
  return `wiki/${key}`
}

/** The stored key a page id, path, or file name refers to, or undefined. */
function pageKey(pages, ref) {
  const wanted = String(ref ?? "").replace(/^wiki\//, "")
  return Object.keys(pages).find((key) => key === wanted || pageID(key) === wanted || pageID(key) === wanted.replace(/\.md$/, ""))
}

function callKnowledgeTool(knowledge, toolName, params) {
  const pages = knowledge.pages ?? {}
  switch (toolName) {
    case "get_info":
      return { knowledge_id: knowledge.knowledge_id, type: knowledge.type, name: knowledge.name, status: knowledge.status, page_count: Object.keys(pages).length }
    case "list_pages":
    case "files":
      if (knowledge.status === "processing") return []
      return Object.entries(pages).map(([pagePath, page]) => ({ path: pagePath, title: page.title ?? pagePath }))
    case "read_page":
      return { path: params.path, content: pages[params.path]?.content ?? null }
    case "get_graph":
      return knowledge.graph ?? { nodes: [], edges: [] }
    case "list_raw":
      // As the hub: `{ items: [{ filename, size, status, ... }] }`.
      return {
        items: Object.entries(knowledge.raw ?? {}).map(([filename, content]) => ({
          filename,
          size: String(content ?? "").length,
          status: "ingested",
        })),
      }
    case "read_raw":
      return { path: params.path, content: knowledge.raw?.[params.path] ?? null }
    case "search": {
      // As the hub's wiki search: `{ results: [{ path, title, snippet, score,
      // type, hop, related }], links, count }`; nothing while it ingests.
      if (knowledge.type === "llm_wiki" && knowledge.status === "processing") return { results: [], links: [], count: 0 }
      if (knowledge.type === "llm_wiki") {
        const results = Object.entries(pages)
          .map(([key, page]) => ({
            path: pagePath(key),
            title: page.title ?? pageID(key),
            snippet: String(page.content).slice(0, 160),
            score: score(params.query, `${page.title} ${page.content}`),
            type: "other",
            hop: 0,
            related: [],
          }))
          .filter((result) => result.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, params.limit ?? 20)
        return { results, links: [], count: results.length }
      }
      const results = Object.entries(pages)
        .map(([key, page]) => ({ path: key, score: score(params.query, `${page.title} ${page.content}`), snippet: String(page.content).slice(0, 160) }))
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, params.limit ?? 5)
      return results
    }
    case "explore":
    case "node":
      return { path: params.path ?? params.node, content: pages[params.path]?.content ?? null }
    case "callers":
      return (knowledge.graph?.edges ?? []).filter((edge) => edge.to === params.symbol).map((edge) => edge.from)
    case "callees":
      return (knowledge.graph?.edges ?? []).filter((edge) => edge.from === params.symbol).map((edge) => edge.to)
    case "impact":
      return (knowledge.graph?.edges ?? []).filter((edge) => edge.from === params.symbol || edge.to === params.symbol)
    case "status":
      return { status: knowledge.status, synced_at: knowledge.synced_at ?? null }
    default:
      throw new Error(`unknown tool ${toolName}`)
  }
}

// ---------------------------------------------------------------------------
// Scope + ACL
// ---------------------------------------------------------------------------

/**
 * Upstream fills the session with a placeholder when a request sends none
 * (`resolveIsolation`). Rows written without a session carry it too, and a
 * delete that sends no session can only match those rows.
 */
const PLACEHOLDER_SESSION = "__default_session__"

/**
 * The request isolation, as upstream resolves it: body fields win over the
 * `x-tdai-*` headers. The task is optional and only constrains when present.
 */
function isolation(body = {}, request) {
  const headers = request?.headers ?? {}
  const pick = (field, header) => {
    const value = body?.[field] ?? headers[header]
    return value === undefined || value === null || value === "" ? undefined : String(value)
  }
  return {
    team_id: pick("team_id", "x-tdai-team-id"),
    user_id: pick("user_id", "x-tdai-user-id"),
    agent_id: pick("agent_id", "x-tdai-agent-id"),
    session_id: pick("session_id", "x-tdai-session-id") ?? PLACEHOLDER_SESSION,
    task_id: pick("task_id", "x-tdai-task-id"),
  }
}

/** Reads: every isolation field that is set must match; a set task filters. */
function matchesScope(item, scope) {
  if (scope.team_id && item.team_id && item.team_id !== scope.team_id) return false
  if (scope.agent_id && item.agent_id && item.agent_id !== scope.agent_id) return false
  if (scope.user_id && item.user_id && item.user_id !== scope.user_id) return false
  if (scope.task_id && item.task_id !== scope.task_id) return false
  return true
}

/**
 * Deletes, as upstream `rowMatchesIsolation`: team, user, and agent must equal
 * the row's values; the session must too when `session` is required (L0); a
 * task constrains only when the request sends one.
 */
function rowMatchesIsolation(row, scope, { session }) {
  for (const field of ["team_id", "user_id", "agent_id"]) {
    if ((row[field] ?? undefined) !== (scope[field] ?? undefined)) return false
  }
  if (session && (row.session_id ?? PLACEHOLDER_SESSION) !== scope.session_id) return false
  if (scope.task_id && row.task_id !== scope.task_id) return false
  return true
}

function canAccess(asset, body, action = "read") {
  if (asset.visibility === "private") {
    return asset.owner_user_id === body.user_id && asset.team_id === body.team_id
  }
  if (asset.visibility === "team") return asset.team_id === body.team_id
  if (asset.visibility === "restricted") {
    return state.acl.some(
      (entry) =>
        entry.asset_id === asset.asset_id &&
        entry.permission === action &&
        entry.effect !== "deny" &&
        ((entry.subject_type === "user" && entry.subject_id === body.user_id) ||
          (entry.subject_type === "agent" && entry.subject_id === body.agent_id)),
    )
  }
  if (asset.visibility === "agent") return asset.team_id === body.team_id
  return false
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const routes = {
  "GET /health": () => ({ status: "ok", version: "stub-2", stores: { atoms: state.atoms.length, jobs: state.jobs.length } }),
  "GET /debug/state": async () => {
    const derived = derivedState()
    const fromRecords = await recordsState()
    return { ...state, ...derived, records: fromRecords.records, commitments: [...derived.commitments, ...fromRecords.commitments] }
  },
  "GET /debug/jobs": () => ({ items: state.jobs, total: state.jobs.length }),

  /** The last code-graph request bodies and scope headers a test read (`noteCodeGraphRequest`). */
  "GET /debug/requests": () => ({ items: codeGraphRequests }),

  "POST /debug/seed": (body) => {
    if (body.atoms) state.atoms.push(...body.atoms.map((atom) => ({ id: nextID("m"), version: 1, created_at: iso(), updated_at: iso(), ...atom })))
    if (body.scenarios) {
      for (const [key, value] of Object.entries(body.scenarios)) {
        state.scenarios[key] = { version: 1, created_at: iso(), updated_at: iso(), ...value }
      }
    }
    if (body.core) state.core = { version: 1, created_at: iso(), updated_at: iso(), ...body.core }
    // Per (team, agent) L2/L3 for ISOLATE_CURATED: [{ team_id, agent_id, scenarios?, core? }].
    for (const entry of body.curated ?? []) {
      const slot = curatedSlot(entry.team_id, entry.agent_id, { create: true })
      for (const [key, value] of Object.entries(entry.scenarios ?? {})) {
        slot.scenarios[key] = { version: 1, created_at: iso(), updated_at: iso(), ...value }
      }
      if (entry.core) slot.core = { version: 1, created_at: iso(), updated_at: iso(), ...entry.core }
    }
    if (body.skills) state.skills.push(...body.skills)
    if (body.knowledge) state.knowledge.push(...body.knowledge)
    if (body.assets) state.assets.push(...body.assets)
    if (body.teamMembers) state.teamMembers.push(...body.teamMembers)
    if (body.agents) state.agents.push(...body.agents)
    save()
    return { seeded: true }
  },

  /** Run the simulated L1 -> L2/L3 rollup. */
  "POST /debug/curate": (body) => curate(body),

  /** How long a wiki ingest takes from now on, in ms (0: at once). */
  "POST /debug/ingest": (body) => {
    state.ingestMs = Math.max(0, Number(body.ms ?? 0) || 0)
    save()
    return { ms: state.ingestMs }
  },

  /**
   * Fail the next `times` calls of one route with `status` (default 503), to
   * test a resumable workflow. `times: 0` clears it.
   */
  "POST /debug/fail": (body) => {
    const route = String(body.route ?? "")
    if (!route) throw Object.assign(new Error("route is required"), { status: 400 })
    const times = Math.max(0, Number(body.times ?? 1))
    if (times === 0) delete state.failures[route]
    else state.failures[route] = { times, status: Number(body.status ?? 503) }
    save()
    return { route, times }
  },

  /**
   * As the deployed core (2.0.0-beta.1, verified 2026-11-03): a write without
   * team, user, and agent isolation (body or `x-tdai-*` headers) is a 422.
   * The core has no `session/add`; turns are written here.
   */
  "POST /v3/conversation/add": (body, request) => {
    const scope = isolation(body, request)
    const missing = ["team_id", "agent_id", "user_id"].filter((field) => !scope[field])
    if (missing.length > 0) {
      throw Object.assign(new Error(`/v3 requires strict isolation: missing ${missing.join(", ")}`), { status: 422 })
    }
    const messages = Array.isArray(body.messages) ? body.messages : []
    const accepted = []
    for (const message of messages) {
      const id = nextID("msg")
      state.conversations.push({
        id,
        version: 1,
        role: message.role,
        content: message.content,
        session_id: scope.session_id,
        team_id: scope.team_id,
        user_id: scope.user_id,
        agent_id: scope.agent_id,
        ...(scope.task_id ? { task_id: scope.task_id } : {}),
        recorded_at: iso(),
        timestamp: iso(),
      })
      accepted.push(id)
    }
    const job = extractAtoms(body, messages, scope)
    save()
    return { accepted_ids: accepted, accepted_versions: accepted.map(() => "v1"), total_count: accepted.length, job_id: job.id }
  },

  "POST /v3/conversation/query": (body, request) => {
    const limit = Math.max(1, Math.min(Number(body.limit) || 20, 100))
    const offset = Math.max(0, Number(body.offset) || 0)
    // The session narrows only when the body names one; the isolation
    // placeholder is not a filter for a listing.
    let items = state.conversations.filter((item) => matchesScope(item, isolation(body, request)))
    if (body.session_id) items = items.filter((item) => item.session_id === String(body.session_id))
    if (body.time_start) items = items.filter((item) => String(item.recorded_at ?? "") >= String(body.time_start))
    if (body.time_end) items = items.filter((item) => String(item.recorded_at ?? "") <= String(body.time_end))
    items = items.slice().sort((a, b) => String(b.recorded_at ?? "").localeCompare(String(a.recorded_at ?? "")))
    return { messages: items.slice(offset, offset + limit), total: items.length }
  },

  "POST /v3/conversation/search": (body, request) => {
    const limit = Number(body.limit) || 5
    const messages = state.conversations
      .filter((item) => matchesScope(item, isolation(body, request)))
      .map((item) => ({ ...item, score: score(body.query, item.content) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      // Upstream L0 search hits carry only these fields: no task, session,
      // agent, or user. Mirror that so clients cannot rely on them.
      .map(({ id, role, content, score: hitScore, recorded_at: recordedAt, timestamp }) => ({
        id,
        role,
        content,
        score: hitScore,
        timestamp: timestamp ?? recordedAt,
      }))
    return { messages }
  },

  "POST /v3/conversation/count": (body, request) => ({
    total: state.conversations.filter((item) => matchesScope(item, isolation(body, request))).length,
  }),

  /** Each named row is deleted only when it matches the whole request isolation. */
  "POST /v3/conversation/delete": (body, request) => {
    const scope = isolation(body, request)
    const ids = new Set(body.message_ids ?? [])
    const sessions = new Set(body.session_ids ?? [])
    const before = state.conversations.length
    state.conversations = state.conversations.filter((item) => {
      if (!ids.has(item.id) && !sessions.has(item.session_id)) return true
      return !rowMatchesIsolation(item, scope, { session: true })
    })
    save()
    return { deleted_count: before - state.conversations.length }
  },

  "POST /v3/atomic/search": (body, request) => {
    const limit = Number(body.limit) || 5
    const items = state.atoms
      .filter((item) => matchesScope(item, isolation(body, request)))
      .filter((item) => !body.type || item.type === body.type)
      .map((item) => ({ ...item, score: score(body.query, `${item.content} ${item.background ?? ""}`) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    return { items, total: items.length }
  },

  "POST /v3/atomic/query": (body, request) => {
    const limit = Math.max(1, Math.min(Number(body.limit) || 20, 100))
    const offset = Math.max(0, Number(body.offset) || 0)
    let items = state.atoms.filter((item) => matchesScope(item, isolation(body, request)))
    if (body.type) items = items.filter((item) => item.type === body.type)
    if (body.time_start) items = items.filter((item) => String(item.created_at ?? "") >= String(body.time_start))
    if (body.time_end) items = items.filter((item) => String(item.created_at ?? "") <= String(body.time_end))
    items = items.slice().sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    return { items: items.slice(offset, offset + limit), total: items.length }
  },

  "POST /v3/atomic/count": (body, request) => ({
    total: state.atoms.filter((item) => matchesScope(item, isolation(body, request))).length,
  }),

  /** Upstream drops the session from an atom delete but keeps agent and task. */
  /**
   * As the deployed core (v2-router.ts `handleAtomicUpdate`): the row is found
   * by id, then the request's own user and agent must match it (403 otherwise),
   * and its content is rewritten in place. The agent is `x-tdai-agent-id` or the
   * body's `agent_id`, as every scoped call carries.
   */
  "POST /v3/atomic/update": (body, request) => {
    const scope = isolation(body, request)
    const item = state.atoms.find((row) => row.id === String(body.id ?? ""))
    if (!item) throw Object.assign(new Error(`Atomic note not found: ${body.id}`), { status: 404 })
    if (scope.user_id && item.user_id && item.user_id !== scope.user_id) {
      throw Object.assign(new Error("Atomic note belongs to a different user"), { status: 403 })
    }
    if (scope.agent_id && item.agent_id && item.agent_id !== scope.agent_id) {
      throw Object.assign(new Error("Atomic note belongs to a different agent"), { status: 403 })
    }
    item.content = String(body.content ?? item.content)
    item.version = (Number(item.version) || 1) + 1
    item.updated_at = iso()
    save()
    return { updated: true, version: item.version }
  },

  "POST /v3/atomic/delete": (body, request) => {
    const scope = isolation(body, request)
    const ids = new Set(body.ids ?? [])
    const before = state.atoms.length
    state.atoms = state.atoms.filter((item) => !ids.has(item.id) || !rowMatchesIsolation(item, scope, { session: false }))
    save()
    return { deleted_count: before - state.atoms.length }
  },

  "POST /v3/scenario/ls": (body, request) => {
    const prefix = body.path_prefix ?? ""
    const entries = scenarioEntries(isolation(body, request), prefix).map(([key, value]) => ({
      path: key,
      summary: value.summary,
      version: value.version ?? 1,
      updated_at: value.updated_at,
    }))
    return { entries, total: entries.length }
  },

  "POST /v3/scenario/count": (body, request) => ({
    total: scenarioEntries(isolation(body, request), body.path_prefix ?? "").length,
  }),

  "POST /v3/scenario/read": (body, request) => {
    const found = scenarioEntries(isolation(body, request)).find(([key]) => key === String(body.path ?? ""))
    const scenario = found?.[1]
    if (!scenario) throw Object.assign(new Error("scenario not found"), { status: 404 })
    return {
      path: body.path,
      content: scenario.content ?? "",
      version: scenario.version ?? 1,
      created_at: scenario.created_at,
      updated_at: scenario.updated_at,
    }
  },

  /** Update-only, as upstream: a missing file is not created. The summary is kept. */
  "POST /v3/scenario/write": (body, request) => {
    const key = String(body.path ?? "")
    const scope = isolation(body, request)
    const map = ISOLATE_CURATED ? curatedSlot(scope.team_id, scope.agent_id)?.scenarios : state.scenarios
    const scenario = map?.[key]
    if (!scenario) throw Object.assign(new Error("scenario not found; scenario/write is update-only"), { status: 404 })
    map[key] = { ...scenario, content: String(body.content ?? ""), version: (scenario.version ?? 1) + 1, updated_at: iso() }
    save()
    return { path: key, version: map[key].version }
  },

  /** Remove one scenario file in the request's own (team, agent). */
  "POST /v3/scenario/rm": (body, request) => {
    const key = String(body.path ?? "")
    const scope = isolation(body, request)
    const map = ISOLATE_CURATED ? curatedSlot(scope.team_id, scope.agent_id)?.scenarios : state.scenarios
    if (!map?.[key]) throw Object.assign(new Error("scenario not found"), { status: 404 })
    delete map[key]
    save()
    return { path: key, deleted: true }
  },

  "POST /v3/core/read": (body, request) => {
    const scope = isolation(body, request)
    const core = ISOLATE_CURATED ? curatedSlot(scope.team_id, scope.agent_id)?.core ?? {} : state.core
    return {
      content: core.content ?? null,
      version: core.version,
      created_at: core.created_at,
      updated_at: core.updated_at,
    }
  },

  /** Overwrites the persona. */
  "POST /v3/core/write": (body, request) => {
    const scope = isolation(body, request)
    const current = ISOLATE_CURATED ? curatedSlot(scope.team_id, scope.agent_id, { create: true }).core : state.core
    const next = {
      ...current,
      content: String(body.content ?? ""),
      version: (current.version ?? 0) + 1,
      created_at: current.created_at ?? iso(),
      updated_at: iso(),
    }
    if (ISOLATE_CURATED) curatedSlot(scope.team_id, scope.agent_id).core = next
    else state.core = next
    save()
    return { version: next.version }
  },

  "POST /v3/skill/list": (body) => {
    const items = state.skills.filter((skill) => {
      if (body.team_id && skill.team_id && skill.team_id !== body.team_id) return false
      if (body.user_id && skill.owner_user_id && skill.owner_user_id !== body.user_id && skill.visibility === "private") return false
      return true
    })
    return { items, total: items.length }
  },

  "POST /v3/skill/get": (body) => state.skills.find((skill) => skill.skill_id === body.skill_id || skill.id === body.skill_id) ?? {},

  /**
   * Upstream refuses a second skill with the same name in a container
   * (`42201`); `publish-skill.mjs` then updates the existing one. The row keeps
   * the (gateway-scoped) container and owner so an ownership check can read
   * them back.
   */
  "POST /v3/skill/create": (body) => {
    const name = String(body.name ?? "").trim()
    if (!name) throw Object.assign(new Error("name is required"), { status: 400 })
    const team = body.team_id ?? null
    if (state.skills.some((skill) => skill.name === name && (skill.team_id ?? null) === team)) {
      throw Object.assign(new Error("skill name already exists"), { status: 409, code: 42201 })
    }
    const skill = {
      skill_id: nextID("skill"),
      name,
      description: body.description ?? null,
      content: String(body.content ?? ""),
      status: "active",
      version: 1,
      visibility: body.visibility ?? "team",
      team_id: team,
      owner_user_id: body.user_id ?? null,
      owner_agent_id: body.agent_id ?? null,
      created_at: iso(),
      updated_at: iso(),
    }
    state.skills.push(skill)
    save()
    return { ...skill }
  },

  "POST /v3/skill/update": (body) => {
    const skill = state.skills.find((entry) => entry.skill_id === body.skill_id)
    if (!skill || (body.team_id && skill.team_id && skill.team_id !== body.team_id)) {
      throw Object.assign(new Error("skill not found"), { status: 404 })
    }
    if (body.content !== undefined) skill.content = String(body.content)
    if (body.description !== undefined) skill.description = body.description
    skill.version = (skill.version ?? 1) + 1
    skill.updated_at = iso()
    save()
    return { skill_id: skill.skill_id, version: skill.version }
  },

  /** Delete one skill in the request's container. */
  /**
   * As upstream (skill-core delete): `expected_version` is required and must
   * be the head version; every version is removed; `{skill_id, archived}`.
   */
  "POST /v3/skill/delete": (body) => {
    if (!body.skill_id) throw Object.assign(new Error("skill_id is required"), { status: 400 })
    if (!Number.isInteger(body.expected_version) || body.expected_version < 1) {
      throw Object.assign(new Error("expected_version is required"), { status: 400 })
    }
    const index = state.skills.findIndex(
      (entry) => entry.skill_id === body.skill_id && (!body.team_id || !entry.team_id || entry.team_id === body.team_id),
    )
    if (index < 0) throw Object.assign(new Error("skill not found"), { status: 404 })
    if ((state.skills[index].version ?? 1) !== body.expected_version) {
      throw Object.assign(new Error("version conflict"), { status: 409 })
    }
    state.skills.splice(index, 1)
    save()
    return { skill_id: body.skill_id, archived: true }
  },

  "POST /v3/meta/asset/create": (body) => {
    state.assets.push({ ...body, created_at: iso(), updated_at: iso(), usage_count: 0 })
    save()
    return { asset_id: body.asset_id }
  },

  "POST /v3/meta/team-member/list": () => ({ items: state.teamMembers, total: state.teamMembers.length }),

  "POST /v3/meta/agent/list": () => ({ items: state.agents, total: state.agents.length }),

  "POST /v3/meta/asset/list-accessible": (body) => {
    const items = state.assets.filter((asset) => (!body.asset_type || asset.asset_type === body.asset_type) && canAccess(asset, body, body.action ?? "read"))
    return { items, total: items.length, limit: body.limit ?? 20, offset: body.offset ?? 0 }
  },

  "POST /v3/meta/asset/touch-usage": (body) => {
    const asset = state.assets.find((entry) => entry.asset_id === body.asset_id)
    state.usage[body.asset_id] = (state.usage[body.asset_id] ?? 0) + 1
    if (asset) {
      asset.usage_count = state.usage[body.asset_id]
      asset.last_used_at = iso()
    }
    save()
    return { asset_id: body.asset_id, usage_count: state.usage[body.asset_id] }
  },

  "POST /v3/knowledge/list": (body) => {
    const items = state.knowledge.filter((item) => {
      if (body.type && item.type !== body.type) return false
      const asset = state.assets.find((entry) => entry.content_ref === item.knowledge_id)
      return !asset || canAccess(asset, body, "read")
    })
    return { items, total: items.length }
  },

  "POST /v3/wiki/create": (body) => {
    const name = String(body.name ?? "").trim()
    if (!name) throw Object.assign(new Error("name is required"), { status: 400 })
    // Idempotent by name inside one container, never across containers.
    const existing = state.knowledge.find(
      (item) => item.type === "llm_wiki" && item.name === name && (item.team_id ?? null) === (body.team_id ?? null),
    )
    if (existing) {
      return {
        wiki_id: existing.knowledge_id,
        name: existing.name,
        status: existing.status,
        page_count: Object.keys(existing.pages ?? {}).length,
        team_id: existing.team_id ?? null,
        owner_user_id: existing.owner_user_id ?? null,
        created_at: existing.created_at,
        updated_at: existing.updated_at,
      }
    }
    const wiki = {
      knowledge_id: nextID("wiki"),
      type: "llm_wiki",
      name,
      // The container and owner the gateway's ownership check (G-01) reads.
      team_id: body.team_id ?? null,
      owner_user_id: body.user_id ?? null,
      status: "draft",
      pages: {},
      raw: {},
      graph: { nodes: [], edges: [] },
      created_at: iso(),
      updated_at: iso(),
    }
    state.knowledge.push(wiki)
    save()
    return {
      wiki_id: wiki.knowledge_id,
      name: wiki.name,
      status: wiki.status,
      page_count: 0,
      team_id: wiki.team_id,
      owner_user_id: wiki.owner_user_id,
      created_at: wiki.created_at,
      updated_at: wiki.updated_at,
    }
  },

  "POST /v3/wiki/get": (body) => {
    const wiki = knowledgeByID(body.wiki_id)
    if (!wiki || wiki.type !== "llm_wiki") throw Object.assign(new Error("wiki not found"), { status: 404 })
    return {
      wiki_id: wiki.knowledge_id,
      name: wiki.name,
      status: wiki.status,
      page_count: Object.keys(wiki.pages ?? {}).length,
      ...(wiki.error ? { error: wiki.error } : {}),
      team_id: wiki.team_id ?? null,
      owner_user_id: wiki.owner_user_id ?? null,
      created_at: wiki.created_at,
      updated_at: wiki.updated_at,
    }
  },

  /**
   * Batch delete, as upstream: one failed id never fails the batch, it is
   * listed in `failed` with a reason. An id in another container reports as
   * not found ("cross-memory ids report as not found").
   */
  "POST /v3/wiki/delete": (body) => {
    const ids = Array.isArray(body.wiki_ids) ? body.wiki_ids.map(String) : []
    if (ids.length === 0 || ids.length > 100) {
      throw Object.assign(new Error("wiki_ids must hold 1 to 100 ids"), { status: 400 })
    }
    const deleted = []
    const failed = []
    for (const id of ids) {
      const index = state.knowledge.findIndex(
        (item) => item.type === "llm_wiki" && item.knowledge_id === id && sameTeam(item, body),
      )
      if (index < 0) {
        failed.push({ id, reason: "not found" })
        continue
      }
      state.knowledge.splice(index, 1)
      state.assets = state.assets.filter((asset) => asset.content_ref !== id)
      deleted.push(id)
    }
    save()
    return { deleted_ids: deleted, failed }
  },

  "POST /v3/wiki/raw/write": (body) => {
    const wiki = knowledgeByID(body.wiki_id)
    if (!wiki || wiki.type !== "llm_wiki") throw Object.assign(new Error("wiki not found"), { status: 404 })
    // As the hub (rawWriteMany, read from the image 2026-11-08): it creates
    // raw/sources/ but no folder under it, so a name with a folder fails the
    // whole batch with the file system's ENOENT, answered as a 400.
    refuseWhileProcessing(wiki)
    const nested = (body.files ?? []).find((file) => String(file?.filename ?? "").includes("/"))
    if (nested) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '/data/wiki/raw/sources/${nested.filename}'`), { status: 400 })
    }
    wiki.raw = wiki.raw ?? {}
    for (const file of body.files ?? []) {
      if (!file?.filename) continue
      wiki.raw[file.filename] = String(file.content ?? "")
    }
    wiki.status = "draft"
    wiki.updated_at = iso()
    save()
    return { items: (body.files ?? []).map((file) => ({ filename: file.filename, status: "written" })) }
  },

  /**
   * As the hub (rawRm, read from the image 2026-11-08): refused while the
   * wiki ingests; deletes the source files and, by cascade, the pages built
   * only from them. The stub's pages are keyed by their source file, so each
   * page has one source. A missing file is not an error.
   */
  "POST /v3/wiki/raw/rm": (body) => {
    const wiki = knowledgeByID(body.wiki_id)
    if (!wiki || wiki.type !== "llm_wiki" || !sameTeam(wiki, body)) throw Object.assign(new Error("wiki not found"), { status: 404 })
    refuseWhileProcessing(wiki)
    const filenames = Array.isArray(body.filenames) ? body.filenames.map(String) : []
    if (filenames.length === 0) throw Object.assign(new Error("filenames is required (non-empty array)"), { status: 400 })
    if (filenames.some((name) => name.includes("..") || name.startsWith("/"))) throw Object.assign(new Error("invalid path: traversal detected"), { status: 400 })
    const deletedPages = []
    for (const name of filenames) {
      delete (wiki.raw ?? {})[name]
      if (wiki.pages?.[name]) {
        delete wiki.pages[name]
        deletedPages.push(pageID(name))
      }
    }
    wiki.updated_at = iso()
    save()
    return { deleted_files: filenames, deleted_pages: deletedPages, rewritten_pages: [] }
  },

  /**
   * As the hub (pageRm): refused while the wiki ingests; the structural pages
   * (index, schema, purpose) are refused; a ref that does not exist fails as
   * an invalid path, since the hub resolves it to no file.
   */
  "POST /v3/wiki/page/rm": (body) => {
    const wiki = knowledgeByID(body.wiki_id)
    if (!wiki || wiki.type !== "llm_wiki" || !sameTeam(wiki, body)) throw Object.assign(new Error("wiki not found"), { status: 404 })
    refuseWhileProcessing(wiki)
    const refs = Array.isArray(body.refs) ? body.refs.map(String) : []
    if (refs.length === 0) throw Object.assign(new Error("refs is required (non-empty array)"), { status: 400 })
    const keys = []
    for (const ref of refs) {
      if (["index", "schema", "purpose"].includes(ref.replace(/^wiki\//, "").replace(/\.md$/, ""))) {
        throw Object.assign(new Error("forbidden path (structural file or outside wiki/)"), { status: 400 })
      }
      const key = pageKey(wiki.pages ?? {}, ref)
      if (key === undefined) throw Object.assign(new Error("invalid path: traversal detected"), { status: 400 })
      keys.push(key)
    }
    for (const key of keys) delete wiki.pages[key]
    wiki.updated_at = iso()
    save()
    return { deleted_pages: keys.map(pageID), rewritten_files: [] }
  },

  "POST /v3/wiki/raw/read": (body) => {
    const wiki = knowledgeByID(body.wiki_id)
    if (!wiki || wiki.type !== "llm_wiki") throw Object.assign(new Error("wiki not found"), { status: 404 })
    const names = Array.isArray(body.filenames) ? body.filenames : []
    return {
      items: names
        .filter((name) => Object.prototype.hasOwnProperty.call(wiki.raw ?? {}, name))
        .map((name) => ({ filename: name, content: wiki.raw[name] })),
    }
  },

  /** The wiki's own graph, as seeded: nodes, edges (source/target) and communities. */
  "POST /v3/wiki/graph": (body) => {
    const wiki = knowledgeByID(body.wiki_id)
    if (!wiki || wiki.type !== "llm_wiki" || !sameTeam(wiki, body)) throw Object.assign(new Error("wiki not found"), { status: 404 })
    return wiki.graph ?? { nodes: [], edges: [], communities: [] }
  },

  "POST /v3/wiki/ingest": (body) => {
    const wiki = knowledgeByID(body.wiki_id)
    if (!wiki || wiki.type !== "llm_wiki") throw Object.assign(new Error("wiki not found"), { status: 404 })
    const raw = wiki.raw ?? {}
    if (Object.keys(raw).length === 0) throw Object.assign(new Error("wiki has no source files"), { status: 400 })
    // As the hub: a second ingest while one runs is `409 busy`.
    if (wiki.status === "processing") throw Object.assign(new Error("busy"), { status: 409 })
    const ingestMs = Number.isFinite(state.ingestMs) ? state.ingestMs : DEFAULT_INGEST_MS
    if (ingestMs > 0) {
      wiki.status = "processing"
      wiki.processing_until = Date.now() + ingestMs
      wiki.updated_at = iso()
    } else {
      finishIngest(wiki)
    }
    save()
    return { wiki_id: wiki.knowledge_id, status: wiki.status }
  },

  "POST /v3/wiki/page/ls": (body) => {
    const wiki = knowledgeByID(body.wiki_id)
    if (!wiki || wiki.type !== "llm_wiki") throw Object.assign(new Error("wiki not found"), { status: 404 })
    // As the hub: `{ id, title, type, path: "wiki/<file>", locked }`, and no
    // pages while it ingests (the hub lists none unless the wiki is ready).
    if (wiki.status === "processing") return { items: [] }
    return {
      items: Object.keys(wiki.pages ?? {}).map((key) => ({
        id: pageID(key),
        title: wiki.pages[key].title ?? pageID(key),
        type: "other",
        path: pagePath(key),
        locked: false,
      })),
    }
  },

  "POST /v3/wiki/page/read": (body) => {
    const wiki = knowledgeByID(body.wiki_id)
    if (!wiki || wiki.type !== "llm_wiki") throw Object.assign(new Error("wiki not found"), { status: 404 })
    // As the hub: one item per ref, `{ ref, content }` or `{ ref, not_found: true }`.
    const refs = Array.isArray(body.refs) ? body.refs : []
    return {
      items: refs.map((ref) => {
        const key = pageKey(wiki.pages ?? {}, ref)
        return key === undefined ? { ref, not_found: true } : { ref, content: wiki.pages[key].content ?? "" }
      }),
    }
  },

  "POST /v3/wiki/list": (body) => {
    for (const item of state.knowledge) if (item.type === "llm_wiki") settleIngest(item)
    const items = state.knowledge
      .filter((item) => item.type === "llm_wiki")
      .filter((item) => sameTeam(item, body))
      .filter((item) => {
        const asset = state.assets.find((entry) => entry.content_ref === item.knowledge_id)
        return !asset || canAccess(asset, body, "read")
      })
      .map((item) => ({
        wiki_id: item.knowledge_id,
        name: item.name,
        status: item.status,
        page_count: Object.keys(item.pages ?? {}).length,
        // The hub reports why a failed ingest failed; jelly #89 A1 declares it.
        ...(item.error ? { error: item.error } : {}),
      }))
    return { items, total: items.length }
  },

  "POST /v3/code-graph/list": (body) => {
    const items = state.knowledge
      .filter((item) => item.type === "code_graph")
      .filter((item) => sameTeam(item, body))
      .map((item) => ({
        code_graph_id: item.knowledge_id,
        name: item.name,
        repo_name: item.repo_name ?? item.name,
        status: item.status,
        node_count: item.graph?.nodes?.length ?? 0,
      }))
    return { items, total: items.length }
  },

  /**
   * Indexing is a job upstream; the stub finishes it at once, so the first
   * `code-graph/get` already reports `ready`. The create answer is `pending`,
   * as upstream's is.
   */
  "POST /v3/code-graph/create": (body) => {
    const repoUrl = String(body.repo_url ?? "").trim()
    if (!repoUrl) throw Object.assign(new Error("repo_url is required"), { status: 400 })
    const repoName = String(body.repo_name ?? "").trim() || repoUrl.replace(/\.git$/, "").split(/[/:]/).filter(Boolean).at(-1)
    const graph = {
      knowledge_id: nextID("cg"),
      type: "code_graph",
      name: repoName,
      repo_name: repoName,
      repo_url: repoUrl,
      branch: String(body.branch ?? "main"),
      team_id: body.team_id ?? null,
      owner_user_id: body.user_id ?? null,
      status: "ready",
      stats: { files: 0, nodes: 0, edges: 0 },
      pages: {},
      graph: { nodes: [], edges: [] },
      created_at: iso(),
      updated_at: iso(),
    }
    state.knowledge.push(graph)
    save()
    return codeGraphView(graph, { status: "pending" })
  },

  "POST /v3/code-graph/get": (body) => {
    const graph = knowledgeByID(body.code_graph_id)
    if (!graph || graph.type !== "code_graph") throw Object.assign(new Error("code graph not found"), { status: 404 })
    return codeGraphView(graph)
  },

  "POST /v3/code-graph/status": (body) => {
    const graph = knowledgeByID(body.code_graph_id)
    if (!graph || graph.type !== "code_graph") throw Object.assign(new Error("code graph not found"), { status: 404 })
    return { status: graph.status, synced_at: graph.synced_at ?? null, ...(graph.sync_error ? { sync_error: graph.sync_error } : {}) }
  },

  "POST /v3/code-graph/files": (body) => {
    const graph = knowledgeByID(body.code_graph_id)
    if (!graph || graph.type !== "code_graph") throw Object.assign(new Error("code graph not found"), { status: 404 })
    const items = codeFiles(graph)
    return { items, total: items.length }
  },

  "POST /v3/code-graph/search": (body) => {
    const graph = knowledgeByID(body.code_graph_id)
    if (!graph || graph.type !== "code_graph") throw Object.assign(new Error("code graph not found"), { status: 404 })
    const query = String(body.query ?? "").trim()
    if (!query) throw Object.assign(new Error("query is required"), { status: 400 })
    return callCodeTool(graph, "search", { query, limit: body.limit ?? 20 })
  },

  "POST /v3/code-graph/callers": (body) => {
    const graph = knowledgeByID(body.code_graph_id)
    if (!graph || graph.type !== "code_graph") throw Object.assign(new Error("code graph not found"), { status: 404 })
    return walkGraph(graph, String(body.symbol ?? ""), { direction: "in", depth: 1 })
  },

  "POST /v3/code-graph/callees": (body) => {
    const graph = knowledgeByID(body.code_graph_id)
    if (!graph || graph.type !== "code_graph") throw Object.assign(new Error("code graph not found"), { status: 404 })
    return walkGraph(graph, String(body.symbol ?? ""), { direction: "out", depth: 1 })
  },

  "POST /v3/code-graph/impact": (body) => {
    const graph = knowledgeByID(body.code_graph_id)
    if (!graph || graph.type !== "code_graph") throw Object.assign(new Error("code graph not found"), { status: 404 })
    return walkGraph(graph, String(body.symbol ?? ""), { direction: "in", depth: Math.min(Math.max(Number(body.depth ?? 3) || 3, 1), 5) })
  },

  "POST /v3/code-graph/explore": (body) => {
    const graph = knowledgeByID(body.code_graph_id)
    if (!graph || graph.type !== "code_graph") throw Object.assign(new Error("code graph not found"), { status: 404 })
    // As the hub: explore takes a `query`, not a symbol (knowledge/openapi.yaml:1139).
    const query = String(body.query ?? "").trim()
    if (!query) throw Object.assign(new Error("query is required"), { status: 400 })
    const match = codeNodes(graph).find((node) => node.symbol.includes(query) || String(node.file ?? "").includes(query))
    if (!match) return { nodes: [], edges: [] }
    return walkGraph(graph, match.symbol, { direction: "both", depth: 1 })
  },

  "POST /v3/code-graph/node": (body) => {
    const graph = knowledgeByID(body.code_graph_id)
    if (!graph || graph.type !== "code_graph") throw Object.assign(new Error("code graph not found"), { status: 404 })
    return callCodeTool(graph, "node", { symbol: String(body.symbol ?? "") })
  },

  /** Re-index a graph: the hub starts a sync job and answers 202 `{code_graph_id, status}`. */
  "POST /v3/code-graph/sync": (body) => {
    const graph = knowledgeByID(body.code_graph_id)
    if (!graph || graph.type !== "code_graph" || !sameTeam(graph, body)) throw Object.assign(new Error("code graph not found"), { status: 404 })
    // A second sync while one runs is busy.
    if (graph.status === "processing") throw Object.assign(new Error("busy"), { status: 409 })
    graph.status = "ready"
    graph.synced_at = iso()
    graph.updated_at = iso()
    save()
    return { code_graph_id: graph.knowledge_id, status: graph.status }
  },

  /** Delete one code graph registration and its index, in the request's container. */
  /** Batch delete, as upstream: `{code_graph_ids}` -> `{deleted_ids, failed}`. */
  "POST /v3/code-graph/delete": (body) => {
    const ids = Array.isArray(body.code_graph_ids) ? body.code_graph_ids.map(String) : []
    if (ids.length === 0 || ids.length > 100) {
      throw Object.assign(new Error("code_graph_ids must hold 1 to 100 ids"), { status: 400 })
    }
    const deleted = []
    const failed = []
    for (const id of ids) {
      const index = state.knowledge.findIndex(
        (item) => item.type === "code_graph" && item.knowledge_id === id && sameTeam(item, body),
      )
      if (index < 0) {
        failed.push({ id, reason: "not found" })
        continue
      }
      state.knowledge.splice(index, 1)
      deleted.push(id)
    }
    save()
    return { deleted_ids: deleted, failed }
  },

  "POST /v3/tools/call": (body) => {
    const knowledge = knowledgeByID(body.knowledge_id)
    if (!knowledge) throw Object.assign(new Error("Knowledge not found"), { status: 404 })
    // A code graph and a wiki answer different tools under the same names.
    if (knowledge.type === "code_graph") return callCodeTool(knowledge, body.tool_name, body.params ?? {})
    return callKnowledgeTool(knowledge, body.tool_name, body.params ?? {})
  },
}

/**
 * The last code-graph request bodies, with their scope headers, for a test of
 * what the gateway forwards (`GET /debug/requests`). Only `/v3/code-graph/*`
 * is kept, and at most 50, so nothing large or unrelated is held.
 */
const codeGraphRequests = []
function noteCodeGraphRequest(key, body, request) {
  if (!key.includes(" /v3/code-graph/")) return
  const headers = request?.headers ?? {}
  codeGraphRequests.push({
    key,
    body,
    headers: {
      "x-tdai-service-id": headers["x-tdai-service-id"] ?? null,
      "x-tdai-team-id": headers["x-tdai-team-id"] ?? null,
      "x-tdai-user-id": headers["x-tdai-user-id"] ?? null,
      "x-tdai-agent-id": headers["x-tdai-agent-id"] ?? null,
    },
  })
  if (codeGraphRequests.length > 50) codeGraphRequests.shift()
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`)
  const key = `${request.method} ${url.pathname}`
  try {
    fs.appendFileSync(`${DATA_FILE}.requests.log`, `${new Date().toISOString()} ${key}\n`)
  } catch {
    /* ignore */
  }
  if (url.pathname.startsWith("/records/")) {
    await serveRecords(request, response, url)
    return
  }
  const handler = routes[key]
  if (!handler) {
    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify(envelope(null, 404, `no route ${key}`)))
    return
  }
  const failure = state.failures?.[url.pathname]
  if (failure && failure.times > 0) {
    failure.times -= 1
    if (failure.times === 0) delete state.failures[url.pathname]
    save()
    response.writeHead(failure.status, { "content-type": "application/json" })
    response.end(JSON.stringify(envelope(null, failure.status, "injected failure")))
    return
  }
  try {
    const body = request.method === "POST" ? await readBody(request) : {}
    noteCodeGraphRequest(key, body, request)
    if (SEARCH_MS > 0 && (key === "POST /v3/conversation/search" || key === "POST /v3/atomic/search")) await new Promise((resolve) => setTimeout(resolve, SEARCH_MS))
    const data = await handler(body, request)
    const isEnvelope = key === "GET /health" || key === "GET /debug/state" || key === "GET /debug/jobs" || key === "GET /debug/requests"
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify(isEnvelope ? data : envelope(data)))
  } catch (error) {
    const status = error?.status ?? 500
    response.writeHead(status, { "content-type": "application/json" })
    // An upstream business code (for example 42201) wins over the HTTP status.
    const code = typeof error?.code === "number" ? error.code : status
    response.end(JSON.stringify(envelope(null, code, error.message)))
  }
})

/**
 * `POST /records/v1/<method>` (and `GET /records/health`): the records
 * service's API, as the gateway forwards it. An injected failure
 * (`POST /debug/fail` with the route) answers first, as for `/v3`.
 */
/**
 * One JSON line per records call, beside requests.log: the method, the space,
 * the targets (kind, path, id, type, action), the stated_by claimed and the one
 * stored, and the status. The eval's write allowlist (gate v2) reads it from
 * the attempt record. Logging only; nothing it writes changes an answer.
 */
function logRecordsCall(method, body, headers, answer) {
  try {
    // A held batch logs each record in it; any other call logs one line.
    const batch = Array.isArray(body?.held_batch?.records) ? body.held_batch.records : null
    const records = batch ?? [body?.record ?? body ?? {}]
    const storedList = Array.isArray(answer?.json?.records) ? answer.json.records : [answer?.json?.record ?? null]
    const lines = records.map((record, index) => {
      // An update by id sends no kind or path: take them from the stored record
      // the store answered with, so a legitimate edit names what it changed.
      const stored = storedList[index] ?? null
      return {
        at: new Date().toISOString(),
        method,
        status: answer?.status ?? 0,
        // The space the stub resolved: a local-mode call sends no x-records-space, and
        // an empty one would read as unknown to the eval's write categories.
        space: (() => {
          const resolved = actorFrom(headers ?? {})
          return String(headers?.["x-records-space"] ?? (resolved.error ? body?.space : resolved.space) ?? "")
        })(),
        credential: String(headers?.["x-records-credential"] ?? ""),
        kind: record?.kind ?? stored?.kind ?? null,
        type: record?.type ?? stored?.type ?? null,
        path: record?.path ?? body?.path ?? stored?.path ?? null,
        id: record?.id ?? body?.id ?? stored?.id ?? null,
        ids: Array.isArray(body?.ids) ? body.ids.slice(0, 20) : null,
        action: body?.action ?? body?.decision ?? null,
        count: batch ? batch.length : null,
        batch_index: batch ? index : null,
        migrate_legacy: body?.migrate_legacy === true,
        // What a put replaces (0.9.10, REVIEW-0910): the ids it supersedes, whether it
        // updated a record by id, and whether it created one (an upsert that did not
        // replaced a page). The eval's write categories read them.
        supersedes: Array.isArray(record?.supersedes) && record.supersedes.length > 0 ? record.supersedes.slice(0, 20) : null,
        by_id: typeof record?.id === "string" && record.id !== "",
        created: batch ? (stored?.version === 1 ? true : null) : typeof answer?.json?.created === "boolean" ? answer.json.created : null,
        claimed_stated_by: record?.stated_by ?? null,
        stored_stated_by: (batch ? stored?.stated_by : answer?.json?.provenance?.stored ?? stored?.stated_by) ?? null,
      }
    })
    fs.appendFileSync(`${DATA_FILE}.records.jsonl`, lines.map((line) => `${JSON.stringify(line)}\n`).join(""))
  } catch {
    /* ignore */
  }
}

async function serveRecords(request, response, url) {
  const send = (status, json) => {
    response.writeHead(status, { "content-type": "application/json" })
    response.end(JSON.stringify(json))
  }
  if (request.method === "GET" && url.pathname === "/records/health") {
    send(200, { ok: true, version: "stub-records-1", spaces: (await recordsStore.listSpaces()).length })
    return
  }
  const match = /^\/records\/v1\/([a-z]+\.[A-Za-z]+)$/.exec(url.pathname)
  if (request.method !== "POST" || !match) {
    send(404, { error: { code: "not_found", message: `no route ${request.method} ${url.pathname}`, next: "POST /records/v1/<method>" } })
    return
  }
  const failure = state.failures?.[url.pathname]
  if (failure && failure.times > 0) {
    failure.times -= 1
    if (failure.times === 0) delete state.failures[url.pathname]
    save()
    send(failure.status, { error: { code: "injected", message: "injected failure", next: "try again" } })
    return
  }
  let body
  try {
    body = await readBody(request)
  } catch {
    send(400, { error: { code: "invalid_json", message: "the body is not JSON", next: "send a JSON object" } })
    return
  }
  const answer = await handleRecords(recordsStore, match[1], body, request.headers, recordsRuns)
  logRecordsCall(match[1], body, request.headers, answer)
  if (answer.bytes) {
    response.writeHead(answer.status, { "content-type": answer.contentType })
    response.end(answer.bytes)
    return
  }
  send(answer.status, answer.json)
}

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`memory stub listening on http://127.0.0.1:${PORT} (data: ${DATA_FILE})\n`)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
