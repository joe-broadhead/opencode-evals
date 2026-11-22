# deep-mem-core-constraint-freeze
- Plugin: mem
- Skill under test: mem.usage
- Set: deep, mem-core
- Status: deferred
- Data: synthetic
- Budget: outer_calls <= 14, inner_calls <= 14, tokens <= 64000, wall_ms <= 180000

## Prompt
Can I deploy a hotfix on 24 December? Return only JSON: {"decision":"ALLOW" or "DENY","because":"one sentence"}.

## Items
- [MEM-CT01] blocker · Every frozen assertion and the independent durable-state oracle agree.
  evidence: memory-core:core-constraint-freeze

## Notes
- Literal port: 2026-11-12.12; 5 assertions. Runtime proof remains pending.
- The native Memory turn plan selects all 1 original prompts separately; fresh session after turn none. Never concatenate continuation prompts.
