# tools-task-classifications
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/list-task-classifications
- Decision tested: a "what is OpenRouter used for" question is one task-classifications read
- Data check: the MCP server is reachable
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
what kinds of tasks do people use OpenRouter for most?

## Items
- [OR-OC01] blocker · The classifications were read once, first.
  evidence: first:openrouter.list-task-classifications
  evidence: count:openrouter.* == 1

- [OR-OC02] major · The answer names task categories, or says the data is unavailable.
  evidence_any: text:any matches /programming|coding|roleplay|translation|science|category|task/i ;; text:any matches /no data|unavailable/i

- [OR-OC03] minor · It says the window is the trailing week.
  evidence: text:any matches /7 days|week|trailing/i
