# deep-mem-wiki-read
- Plugin: mem
- Skill under test: mem.usage
- Tier: T3
- Set: deep, mem-discovery
- Status: deferred
- Data: synthetic
- Checkable: action, query, kind, content, path, wiki_id, filename, what
- Budget: outer_calls <= 8, inner_calls <= 8, tokens <= 64000, wall_ms <= 180000

## Prompt
What marker is in the design.md source in my Quartz wiki? Give only the marker.

## Items
- [MEM-OC01] blocker · The request reaches the correct family and the independent synthetic state oracle.
  evidence: call:mem.wiki#1
  evidence: call:mem.wiki#1 args.action == "read"
  evidence: call:mem.wiki#1 args.wiki_id == "wiki-eval-personal"
  evidence: call:mem.wiki#1 args.filename == "design.md"
  evidence: state:mem.reads.last_text == "QUARTZ-92"

- [MEM-RT01] blocker · The final answer states only the verified fixture outcome.
  evidence: text:any matches /^QUARTZ-92$/

## Notes
- Offline compiler/oracle fixture exists. Actual plugin, tool arguments, catalog/search and receipt compatibility still require container proof.
- direct/search are separate execution conditions, paired within each final baseline/candidate arm, three trials each; no real search measurement exists yet.
