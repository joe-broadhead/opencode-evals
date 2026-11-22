// Offline source snapshot only. This does not assert that an OpenCode runtime loaded the plugin.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"
import { derivePack } from "../../src/pack/from-plugin.mjs"
import { writeSnapshot, verifySnapshot } from "../../src/pack/snapshot.mjs"
import { sha256 } from "../../src/util/canonical.mjs"

export async function snapshotMemory(repo, root = resolve(import.meta.dirname, "../..")) {
  if (!repo) throw new Error("EVALS_REPO_MEM must name the approved plugin checkout")
  repo = resolve(repo)
  const git = (args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  if (git(["status", "--porcelain", "--untracked-files=no"])) throw new Error("plugin tracked source is dirty; freeze an arm first")
  const commit = git(["rev-parse", "HEAD"])
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"))
  if (pkg.name !== "@joe-broadhead/opencode-mem") throw new Error("not the approved Memory plugin")
  const { buildToolset } = await import(pathToFileURL(join(repo, "src/tools/index.js")))
  const definitions = []
  // buildToolset only declares tools. Calling a tool or starting runtime/collector setup is outside this snapshot.
  buildToolset({ add: (tool) => definitions.push(tool) }, { config: {}, log: { debug() {}, warn() {} }, readOnlyTwins: false })
  const catalog = definitions.map(({ name, description, input, options }) => ({ name, description, input, options }))
  const tree = (schema) => ({ ...(schema.properties ? { p: Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, tree(v)])) } : {}), ...(schema.items ? { items: tree(schema.items) } : {}), ...(schema.additionalProperties === true ? { open: true } : {}) })
  const source = { commit, package_sha256: sha256(readFileSync(join(repo, "package.json"))), catalog_sha256: sha256(JSON.stringify(catalog)), kind: "source-snapshot-not-runtime" }
  const pack = writeSnapshot(root, { ...derivePack("mem", repo), t1: [], profile: false, source })
  const verified = verifySnapshot(pack)
  if (!verified.ok) throw new Error(verified.problems.join("; "))
  writeFileSync(join(root, "packs/mem/catalog.json"), JSON.stringify({ source, tools: catalog }, null, 2) + "\n")
  writeFileSync(join(root, "packs/mem/inputs.json"), JSON.stringify({ source, tools: Object.fromEntries(catalog.map((t) => [t.name, tree(t.input)])), unlisted: Object.fromEntries(pack.tools.filter((t) => !catalog.some((c) => c.name === t.name)).map((t) => [t.name, "Declared Jelly read-only twin; not registered by plain OpenCode. Runtime sidecar pending container proof."])) }, null, 2) + "\n")
  return { source, tools: catalog.length, declared: pack.tools.length, snapshot_checks: verified.checks.length, access: pack.access ?? null }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) console.log(JSON.stringify(await snapshotMemory(process.env.EVALS_REPO_MEM), null, 2))
