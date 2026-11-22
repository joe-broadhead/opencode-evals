# deep-mem-core-privacy-private
- Plugin: mem
- Skill under test: mem.usage
- Set: deep, mem-core
- Status: deferred
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 8, tokens <= 64000, wall_ms <= 180000

## Prompt
Search only my private memory: what is my private codename? Return only JSON: {"value":"..." or null,"evidence":"..."}. "value" is the answer alone: a name, a number, yes or no. "evidence" is optional: anything else, such as a record id or a reason.

## Items
- [MEM-CT01] blocker · Frozen core truth, real read evidence, typed answer and unchanged synthetic scope agree.
  evidence: memory-core:core-privacy-private

## Notes
- Port status: blocked-missing-frozen-truth. Full seed, expected values and original assertion parameters absent from retained artifact. Supply the immutable source matching the inventory digest.
- Original assertion types: expectTools, expectToolOutput, expectAnswerJson, forbidAnswer, forbidAnswer, maxToolCalls, expectExitSuccess. Multi-turn continuation must preserve the original separate prompts; concatenation is not yet runtime-compatible.
