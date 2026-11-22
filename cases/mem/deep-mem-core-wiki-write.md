# deep-mem-core-wiki-write
- Plugin: mem
- Skill under test: mem.usage
- Set: deep, mem-core
- Status: deferred
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 8, tokens <= 64000, wall_ms <= 180000

## Prompt
Create a private wiki called Core Notes with a README that says the gateway resolves context before routing.

Then: Append this decision to the same wiki: the control plane uses PostgreSQL for PITR.

Then: Read the README and state the database decision. Return only JSON: {"value":"..." or null,"evidence":"..."}. "value" is the answer alone: a name, a number, yes or no. "evidence" is optional: anything else, such as a record id or a reason.

## Items
- [MEM-CT01] blocker · Frozen core truth, real read evidence, typed answer and unchanged synthetic scope agree.
  evidence: memory-core:core-wiki-write

## Notes
- Port status: blocked-missing-frozen-truth. Full seed, expected values and original assertion parameters absent from retained artifact. Supply the immutable source matching the inventory digest.
- Original assertion types: expectTools, expectTools, expectTools, expectToolArgs, expectAnswerJson, expectState, maxToolCalls, expectExitSuccess. Multi-turn continuation must preserve the original separate prompts; concatenation is not yet runtime-compatible.
