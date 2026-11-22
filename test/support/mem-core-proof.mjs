// SYNTHETIC UNIT FIXTURES ONLY. Never imported by a grader or a runtime emitter.
// These hand-worked operations implement the frozen document instructions, not observed trial evidence.
import { createHash } from "node:crypto"
const digest = (s) => createHash("sha256").update(s).digest("hex")
const initial = "The gateway resolves context before routing."
const decision = "The control plane uses PostgreSQL for PITR."
const final = `${initial}\n\n${decision}`
const empty = () => ({ atoms: [], records: [], commitments: [], knowledge: [], conversations: [], scenarios: {}, core: {}, skills: [], assets: [], teamMembers: [], agents: [], acl: [], usage: {}, jobs: [], curated: {}, failures: {}, seq: 0, wikiFiles: [], control: { resources: [], grants: [], controlLog: [] } })

export function enrichSyntheticCoreProof(spec, core) {
  core.proof_schema = "oc-mem-durable-proof/2"
  core.state = { ...empty(), ...structuredClone(core.seed), ...core.state }
  core.before = { ...empty(), ...structuredClone(core.seed) }
  for (const request of core.requests) request.verb = request.method.startsWith("/v1/") ? "GET" : "POST"
  if (spec.original_id === "core-wiki-write") {
    const wiki = core.state.knowledge[0]
    const id = wiki.knowledge_id
    wiki.space = "personal"
    wiki.raw = { "README.md": final }
    wiki.raw_versions = { "README.md": { digest: digest(final), revision: 2 } }
    // Successful create, initial write, append and read each have independent fixture observations.
    const resource = { wiki_id: id, filename: "README.md", space: "personal" }
    core.operations = [
      { turn: 1, operation: "wiki.create", status: "stored", ...resource, name: "Core Notes" },
      { turn: 1, operation: "wiki.raw.write", status: "stored", ...resource, before_version: null, version: digest(initial), revision: 1, body: initial },
      { turn: 2, operation: "wiki.raw.write", status: "stored", ...resource, before_version: digest(initial), version: digest(final), revision: 2, before_body: initial, body: final },
      { turn: 3, operation: "wiki.raw.read", status: "read", ...resource, version: digest(final), revision: 2, body: final },
    ]
    for (const operation of core.operations) operation.session = core.turns[operation.turn-1].session
    core.turns[0].calls[0].args = { ...core.turns[0].calls[0].args, filename: "README.md", content: initial }
    core.turns[1].calls[0].args = { ...core.turns[1].calls[0].args, wiki_id: id, filename: "README.md", content: decision }
    core.turns[2].calls[0].args = { ...core.turns[2].calls[0].args, wiki_id: id, filename: "README.md" }
    core.turns[2].calls[0].output = final
  } else core.operations = []
  return core
}
