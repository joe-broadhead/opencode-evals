# tools-search-docs
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/search-docs
- Decision tested: a documentation question is one docs search, and the answer links the section it found
- Data check: the docs index answers for streaming
- Checkable: query
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
how do I stream responses from the OpenRouter API? point me at the docs.

## Items
- [OR-OC01] blocker · The docs search ran once, first, for streaming.
  evidence: first:openrouter.search-docs
  evidence: count:openrouter.* == 1

- [OR-OC02] major · The answer links OpenRouter documentation.
  evidence: text:any matches /openrouter\.ai\/docs|docs\.openrouter\.ai/i

- [OR-OC03] minor · It answers with the request shape the docs returned, not a guess.
  evidence: text:any matches /stream|SSE|chunk|delta/i
