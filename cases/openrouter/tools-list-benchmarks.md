# tools-list-benchmarks
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/list-benchmarks
- Decision tested: a quality question is one benchmarks read, with the score kept apart from popularity
- Data check: the MCP server is reachable
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
how does claude-sonnet-5-5 score on GPQA, and is that better than the other Claude models?

## Items
- [OR-OC01] blocker · The benchmarks were read once, first.
  evidence: first:openrouter.list-benchmarks
  evidence: count:openrouter.* == 1

- [OR-OC02] major · The answer gives a benchmark score or says the benchmark is not published.
  evidence_any: text:any matches /gpqa|score|%/i ;; text:any matches /not (published|available)|no (score|data)/i

- [OR-OC03] minor · It distinguishes a benchmark result from usage popularity.
  evidence: text:any matches /benchmark|score|not (the same as )?(usage|popularity)/i
