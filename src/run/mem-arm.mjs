// Memory's directory plugin is a different packaging contract from a dist-based plugin.
// Read only a pre-staged immutable artifact, never the developer checkout or project configuration.
//
// Known limits of the import classifier (verified live-executed; see the classifier
// doc below): two character-level residual shapes are silently admitted today —
// a comparison operator before a real dynamic import on a '*'-headed continuation
// line (`const x = a\n  * b<import("./missing.js")`), which the JSDoc exception's
// two-character test cannot tell apart from a type reference, and a multi-line
// export-star whose specifier lands on a prose-skipped line
// (`export\n* from "./missing.js"`). Both pre-exist the parent classifier and
// neither occurs in the censused staged arms. Any arm admission beyond that
// censused pair requires the committed future fix: a bounded comment-aware
// scanner that separates comment contexts from executable continuations.
import { lstatSync, readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs"
import { dirname, join, posix } from "node:path"
import { sha256, canonical } from "../util/canonical.mjs"
import { gunzipSync } from "node:zlib"

export const isMemoryPackage = (pkg) => pkg?.name === "@joe-broadhead/opencode-mem"
/** The documented real member classes of a cleared npm-pack Memory corpus: the package
 * entrypoints and top-level docs (README, CHANGELOG, SECURITY), and the packaged
 * subtrees — source, skills, docs, assets, the service interface, the shared page
 * helpers, the HTML views and the records backend. Arbitrary or unknown member
 * classes still refuse; this is an enumerated allowlist, not a wildcard. */
const safe = (p) => typeof p === "string" && /^(?:index\.js|package\.json|LICENSE|README\.md|CHANGELOG\.md|SECURITY\.md|(?:src|skills|docs|assets|service-interface|shared|views|records)\/[A-Za-z0-9._/-]+)$/.test(p) && !p.split("/").some((s) => !s || s === "." || s === ".." || s.startsWith("."))

/** Import-form grammar: the exact ESM statement shapes the classifier accepts.
 * The clause admits named members with `as` renames and an optional trailing comma;
 * anything else that reaches here is an unclassifiable form and refuses the arm. */
const IDENT = "[A-Za-z_$][A-Za-z0-9_$]*"
const CLAUSE = `${IDENT}(?:\\s+as\\s+${IDENT})?(?:\\s*,\\s*${IDENT}(?:\\s+as\\s+${IDENT})?)*\\s*,?`
const NAMED = `\\{(?:\\s*${CLAUSE}\\s*)\\}`
const IMPORT_CLAUSE = `(?:${IDENT}(?:\\s*,\\s*(?:\\*\\s*as\\s+${IDENT}|${NAMED}))?|\\*\\s+as\\s+${IDENT}|${NAMED})`
const IMPORT_FORM = new RegExp(`^import(?![A-Za-z0-9_$])(?:\\s+${IMPORT_CLAUSE}\\s+from|\\s*)$`)
const EXPORT_FORM = new RegExp(`^export(?![A-Za-z0-9_$])\\s+(?:${NAMED}|\\*(?:\\s+as\\s+${IDENT})?)\\s+from$`)
const HEAD = /^(?:import|export)(?![A-Za-z0-9_$])/
const STATEMENT_FORM = (statement) => {
  const specifier = /["'][^"']+["']\s*;?\s*$/.exec(statement)
  if (!specifier) return false
  const body = statement.slice(0, specifier.index).trimEnd()
  return IMPORT_FORM.test(body) || EXPORT_FORM.test(body)
}

/** Reconstruct a multi-line import/export clause: walk backward over blank and
 * identifier-only member lines to the statement head. Any other line shape, or a
 * missing head within the bound, refuses the arm rather than being guessed. */
const CLAUSE_MEMBER = /^[A-Za-z0-9_$,\s]*$/
function clauseStatement(code, lineStart, end) {
  const pieces = [code.slice(lineStart, end)]
  let lineEnd = lineStart - 1
  for (let i = 0; i < 256; i++) {
    if (lineEnd < 0) return null
    const newline = code.lastIndexOf("\n", lineEnd - 1)
    const start = newline + 1
    const line = code.slice(start, lineEnd)
    if (!line.trim()) { pieces.unshift(line); lineEnd = start - 1; continue }
    if (HEAD.test(line.trimStart())) { pieces.unshift(line); return pieces.join("\n") }
    if (CLAUSE_MEMBER.test(line)) { pieces.unshift(line); lineEnd = start - 1; continue }
    return null
  }
  return null
}

/** The import match surface is unchanged; each match is then classified.
 * A match is an import only when its whole statement — from the line's first token
 * through the specifier — matches the exact ESM import/export grammar, with
 * multi-line clauses reconstructed backward over identifier-only member lines.
 * On a '*'-headed line only two shapes skip: a JSDoc type reference written as
 * '<import(' inside the comment, and pure prose. A match preceded on its line by
 * the block-comment close sequence — including any line head that begins with
 * it, a comment close with executable code after it — refuses, and so does every
 * other import-shaped match in '*' position, because a '*' can also head a valid
 * expression-continuation (multiplication) line. A match whose keyword directly
 * follows a quote character is string data: an import-position keyword never
 * does. Known limits, verified live-executed: the two character-level tests
 * cannot fully separate comment contexts from executable continuations, so two
 * residual shapes are silently admitted — a comparison operator before a real
 * dynamic import on a continuation line (`const x = a\n  * b<import("./m.js")`)
 * matches the JSDoc exception, and a multi-line export-star whose specifier
 * lands on a prose-skipped line (`export\n* from "./m.js"`) skips. Neither
 * shape occurs in the censused staged arms; both pre-exist the parent. A
 * bounded comment-aware scanner is the committed fix for admitting any corpus
 * beyond that censused pair. */
function classifyImports(code, path) {
  const imports = []
  for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)) {
    const at = match.index, end = at + match[0].length
    const lineStart = code.lastIndexOf("\n", at - 1) + 1
    const lineEnd = code.indexOf("\n", at)
    const line = code.slice(lineStart, lineEnd === -1 ? code.length : lineEnd)
    const head = line.trimStart()
    const headStart = lineStart + (line.length - head.length)
    if (HEAD.test(head)) {
      if (STATEMENT_FORM(code.slice(headStart, end))) { imports.push(match[1]); continue }
      throw new Error(`Memory import form is unclassifiable: ${path}`)
    }
    if (head.startsWith("}")) {
      const statement = clauseStatement(code, lineStart, end)
      if (statement && STATEMENT_FORM(statement)) { imports.push(match[1]); continue }
      throw new Error(`Memory import form is unclassifiable: ${path}`)
    }
    if (head.startsWith("*")) {
      // A match preceded by '*/' on its line sits after a block-comment close: executable position.
      if (code.slice(lineStart, at).includes("*/")) throw new Error(`Memory import form is unclassifiable: ${path}`)
      // JSDoc type reference: '<import(' inside the comment.
      if (code.startsWith("import(", at) && code[at - 1] === "<") continue
      // A '*' can head a valid expression-continuation (multiplication) line: no other
      // import-shaped match in '*' position is silently treated as comment prose.
      if (code.startsWith("import", at)) throw new Error(`Memory import form is unclassifiable: ${path}`)
      continue
    }
    if (at > 0 && /["'`]/.test(code[at - 1])) continue
    throw new Error(`Memory import form is unclassifiable: ${path}`)
  }
  return imports
}

/** Verify every manifest entry and relative import before writing anything. Claims about the archive remain explicit. */
export function memoryArtifact(source) {
  const path = join(source, ".mem-arm.json")
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) throw new Error("Memory requires a staged .mem-arm.json artifact manifest")
  const m = JSON.parse(readFileSync(path, "utf8"))
  if (m.schema !== "oc-mem-arm/1" || !/^[0-9a-f]{40}$/.test(m.source_commit) || !/^[0-9a-f]{64}$/.test(m.archive_sha256) || !m.files || Array.isArray(m.files)) throw new Error("invalid Memory artifact manifest")
  const files = Object.keys(m.files).sort()
  if (!files.includes("index.js") || !files.includes("src/index.js") || !files.includes("package.json") || !files.some((p) => p.startsWith("skills/")) || !files.includes("docs/agent-instructions.md")) throw new Error("Memory manifest lacks the entrypoint/source/skill/instruction closure")
  const bytes = new Map()
  for (const p of files) {
    if (!safe(p) || !/^[0-9a-f]{64}$/.test(m.files[p])) throw new Error(`unsafe Memory manifest path or digest: ${p}`)
    let at = source
    for (const segment of p.split("/")) {
      at = join(at, segment)
      if (!existsSync(at) || lstatSync(at).isSymbolicLink()) throw new Error(`Memory artifact missing file or has a link: ${p}`)
    }
    if (!lstatSync(at).isFile()) throw new Error(`Memory artifact not a file: ${p}`)
    const data = readFileSync(at)
    if (sha256(data) !== m.files[p]) throw new Error(`Memory artifact digest mismatch: ${p}`)
    bytes.set(p, data)
  }
  const pkg = JSON.parse(bytes.get("package.json").toString())
  if (!isMemoryPackage(pkg) || pkg.main !== "./index.js" || Object.keys(pkg.dependencies ?? {}).length) throw new Error("Memory artifact package entrypoint/dependency contract differs")
  for (const [p, data] of bytes) {
    if (!p.endsWith(".js") && !p.endsWith(".mjs")) continue
    const code = data.toString()
    // Static import/export statement forms classify above or refuse; JSDoc '<import('-
    // shaped matches and prose on '*'-headed lines skip; nonliteral dynamic imports are
    // rejected here, and literal dynamic imports and from-matches in ambiguous positions
    // refuse rather than being guessed — except the two known-limit residual shapes
    // documented on the classifier and in the module header, which currently skip.
    // The closure check below therefore sees verified static statements plus exactly
    // those two documented residuals, and nothing else.
    if (/\bimport\s*\(\s*[^"'\s]/.test(code)) throw new Error(`Memory closure has a nonliteral import: ${p}`)
    for (const specifier of classifyImports(code, p)) {
      if (specifier.startsWith("node:")) continue
      if (!specifier.startsWith(".")) throw new Error(`Memory closure has an external runtime import: ${p}`)
      const target = posix.normalize(posix.join(posix.dirname(p), specifier))
      if (!bytes.has(target)) throw new Error(`Memory import closure is missing ${target}`)
    }
  }
  return { ...m, files: Object.fromEntries(files.map((p) => [p, m.files[p]])), closure_sha256: sha256(canonical(m.files)) }
}

export function materialiseMemoryArm(source, into) {
  const manifest = memoryArtifact(source)
  if (existsSync(into)) throw new Error("Memory arm destination must be absent")
  mkdirSync(into, { recursive: true, mode: 0o700 })
  for (const p of Object.keys(manifest.files)) {
    mkdirSync(dirname(join(into, p)), { recursive: true, mode: 0o700 })
    copyFileSync(join(source, p), join(into, p))
  }
  copyFileSync(join(source, ".mem-arm.json"), join(into, ".mem-arm.json"))
  return into
}

/** Stage an npm-style tarball with no shell or install hooks. Reject links/PAX/unknown formats rather than guess. */
export function stageMemoryTarball(archive, expected, into) {
  if (!Buffer.isBuffer(archive) || archive.length > 32 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(expected?.sha256) || sha256(archive) !== expected.sha256 || !/^[a-f0-9]{40}$/.test(expected.source_commit)) throw new Error("Memory archive digest/source pin mismatch")
  if (existsSync(into)) throw new Error("Memory archive destination exists")
  let tar
  try { tar = gunzipSync(archive, { maxOutputLength: 64 * 1024 * 1024 }) } catch { throw new Error("Memory archive must be bounded gzip tar") }
  const data = new Map(), seen = new Set()
  const string = (h,a,b) => h.subarray(a,b).toString().split("\0")[0]
  let ended = false
  for (let at=0;at+512<=tar.length;) {
    const h=tar.subarray(at,at+512)
    if (h.every((b)=>b===0)) { ended=true; break }
    const checksum=string(h,148,156).trim(), sizeText=string(h,124,136).trim()
    if (!/^[0-7]+$/.test(checksum)||!/^[0-7]+$/.test(sizeText)) throw new Error("invalid tar header")
    const sum=[...h].reduce((v,b,i)=>v+(i>=148&&i<156?32:b),0),size=parseInt(sizeText,8)
    if (sum!==parseInt(checksum,8)||at+512+size>tar.length) throw new Error("invalid tar checksum/size")
    const name=(string(h,345,500)?`${string(h,345,500)}/`:"")+string(h,0,100),type=string(h,156,157)||"0"
    if (!name.startsWith("package/") || name.includes("\\") || name.split("/").some((s)=>s===".."||s===".")) throw new Error("unsafe tar path")
    if (!["0","5"].includes(type)) throw new Error("tar links and nonregular entries are refused")
    const p=name.slice(8).replace(/\/$/,"")
    if (seen.has(p)) throw new Error("duplicate tar path")
    seen.add(p)
    if (/(^|\/)(opencode\.jsonc?|AGENTS\.md|CLAUDE\.md|\.opencode|\.env|\.mem-arm\.json)(\/|$)/.test(p)) throw new Error("project config is not allowed in the Memory archive")
    if (type==="0" && safe(p)) data.set(p,Buffer.from(tar.subarray(at+512,at+512+size)))
    at+=512+Math.ceil(size/512)*512
  }
  if (!ended || !data.has("package.json")) throw new Error("truncated or empty Memory tar archive")
  const files=Object.fromEntries([...data].map(([p,b])=>[p,sha256(b)]))
  // All source validation happens in the owned staging directory; remove it if the archive lacks its import closure.
  mkdirSync(into,{recursive:true,mode:0o700})
  try {
    for (const [p,b] of data) {mkdirSync(dirname(join(into,p)),{recursive:true,mode:0o700});writeFileSync(join(into,p),b,{flag:"wx",mode:0o600})}
    writeFileSync(join(into,".mem-arm.json"),JSON.stringify({schema:"oc-mem-arm/1",source_commit:expected.source_commit,archive_sha256:expected.sha256,files}),{flag:"wx",mode:0o600})
    return memoryArtifact(into)
  } catch(e) {rmSync(into,{recursive:true,force:true});throw e}
}
