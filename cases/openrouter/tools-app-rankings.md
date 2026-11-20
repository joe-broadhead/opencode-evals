# tools-app-rankings
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/list-app-rankings
- Decision tested: an ecosystem question is one app-rankings read, and the answer names apps rather than models
- Data check: the MCP server is reachable
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
which coding apps use OpenRouter the most right now?

## Items
- [OR-OC01] blocker · The app rankings were read once, first.
  evidence: first:openrouter.list-app-rankings
  evidence: count:openrouter.list-app-rankings == 1

- [OR-OC02] major · The answer names apps, or says the data is unavailable.
  evidence_any: text:any matches /app|rank|usage/i ;; text:any matches /no data|unavailable/i

- [OR-OC03] minor · It does not present the app ranking as a model quality ranking.
  evidence: text:any not-matches /(best|highest quality) (model|coding)/i

## Forbidden
- [OR-SF01] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

