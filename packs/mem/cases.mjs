// Preregistered discovery requests. Prompts carry no action hints. A missing final schema is an explicit gap,
// not a guessed tools.mem function, n/a, or a made-up success. All runtime cases stay deferred this phase.
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve, join } from "node:path"

const families = [
  { family: "memory", tool: "remember", args: { content: "Quartz uses green labels.", kind: "fact" }, prompts: ["Remember that Quartz uses green labels.", "Keep this fact for later: Quartz uses green labels."], state: ["mem.personal.memories == 1", "mem.shared.records == 0"], answer: "Stored the Quartz fact.", fixture: "records.put", input: { record: { kind: "memory", type: "fact", body: "Quartz uses green labels." } } },
  { family: "page", tool: "page", args: { action: "write", path: "projects/quartz", content: "Quartz is a synthetic project." }, prompts: ["Create a project page for Quartz saying it is a synthetic project.", "Put a page about Quartz in my projects, with the text: Quartz is a synthetic project."], state: ["mem.personal.pages == 1", "mem.personal.memories == 0"], answer: "Stored the Quartz page.", fixture: "records.put", input: { record: { kind: "page", path: "projects/quartz", body: "Quartz is a synthetic project." } } },
  { family: "commitment", tool: "commitments", args: { action: "add", what: "Send the Quartz draft" }, prompts: ["I will send the Quartz draft. Track that promise without a date.", "Add sending the Quartz draft to what I owe. I have not chosen a deadline."], state: ["mem.personal.commitments == 1", "mem.personal.memories == 0"], answer: "Stored the Quartz promise without a date.", fixture: "records.put", input: { record: { kind: "commitment", body: "Send the Quartz draft" } } },
  { family: "wiki-write", tool: "wiki", args: { action: "write", wiki_id: "wiki-eval-personal", filename: "design.md", content: "Quartz is synthetic." }, prompts: ["In my Quartz wiki, save the supplied document design.md: Quartz is synthetic.", "Store this source document in my Quartz wiki as design.md: Quartz is synthetic."], state: ["mem.personal.wiki.files == 1", "mem.personal.pages == 0", "mem.shared.wiki.files == 0"], answer: "Stored source design.md.", fixture: "wiki.raw.write", input: { wiki_id: "wiki-eval-personal", filename: "design.md", content: "Quartz is synthetic." } },
  { family: "wiki-read", tool: "wiki", args: { action: "read", wiki_id: "wiki-eval-personal", filename: "design.md" }, prompts: ["What marker is in the design.md source in my Quartz wiki? Give only the marker.", "Read my Quartz wiki's design.md document and tell me its marker, with no extra text."], state: ['mem.reads.last_text == "QUARTZ-92"'], answer: "QUARTZ-92", fixture: "wiki.raw.read", input: { wiki_id: "wiki-eval-personal", filename: "design.md" }, seed: { method: "wiki.raw.write", input: { wiki_id: "wiki-eval-personal", filename: "design.md", content: "QUARTZ-92" } } },
  { family: "browse", tool: "recall", args: { query: "*", limit: 1 }, prompts: ["Show a one-item sample of my records. If there are more, say the sample is partial.", "Give me just one of my records, and clearly say if the list is incomplete."], state: ["mem.list.more == true"], answer: "Partial sample.", fixture: "records.list", input: { limit: 1 }, seedRecords: [{ kind: "memory", type: "fact", body: "Quartz uses green labels." }, { kind: "memory", type: "fact", body: "Quartz uses round seals." }] },
  { family: "exact-read", prompts: ["Read the full current body of record rec_eval_1.", "Show record rec_eval_1 in full, not a ranked snippet."], gap: "Final exact-memory-read schema and fixture transport pending." },
  { family: "code", prompts: ["Which functions call Quartz's parseInvoice symbol in the indexed repository?", "Find callers of parseInvoice in the Quartz code graph, not page backlinks."], gap: "Final code-family schemas; direct code-graph route, authorization and state capture pending." },
  { family: "wiki-graph", prompts: ["Show the connections between pages in my Quartz wiki.", "What communities appear in the Quartz document graph?"], gap: "Final wiki graph read schema and synthetic topology oracle pending." },
  { family: "skills", prompts: ["List versions of the stored Quartz skill.", "Show the saved Quartz skill's version history."], gap: "Final stored-skills read schemas and fixture contract pending; not wiki versions." },
  { family: "sources", prompts: ["Request linking my synthetic mail account to Memory; tell me what I must confirm.", "Ask Memory to connect the synthetic mail account, but do not claim it is linked yet."], gap: "Synthetic source request/console link transport and readback pending; no real source call." },
  { family: "jobs", prompts: ["Draft a Memory job for the Quartz project, without activating it.", "Prepare a proposed Quartz Memory pipeline; leave running it for me to approve."], gap: "Synthetic jobs.draft transport and durable inactive-state oracle pending." },
]

export const memCases = families.flatMap((s) => s.prompts.map((prompt, i) => ({ ...s, id: `${s.fixture && !s.family.includes("read") && s.family !== "browse" ? "commit" : "deep"}-mem-${s.family}${i ? "-p" : ""}`, prompt })))
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
export function renderCase(spec) {
  const clauses = [...(spec.state ?? ["mem.final_schema_bound == true"])]
  if (spec.fixture?.endsWith(".put") || spec.fixture === "wiki.raw.write") {
    clauses.push("mem.personal.changed == true")
    clauses.push("mem.receipts.stored == 1")
    clauses.push(`${spec.fixture === "wiki.raw.write" ? "mem.personal.wiki.text" : `mem.personal.bodies.${spec.input.record.kind}`} == ${JSON.stringify(spec.input.content ?? spec.input.record.body)}`)
  }
  return `# ${spec.id}
- Plugin: mem
- Skill under test: mem.usage
- Tier: T3
- Set: ${spec.id.startsWith("commit-") ? "commit" : "deep"}, mem-discovery
- Status: deferred
- Data: synthetic
- Checkable: action, query, kind, content, path, wiki_id, filename, what
- Budget: outer_calls <= 8, inner_calls <= 8, tokens <= 64000, wall_ms <= 180000

## Prompt
${spec.prompt}

## Items
- [MEM-OC01] blocker · The request reaches the correct family and the independent synthetic state oracle.
${spec.tool ? `  evidence: call:mem.${spec.tool}#1\n${Object.entries(spec.args).map(([key, value]) => `  evidence: call:mem.${spec.tool}#1 args.${key} == ${JSON.stringify(value)}`).join("\n")}\n` : ""}${clauses.map((c) => `  evidence: state:${c}`).join("\n")}
${spec.answer ? `
- [MEM-RT01] blocker · The final answer states only the verified fixture outcome.
  evidence: text:any matches /^${escape(spec.answer)}$/
` : ""}
## Notes
- ${spec.gap ?? "Offline compiler/oracle fixture exists. Actual plugin, tool arguments, catalog/search and receipt compatibility still require container proof."}
- direct/search are separate execution conditions, paired within each final baseline/candidate arm, three trials each; no real search measurement exists yet.
`
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const dir = resolve(import.meta.dirname, "../../cases/mem")
  mkdirSync(dir, { recursive: true })
  for (const spec of memCases) writeFileSync(join(dir, `${spec.id}.md`), renderCase(spec))
  console.log(`${memCases.length} deferred discovery cases written`)
}
