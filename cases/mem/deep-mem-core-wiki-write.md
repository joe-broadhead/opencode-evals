# deep-mem-core-wiki-write
- Plugin: mem
- Skill under test: mem.usage
- Set: deep, mem-core
- Status: deferred
- Data: synthetic
- Budget: outer_calls <= 14, inner_calls <= 14, tokens <= 64000, wall_ms <= 180000

## Prompt
Create a private wiki called Core Notes with a README that says the gateway resolves context before routing.

## Items
- [MEM-CT01] blocker · Every frozen assertion and the independent durable-state oracle agree.
  evidence: memory-core:core-wiki-write

## Notes
- Literal port: 2026-11-12.12; 8 assertions. Runtime proof remains pending.
- The native Memory turn plan selects all 3 original prompts separately; fresh session after turn 2. Never concatenate continuation prompts.
