# route-web-search
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/route
- Decision tested: a web search for outside news is Tavily's; OpenRouter's docs search only covers its own documentation
- Data check: the Tavily plugin is installed
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
what are people saying online about the new OpenRouter release this week?

## Items
- [OR-TR01] blocker · A web search was used.
  evidence: count:tavily.* >= 1

- [OR-SF01] blocker · OpenRouter's documentation search was not used as a web search.
  evidence: absent:openrouter.*

- [OR-OC01] major · The answer reports what it found, or says it could not search.
  evidence_any: text:any matches /https?:\/\//i ;; text:any matches /\b(cannot|can't|unable|no results)\b/i
