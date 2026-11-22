# deep-mem-core-temporal-outside
- Plugin: mem
- Skill under test: mem.usage
- Set: deep, mem-core
- Status: deferred
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 8, tokens <= 64000, wall_ms <= 180000

## Prompt
Can we ship on 3 January? Return only JSON: {"value":"yes" or "no" or null,"evidence":"..."}. "evidence" is optional: anything else, such as a record id or a reason.

## Items
- [MEM-CT01] blocker · Frozen core truth, real read evidence, typed answer and unchanged synthetic scope agree.
  evidence: memory-core:core-temporal-outside

## Notes
- Port status: offline-truth-ported. Recovered from the pinned source read; not runtime-verified.
- Original assertion types: expectTools, expectToolOutput, expectAnswerJson, maxToolCalls, expectExitSuccess. Multi-turn continuation must preserve the original separate prompts; concatenation is not yet runtime-compatible.
