# tools-get-generation
- Plugin: openrouter
- Skill under test: openrouter-troubleshoot
- Tier: T3
- Source: evals-232/wide/openrouter/get-generation
- Decision tested: one generation is looked up by id, and its cost is reported from the record
- Data check: the id is the user's own generation
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
look up generation gen-01JABCDEF and tell me what it cost and which model served it.

## Items
- [OR-OC01] blocker · The generation was looked up once, first.
  evidence: first:openrouter.get-generation
  evidence: count:openrouter.* == 1

- [OR-OC02] major · The answer gives a cost or a model, or says the id is not found.
  evidence_any: text:any matches /\$|cost|model/i ;; text:any matches /not found|no such|unavailable/i

- [OR-OC03] minor · It does not retry the lookup in a loop.
  evidence: count:openrouter.* <= 1
