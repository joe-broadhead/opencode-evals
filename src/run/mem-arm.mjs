// Memory's directory plugin is a different packaging contract from a dist-based plugin.
// Read only a pre-staged immutable artifact, never the developer checkout or project configuration.
import { lstatSync, readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs"
import { dirname, join, posix } from "node:path"
import { sha256, canonical } from "../util/canonical.mjs"
import { gunzipSync } from "node:zlib"

export const isMemoryPackage = (pkg) => pkg?.name === "@joe-broadhead/opencode-mem"
const safe = (p) => typeof p === "string" && /^(?:index\.js|package\.json|LICENSE|README\.md|(?:src|skills|docs|assets|service-interface)\/[A-Za-z0-9._/-]+)$/.test(p) && !p.split("/").some((s) => !s || s === "." || s === ".." || s.startsWith("."))

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
    // All literal import/export forms, plus side-effect imports. Nonliteral dynamic imports are rejected, not guessed.
    if (/\bimport\s*\(\s*[^"'\s]/.test(code)) throw new Error(`Memory closure has a nonliteral import: ${p}`)
    const imports = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)].map((v) => v[1])
    for (const specifier of imports) {
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
