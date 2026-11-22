# deep-mem-core-constraint-allow-read
- Plugin: mem
- Skill under test: mem.usage
- Set: deep, mem-core
- Status: deferred
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 8, tokens <= 64000, wall_ms <= 180000

## Prompt
Can a viewer read a wiki page? Return only JSON: {"decision":"ALLOW" or "DENY","because":"one sentence"}.

## Items
- [MEM-CT01] blocker · Frozen core truth, real read evidence, typed answer and unchanged synthetic scope agree.
  evidence: memory-core:core-constraint-allow-read

## Notes
- Port status: blocked-missing-frozen-truth. Full seed, expected values and original assertion parameters absent from retained artifact. Supply the immutable source matching the inventory digest.
- Original assertion types: expectTools, expectToolOutput, expectDecisionJson, maxToolCalls, expectExitSuccess. Multi-turn continuation must preserve the original separate prompts; concatenation is not yet runtime-compatible.
