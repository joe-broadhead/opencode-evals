# deep-mem-core-durability
- Plugin: mem
- Skill under test: mem.usage
- Set: deep, mem-core
- Status: deferred
- Data: synthetic
- Budget: outer_calls <= 14, inner_calls <= 14, tokens <= 64000, wall_ms <= 180000

## Prompt
Record a durable decision: keep the control plane on PostgreSQL for PITR. Do not store tracker status.

## Items
- [MEM-CT01] blocker · Every frozen assertion and the independent durable-state oracle agree.
  evidence: memory-core:core-durability

## Notes
- Literal port: 2026-11-12.12; 6 assertions. Runtime proof remains pending.
- The native Memory turn plan selects all 2 original prompts separately; fresh session after turn 1. Never concatenate continuation prompts.
