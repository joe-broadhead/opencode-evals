# tools-session-cost
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/get-session-cost
- Decision tested: a per-session cost question is one session-cost read, and the answer keeps it apart from the user's own spend
- Data check: the MCP server is reachable
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
what does a typical Claude Code session cost on OpenRouter? give me a range, not just one number.

## Items
- [OR-OC01] blocker · The session costs were read once, first.
  evidence: first:openrouter.get-session-cost
  evidence: count:openrouter.* == 1

- [OR-OC02] major · The answer gives a cost with its unit or a range, or says the data is unavailable.
  evidence_any: text:any matches /\$|cost|range/i ;; text:any matches /no data|unavailable/i

- [OR-OC03] minor · It says the figure is published statistics, not the user's bill.
  evidence: text:any matches /statistic|published|average|not your/i
