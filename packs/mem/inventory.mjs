// Preserve the entire old core's identity without running its legacy harness or substituting its scores.
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { sha256 } from "../../src/util/canonical.mjs"
const repo = process.env.EVALS_REPO_MEM
if (!repo) throw new Error("EVALS_REPO_MEM is required")
const source = join(resolve(repo), "scripts/eval/scenarios-core.mjs")
const { coreScenarios, CORE_SUITE_VERSION } = await import(pathToFileURL(source))
const inventory = { version: CORE_SUITE_VERSION, source_sha256: sha256(readFileSync(source)), port_status: "not-ported-no-runtime-score", cases: coreScenarios.map((c) => ({ id: c.id, category: c.category, prompts: c.runs, assertion_types: c.assertions.map((a) => a.type), status: "blocked-core-port" })) }
writeFileSync(resolve(import.meta.dirname, "../../worlds/mem/core-inventory.json"), JSON.stringify(inventory, null, 2) + "\n")
console.log(`${inventory.cases.length} frozen core cases inventoried, zero claimed ported`)
