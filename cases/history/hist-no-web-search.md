# hist-no-web-search
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: The open web is Tavily's: a web question never becomes a history search.
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=history,tavily
- Set: route

## Prompt
what's the latest stable release of Bun?

## Items
- [H-TR01] blocker · No history skill loaded for a web question.
  evidence: absent-skill:history-recall

- [H-OC01] blocker · No history tool call.
  evidence: count:history.* == 0

- [H-OC02] major · It answers with a version, or says it would search the web.
  evidence: text:any matches /([0-9]+\.[0-9]+(\.[0-9]+)?|search the web|tavily|web search)/i

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
