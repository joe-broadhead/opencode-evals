import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { qualifyConditions, completeTrials, validateWave, qualifyWave } from "../src/run/wave-manifest.mjs"

// Invented offline evidence only: never a runnable/accepted wave manifest.
function evidence(t) {
  const root = mkdtempSync(join(tmpdir(), "wave-qualification-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const pin = (name, data) => {
    const path = join(root, name), bytes = JSON.stringify(data)
    writeFileSync(path, bytes)
    return { path, sha256: createHash("sha256").update(bytes).digest("hex") }
  }
  const identity = { runtime_sha256: "1".repeat(64), archive_sha256: "2".repeat(64), model: "opencode/deepseek-v4.1-flash#low" }
  const q = { schema: "oc-mem-conditions/1", ...identity, mapping: "execute-permission-v1", status: "qualified", memory_tool_ids: ["mem_recall", "mem_wiki"], observations: {} }
  for (const condition of ["direct", "search"]) q.observations[condition] = {
    config: pin(`${condition}-config.json`, { permissions: [{ action: "execute", resource: "*", effect: condition === "direct" ? "deny" : "allow" }] }),
    catalog: pin(`${condition}-catalog.json`, [{ id: "mem_recall" }, { id: "mem_wiki" }]),
    request: pin(`${condition}-request.json`, { tools: (condition === "direct" ? ["mem_recall", "mem_wiki"] : ["execute", "search"]).map(name => ({ type: "function", function: { name } })) }),
  }
  return { root, q, pin, identity }
}

test("conditions require matching observed config, catalog and request artifacts for both modes", t => {
  const f = evidence(t)
  const qualify = () => qualifyConditions(f.q, f.identity)
  assert.equal(qualify().mapping, "execute-permission-v1")
  delete f.q.observations.search
  assert.throws(qualify, /observation/)
  assert.throws(() => qualifyConditions({ ...f.q, observations: { direct: { observed: true }, search: { observed: true } } }, f.identity), /pin/)
})

test("full qualification binds staged arms, runtime, exact catalog, variant evidence and case files", t => {
  const f = evidence(t), node = f.pin("node", "fake Linux Node"), host = f.pin("opencode", "fake 2.2.6")
  const catalog = f.pin("catalog.json", { opencode: { models: { "deepseek-v4.1-flash": { cost: { input: 1, output: 2, cache_read: 1, cache_write: 1 } } } } })
  const modelProof = f.pin("model-proof.json", { schema: "oc-mem-model-qualification/1", status: "qualified", model: f.identity.model, runtime_sha256: host.sha256, catalog_sha256: catalog.sha256, source: "offline test only", as_of: "2026-11-22", selection: f.pin("selection.json", { providerID: "opencode", id: "deepseek-v4.1-flash", variant: "low" }), request: f.pin("model-request.json", { reasoning_effort: "low" }), variant_path: ["reasoning_effort"], variant_value: "low" })
  const arms = {}
  for (const name of ["baseline", "candidate"]) {
    const directory = join(f.root, name)
    const files = { "index.js": 'export {default} from "./src/index.js"', "src/index.js": "export default {}", "package.json": JSON.stringify({ name: "@joe-broadhead/opencode-mem", main: "./index.js" }), "skills/test/SKILL.md": "test", "docs/agent-instructions.md": "test" }
    for (const [path, bytes] of Object.entries(files)) { mkdirSync(join(directory, path, ".."), { recursive: true }); writeFileSync(join(directory, path), bytes) }
    const archive = f.pin(`${name}.tgz`, `test archive ${name}`)
    writeFileSync(join(directory, ".mem-arm.json"), JSON.stringify({ schema: "oc-mem-arm/1", source_commit: "b".repeat(40), archive_sha256: archive.sha256, files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, createHash("sha256").update(bytes).digest("hex")])) }))
    arms[name] = { directory, archive, conditions: f.pin(`${name}-proof.json`, { ...f.q, runtime_sha256: host.sha256, archive_sha256: archive.sha256 }) }
  }
  const caseFile = f.pin("case-a.json", { id: "case-a", sets: ["tune"] })
  const plan = { schema: "oc-mem-wave-plan/1", cases: [{ id: "case-a", conditions: ["direct", "search"], file: caseFile, set: "tune" }] }
  const wave = { schema: "oc-mem-wave/1", id: "test-wave", model: f.identity.model, target_usd: 10, total_ms: 3600000, cleanup_ms: 120000, docker_context: "colima-mem-evals-20261122", harness_sha: "a".repeat(40), plan: f.pin("plan.json", plan), trials: completeTrials(plan), control: f.root, store: join(f.root, "store"), cases_dir: f.root, docker_config: f.root, trial_timeout_s: 420, caps: f.pin("caps.json", {}), catalog, model_qualification: modelProof, runtime: { version: "2.2.6", opencode: host, node, docker: node, launcher_node: node, image: `sha256:${"d".repeat(64)}` }, inputs: { fixture: caseFile, schema: caseFile, discovery: caseFile }, arms }
  const verify = () => qualifyWave(wave, { harnessSha: wave.harness_sha, launcherNodeSha: node.sha256 })
  assert.equal(verify().plan.cases.length, 1)
  assert.equal(verify().execution_qualified, false, "runtime capability evidence cannot supply the missing recorder handshake")
  assert.equal(verify().plan.cases[0].tier, "wide")
  wave.trial_timeout_s = 0
  assert.throws(verify, /timeout/)
  wave.trial_timeout_s = 420
  plan.cases[0].file = f.pin("alias.json", { id: "case-a", sets: ["tune"] })
  wave.plan = f.pin("plan.json", plan)
  assert.throws(verify, /case pin/)
  plan.cases[0].file = caseFile
  wave.plan = f.pin("plan.json", plan)
  wave.runtime.opencode.sha256 = "f".repeat(64)
  assert.throws(verify, /digest mismatch/)
  wave.runtime.opencode.sha256 = host.sha256 // same object; restore via actual hash below
  wave.runtime.opencode.sha256 = createHash("sha256").update(JSON.stringify("fake 2.2.6")).digest("hex")
  writeFileSync(caseFile.path, "changed case")
  assert.throws(verify, /digest mismatch/)
})

test("wave refuses an incomplete declared sample before any artifact qualification", t => {
  const f = evidence(t)
  const plan = { schema: "oc-mem-wave-plan/1", cases: [{ id: "case-a", conditions: ["direct", "search"] }] }
  const wave = { schema: "oc-mem-wave/1", id: "test-wave", model: f.identity.model, target_usd: 10, total_ms: 3600000, cleanup_ms: 120000, docker_context: "colima-mem-evals-20261122", harness_sha: "a".repeat(40), plan: f.pin("plan.json", plan), trials: completeTrials(plan).slice(1) }
  assert.throws(() => validateWave(wave, { harnessSha: wave.harness_sha }), /complete manifest/)
  assert.throws(() => validateWave({ ...wave, model: "other/deepseek-v4.1-flash#low" }, { harnessSha: wave.harness_sha }), /exact model/)
})

test("complete paired manifest is never reduced and respects accepted case applicability", () => {
  const plan = { schema: "oc-mem-wave-plan/1", cases: [{ id: "case-a", conditions: ["direct", "search"] }, { id: "case-b", conditions: ["direct"] }] }
  const trials = completeTrials(plan)
  assert.equal(trials.length, 18)
  assert.equal(trials.filter(t => t.arm === "baseline" && t.case === "case-a" && t.condition === "search").length, 3)
  assert.equal(trials.some(t => t.case === "case-b" && t.condition === "search"), false)
  assert.throws(() => completeTrials({ ...plan, cases: [plan.cases[0], plan.cases[0]] }), /duplicate/)
  assert.throws(() => completeTrials({ ...plan, cases: [{ id: "case-a", conditions: [] }] }), /condition/)
})
