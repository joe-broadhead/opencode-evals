# commit-mem-wiki-write-p
- Plugin: mem
- Skill under test: mem.usage
- Tier: T3
- Set: commit, mem-discovery
- Status: deferred
- Data: synthetic
- Checkable: action, query, kind, content, path, wiki_id, filename, what
- Budget: outer_calls <= 8, inner_calls <= 8, tokens <= 64000, wall_ms <= 180000

## Prompt
Store this source document in my Quartz wiki as design.md: Quartz is synthetic.

## Items
- [MEM-OC01] blocker · The request reaches the correct family and the independent synthetic state oracle.
  evidence: call:mem.wiki#1
  evidence: call:mem.wiki#1 args.action == "write"
  evidence: call:mem.wiki#1 args.wiki_id == "wiki-eval-personal"
  evidence: call:mem.wiki#1 args.filename == "design.md"
  evidence: call:mem.wiki#1 args.content == "Quartz is synthetic."
  evidence: state:mem.personal.wiki.files == 1
  evidence: state:mem.personal.pages == 0
  evidence: state:mem.shared.wiki.files == 0
  evidence: state:mem.personal.changed == true
  evidence: state:mem.receipts.stored == 1
  evidence: state:mem.personal.wiki.text == "Quartz is synthetic."

- [MEM-RT01] blocker · The final answer states only the verified fixture outcome.
  evidence: text:any matches /^Stored source design\.md\.$/

## Notes
- Offline compiler/oracle fixture exists. Actual plugin, tool arguments, catalog/search and receipt compatibility still require container proof.
- direct/search are separate execution conditions, paired within each final baseline/candidate arm, three trials each; no real search measurement exists yet.
