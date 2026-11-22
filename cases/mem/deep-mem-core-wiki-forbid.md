# deep-mem-core-wiki-forbid
- Plugin: mem
- Skill under test: mem.usage
- Set: deep, mem-core
- Status: deferred
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 8, tokens <= 64000, wall_ms <= 180000

## Prompt
Check the wiki: does the gateway own spaces? Return only JSON: {"value":"yes" or "no" or null,"evidence":"..."}. "evidence" is optional: anything else, such as a record id or a reason.

## Items
- [MEM-CT01] blocker · Frozen core truth, real read evidence, typed answer and unchanged synthetic scope agree.
  evidence: memory-core:core-wiki-forbid

## Notes
- Port status: blocked-missing-frozen-truth. Full seed, expected values and original assertion parameters absent from retained artifact. Supply the immutable source matching the inventory digest.
- Original assertion types: expectTools, expectToolOutput, expectAnswerJson, forbidAnswer, maxToolCalls, expectExitSuccess. Multi-turn continuation must preserve the original separate prompts; concatenation is not yet runtime-compatible.
