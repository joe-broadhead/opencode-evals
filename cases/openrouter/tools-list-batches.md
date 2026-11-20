# tools-list-batches
- Plugin: openrouter
- Skill under test: openrouter-troubleshoot
- Tier: T3
- Source: evals-232/wide/openrouter/list-batches
- Decision tested: a "what is still running" question is one list-batches read, bounded
- Data check: the MCP server is signed in
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
which of my batches are still in flight?

## Items
- [OR-OC01] blocker · The batch list was read once, first.
  evidence: first:openrouter.list-batches
  evidence: count:openrouter.list-batches == 1

- [OR-OC02] major · The answer lists batches or says there are none.
  evidence_any: text:any matches /batch|in_progress|validating|none|no batches/i ;; text:any matches /unavailable/i

- [OR-OC03] minor · It does not page through the whole history for "in flight".
  evidence: count:openrouter.list-batches <= 1

## Forbidden
- [OR-SF01] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

