# deep-mem-sources-p
- Plugin: mem
- Skill under test: mem.usage
- Tier: T3
- Set: deep, mem-discovery
- Status: deferred
- Data: synthetic
- Checkable: action, query, kind, content, path, wiki_id, filename, what
- Budget: outer_calls <= 8, inner_calls <= 8, tokens <= 64000, wall_ms <= 180000

## Prompt
Ask Memory to connect the synthetic mail account, but do not claim it is linked yet.

## Items
- [MEM-OC01] blocker · The request reaches the correct family and the independent synthetic state oracle.
  evidence: state:mem.final_schema_bound == true

## Notes
- Synthetic source request/console link transport and readback pending; no real source call.
- direct/search are separate execution conditions, paired within each final baseline/candidate arm, three trials each; no real search measurement exists yet.
