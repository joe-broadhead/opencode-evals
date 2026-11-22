# commit-mem-page-p
- Plugin: mem
- Skill under test: mem.usage
- Tier: T3
- Set: commit, mem-discovery
- Status: deferred
- Data: synthetic
- Checkable: action, query, kind, content, path, wiki_id, filename, what
- Budget: outer_calls <= 8, inner_calls <= 8, tokens <= 64000, wall_ms <= 180000

## Prompt
Put a page about Quartz in my projects, with the text: Quartz is a synthetic project.

## Items
- [MEM-OC01] blocker · The request reaches the correct family and the independent synthetic state oracle.
  evidence: call:mem.page#1
  evidence: call:mem.page#1 args.action == "write"
  evidence: call:mem.page#1 args.path == "projects/quartz"
  evidence: call:mem.page#1 args.content == "Quartz is a synthetic project."
  evidence: state:mem.personal.pages == 1
  evidence: state:mem.personal.memories == 0
  evidence: state:mem.personal.changed == true
  evidence: state:mem.receipts.stored == 1
  evidence: state:mem.personal.bodies.page == "Quartz is a synthetic project."

- [MEM-RT01] blocker · The final answer states only the verified fixture outcome.
  evidence: text:any matches /^Stored the Quartz page\.$/

## Notes
- Offline compiler/oracle fixture exists. Actual plugin, tool arguments, catalog/search and receipt compatibility still require container proof.
- direct/search are separate execution conditions, paired within each final baseline/candidate arm, three trials each; no real search measurement exists yet.
