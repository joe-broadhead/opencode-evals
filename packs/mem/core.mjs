// Literal reconstruction only where the original pinned source was read in phase 1 (lines 198-299).
// The remaining source was not retained. Missing truth is not a guessed answer or a coverage success.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
const inventory = JSON.parse(readFileSync(new URL("../../worlds/mem/core-inventory.json", import.meta.url)))
export const recoveredTruth = {
  "core-recall-model": { seed: ["Extraction uses helios-7b.", "The old extraction job used gpt-4o."], answers: ["helios-7b"] },
  "core-recall-orb": { seed: ["Space ownership is held by the Orbital Registry.", "The Orbital Registry codename is ORB-7."], answers: ["ORB-7"] },
  "core-recall-port": { seed: ["The control service listens on port 8787.", "The simulator listens on 8420."], answers: ["8787"] },
  "core-recall-region": { seed: ["Production deploys to the fra region.", "Staging uses ams."], answers: ["fra"] },
  "core-prior-db": { seed: ["The control plane uses SQLite for this deployment.", "PostgreSQL is used by the hosted example, not this one."], answers: ["SQLite"] },
  "core-prior-version": { seed: ["The Nimbus billing client speaks /v9.", "The plugin itself speaks /v3."], answers: ["/v9"] },
  "core-update-mortgage": { seed: ["The first pre-approval letter from Wells Fargo, dated 11 August 2023, listed $350,000 for the house on a quiet street near the park.", "In a later update after the second review, the pre-approval amount changed to $400,000."], answers: ["$400,000", "400,000", "400000"] },
  "core-update-owner": { seed: ["Priya owned the release in September.", "Marco took over ownership in October and is the current owner."], answers: ["Marco"] },
  "core-update-region": { seed: ["Staging used ams.", "Production moved to fra and that is current."], answers: ["fra"] },
  "core-update-flag": { seed: ["The blob_v1 flag was enabled last quarter.", "The blob_v2 flag replaced it and is enabled now."], answers: ["blob_v2"] },
  "core-temporal-inside": { seed: ["A deploy freeze runs from 20 December through 2 January.", "No production ships are allowed during the freeze."], answers: ["no"], polarity: true },
  "core-temporal-outside": { seed: ["A deploy freeze runs from 20 December through 2 January.", "No production ships are allowed during the freeze."], answers: ["yes"], polarity: true },
}
export const coreCases = inventory.cases.map((c) => ({ ...c, id: `deep-mem-${c.id}`, original_id: c.id, ...(recoveredTruth[c.id] ?? {}), port_status: recoveredTruth[c.id] ? "offline-truth-ported" : "blocked-missing-frozen-truth", reason: recoveredTruth[c.id] ? "Recovered from the pinned source read; not runtime-verified." : "Full seed, expected values and original assertion parameters absent from retained artifact. Supply the immutable source matching the inventory digest." }))
export const coreCoverage = () => ({ ready: coreCases.every((c) => c.port_status === "offline-truth-ported"), ported: coreCases.filter((c) => c.seed).length, blocked: coreCases.filter((c) => !c.seed).map((c) => ({ id: c.original_id, reason: c.reason })), source_sha256: inventory.source_sha256 })
export function renderCore(s) {
  return `# ${s.id}
- Plugin: mem
- Skill under test: mem.usage
- Set: deep, mem-core
- Status: deferred
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 8, tokens <= 64000, wall_ms <= 180000

## Prompt
${s.prompts.join("\n\nThen: ")}

## Items
- [MEM-CT01] blocker · Frozen core truth, real read evidence, typed answer and unchanged synthetic scope agree.
  evidence: memory-core:${s.original_id}

## Notes
- Port status: ${s.port_status}. ${s.reason}
- Original assertion types: ${s.assertion_types.join(", ")}. Multi-turn continuation must preserve the original separate prompts; concatenation is not yet runtime-compatible.
`
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const dir = resolve(import.meta.dirname, "../../cases/mem"); mkdirSync(dir, { recursive: true })
  for (const s of coreCases) writeFileSync(join(dir, `${s.id}.md`), renderCore(s))
  console.log(JSON.stringify(coreCoverage()))
}
