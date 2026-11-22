// Native harness contracts generated from the accepted, hash-verified pure declarations.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
const frozen = JSON.parse(readFileSync(new URL("../../worlds/mem/baseline-586/core-contracts.json", import.meta.url)))
export const coreCases = frozen.cases.map((s) => ({ ...s, original_id: s.id, id: `deep-mem-${s.id}`, port_status: "offline-truth-ported" }))
const assertionTypes=new Set(["expectTools","forbidTools","expectToolOutput","expectToolArgs","expectAnswerJson","expectDecisionJson","forbidAnswer","answerSentences","maxToolCalls","expectExitSuccess","anyOf","expectState","forbidState"])
const supported=(a)=>assertionTypes.has(a.type)&&(a.type!=="anyOf"||a.groups.every((g)=>g.every(supported)))
export const coreCoverage = () => {
  const blocked=coreCases.filter((c)=>!c.assertions.every(supported)).map((c)=>c.original_id)
  return { ready: coreCases.length === 38&&!blocked.length, ported: coreCases.length-blocked.length, blocked, source_sha256: frozen.source_sha256, runtime_verified: false }
}
export function bindCoreSeed(s, scope) {
  const bind = (v) => typeof v === "string" && v.startsWith("$scope.") ? scope(...v.slice(7).split(".")) : Array.isArray(v) ? v.map(bind) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k,x]) => [k,bind(x)])) : v
  return bind(s.seed)
}
export function renderCore(s) {
  return `# ${s.id}
- Plugin: mem
- Skill under test: mem.usage
- Set: deep, mem-core
- Status: deferred
- Data: synthetic
- Budget: outer_calls <= 14, inner_calls <= 14, tokens <= 64000, wall_ms <= 180000

## Prompt
${s.prompts[0]}

## Items
- [MEM-CT01] blocker · Every frozen assertion and the independent durable-state oracle agree.
  evidence: memory-core:${s.original_id}

## Notes
- Literal port: ${frozen.version}; ${s.assertions.length} assertions. Runtime proof remains pending.
- The native Memory turn plan selects all ${s.prompts.length} original prompts separately; fresh session after turn ${s.newSessionAfterRun ?? "none"}. Never concatenate continuation prompts.
`
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const dir = resolve(import.meta.dirname, "../../cases/mem"); mkdirSync(dir, { recursive: true })
  for (const s of coreCases) writeFileSync(join(dir, `${s.id}.md`), renderCore(s))
  console.log(JSON.stringify(coreCoverage()))
}
