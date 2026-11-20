# tools-ping
- Plugin: openrouter
- Skill under test: openrouter-troubleshoot
- Tier: T3
- Source: evals-232/wide/openrouter/ping
- Decision tested: an "is it up" question is one ping, and the answer reports what it saw
- Data check: the MCP server is reachable
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
is OpenRouter reachable from here right now?

## Items
- [OR-OC01] blocker · The ping ran exactly once.
  evidence: first:openrouter.ping
  evidence: count:openrouter.* == 1

- [OR-OC02] major · The answer reports reachable or not, from the result.
  evidence_any: text:any matches /reachable|respond|up\b|ok\b|pong/i ;; text:any matches /not reachable|failed|error|timeout/i

- [OR-OC03] minor · It does not read credit or list models to answer a reachability question.
  evidence: count:openrouter.* <= 1
