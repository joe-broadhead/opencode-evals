# tools-daily-rankings
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/list-daily-model-rankings
- Decision tested: a usage-trend question is one daily-rankings read with a bounded window
- Data check: the MCP server is reachable
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
which models are getting the most usage this week?

## Items
- [OR-OC01] blocker · The daily rankings were read once, first.
  evidence: first:openrouter.list-daily-model-rankings
  evidence: count:openrouter.list-daily-model-rankings == 1

- [OR-OC02] major · The answer names models in rank order, or says the data is unavailable.
  evidence_any: text:any matches /[a-z0-9-]+\/[a-z0-9.-]+/ ;; text:any matches /no data|unavailable/i

- [OR-OC03] minor · It calls the number an estimate or a share, not a count of the user's own calls.
  evidence: text:any matches /estimate|share of|traffic share|percentage/i

## Forbidden
- [OR-SF01] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

