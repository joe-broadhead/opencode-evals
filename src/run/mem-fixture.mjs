// The runner owns this lifecycle. Host staging writes files only; launch must go through a confined trial.
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, lstatSync, existsSync } from "node:fs"
import { join, resolve, relative, isAbsolute } from "node:path"
import { PORT, SYNTHETIC_TOKEN } from "../../worlds/mem/http.mjs"
import { sha256 } from "../util/canonical.mjs"
import { stageBaselineFixture } from "./mem-baseline.mjs"
import { stageDiscoveryFixture } from "./mem-discovery-stage.mjs"
import { containerContained } from "./isolation.mjs"

export function stageMemFixture(sandbox, { core = null, discovery = null, intent = null } = {}) {
  const root = join(sandbox.tmp, "mem-fixture")
  const base = resolve(sandbox.root), rel = relative(base, root)
  if (!rel || isAbsolute(rel) || rel.split("/").includes("..") || existsSync(root)) throw new Error("unsafe or pre-existing Memory fixture stage")
  let at = base
  for (const part of ["", ...relative(base, sandbox.tmp).split("/").filter(Boolean)]) {
    at = part ? join(at, part) : at
    if (existsSync(at) && (lstatSync(at).isSymbolicLink() || !lstatSync(at).isDirectory())) throw new Error("unsafe Memory fixture stage ancestor")
  }
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const source = resolve(import.meta.dirname, "../../worlds/mem")
  for (const name of ["container-entry.mjs", "http.mjs", "fixture.mjs"]) copyFileSync(join(source, name), join(root, name))
  if(core&&discovery)throw new Error("ambiguous Memory fixture plan")
  const plan = core ? stageBaselineFixture(root, core, intent) : discovery ? stageDiscoveryFixture(root,discovery,intent) : null
  writeFileSync(join(root, "descriptor.json"), JSON.stringify({ schema: "oc-mem-fixture/1", fixture: "mem-synthetic-v1", port: PORT, ...(plan ? { transport: discovery?"discovery-v2":"baseline-586" } : {}) }), { flag: "wx", mode: 0o600 })
  return { root, sandboxRoot: sandbox.root, entry: join(root, "container-entry.mjs"), url: `http://127.0.0.1:${PORT}`, port: PORT, ...(plan ? { plan, scopeMap: join(root, "scope-map.json") } : {}) }
}

export function memFixtureOptions(spec, options = {}) {
  // These settings override an arm's endpoints; no production credential or source-plugin bridge is used.
  return { ...options, ownService: true, controlURL: spec.plan?.mode === "local" ? "" : spec.url, baseURL: `${spec.url}/core`, knowledgeURL: `${spec.url}/knowledge`, token: spec.plan ? "eval-token" : SYNTHETIC_TOKEN, knowledgeToken: spec.plan ? "eval-token" : SYNTHETIC_TOKEN, ...(spec.plan ? { user: "eval", agent: "build", space: "local", now: "2026-11-12T10:00:00Z" } : {}), capture: false, collect: false, spool: false, bootstrap: false, stateDir: join(spec.root, "plugin-state") }
}

export function memFixtureBinding(isolation) {
  if (!containerContained(isolation)) return null
  return { schema: "oc-mem-contained/1", fixture: "mem-synthetic-v1", backend: "container", origin: `http://127.0.0.1:${PORT}` }
}

export async function startMemFixture({ spec, isolation, trial, binary, launch, stop }) {
  if (!containerContained(isolation)) throw new Error("Memory fixture requires the container backend")
  const wrapped = trial.wrap({ command: binary, args: [spec.entry, spec.root], cwd: spec.root, env: { HOME: spec.root, TMPDIR: spec.root, EVALS_MEM_CONTAINED: "mem-synthetic-v1" } })
  const proc = launch(wrapped)
  try {
    const up = await trial.ready({ url: `${spec.url}/health`, timeoutMs: 10000 })
    if (!up.ok) throw new Error("Memory fixture readiness failed inside the trial")
    return { proc, stop: () => stop(proc) }
  } catch (e) { await stop(proc); throw e }
}

export async function memCaptureRecord(spec, trial, turns = null) {
  if (!(await trial.gone())) throw new Error("Memory fixture container still present or removal unverified")
  const path = join(spec.root, "capture.json")
  const base = resolve(spec.sandboxRoot), rel = relative(base, path)
  if (!rel || isAbsolute(rel) || rel.split("/").includes("..")) throw new Error("unsafe Memory capture location")
  let at = base
  for (const part of ["", ...rel.split("/")]) {
    at = part ? join(at, part) : at
    if (!existsSync(at) || lstatSync(at).isSymbolicLink()) throw new Error("unsafe link or missing Memory capture ancestor")
  }
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile() || lstatSync(path).size > 65536) throw new Error("Memory fixture capture is missing, unsafe or truncated")
  let text = readFileSync(path, "utf8")
  const data = JSON.parse(text)
  if (data.schema !== "oc-mem-capture/1" || data.fixture !== "mem-synthetic-v1") throw new Error("wrong Memory capture schema")
  if (spec.plan) {
    const proof=spec.plan.kind==="discovery"?data.discovery:data.core
    if (proof?.case_id !== spec.plan.case_id || !Array.isArray(turns)) throw new Error("Memory native turn capture is missing")
    proof.turns = turns
    text = JSON.stringify(data)
  }
  return { path: "mem-fixture/capture.json", change: "added", text, bytes: Buffer.byteLength(text), sha256: sha256(text) }
}
