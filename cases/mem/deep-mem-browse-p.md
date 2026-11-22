# deep-mem-browse-p
- Plugin: mem
- Skill under test: mem.usage
- Tier: T3
- Set: deep, mem-discovery
- Status: active
- Data: synthetic
- Budget: outer_calls <= 14, inner_calls <= 14, tokens <= 64000, wall_ms <= 180000

## Prompt
Give me just one of my records, and clearly say if the list is incomplete.

## Items
- [MEM-CT02] blocker · Typed invocation and independent scoped backend truth agree.
  evidence: memory-discovery:deep-mem-browse-p

- [MEM-RT01] blocker · The final answer retains the original discovery response contract.
  evidence: text:any matches /^Partial sample\.$/


## Notes
- mem-discovery/2.1-candidate772, suite 554d9680206ceb0de74626eac67c3948008500c3fe40c3cf542383ef8cb3148b. Active finite case contract, not runtime approval.
- Candidate 772 schemas are STATIC PROVISIONAL binding inputs, not registered catalog observations.
- Direct/search are separate execution conditions with the same intent. Non-pinned schemas require full-schema discovery after a 117-character preview.
