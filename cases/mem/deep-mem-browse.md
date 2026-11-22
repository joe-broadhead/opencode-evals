# deep-mem-browse
- Plugin: mem
- Skill under test: mem.usage
- Tier: T3
- Set: deep, mem-discovery
- Status: active
- Data: synthetic
- Budget: outer_calls <= 14, inner_calls <= 14, tokens <= 64000, wall_ms <= 180000

## Prompt
Show a one-item sample of my records. If there are more, say the sample is partial.

## Items
- [MEM-CT02] blocker · Typed invocation and independent scoped backend truth agree.
  evidence: memory-discovery:deep-mem-browse

- [MEM-RT01] blocker · The final answer retains the original discovery response contract.
  evidence: text:any matches /^Partial sample\.$/


## Notes
- mem-discovery/2, suite 0e71e8ef330ec34e595b86d2d47d0147454390b9d8810faeaa9744669627d3fb. Active finite case contract, not runtime approval.
- Source schemas are PROVISIONAL 548, not a final release or registered catalog observation.
- Direct/search are separate execution conditions with the same intent. Non-pinned schemas require full-schema discovery after a 117-character preview.
