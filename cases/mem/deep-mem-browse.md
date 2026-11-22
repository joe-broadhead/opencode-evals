# deep-mem-browse
- Plugin: mem
- Skill under test: mem.usage
- Tier: T3
- Set: deep, mem-discovery
- Status: deferred
- Data: synthetic
- Checkable: action, query, kind, content, path, wiki_id, filename, what
- Budget: outer_calls <= 8, inner_calls <= 8, tokens <= 64000, wall_ms <= 180000

## Prompt
Show a one-item sample of my records. If there are more, say the sample is partial.

## Items
- [MEM-OC01] blocker · The request reaches the correct family and the independent synthetic state oracle.
  evidence: call:mem.recall#1
  evidence: call:mem.recall#1 args.query == "*"
  evidence: call:mem.recall#1 args.limit == 1
  evidence: state:mem.list.more == true

- [MEM-RT01] blocker · The final answer states only the verified fixture outcome.
  evidence: text:any matches /^Partial sample\.$/

## Notes
- Offline compiler/oracle fixture exists. Actual plugin, tool arguments, catalog/search and receipt compatibility still require container proof.
- direct/search are separate execution conditions, paired within each final baseline/candidate arm, three trials each; no real search measurement exists yet.
