# route-no-3
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: The open web is Tavily's: a web question never becomes a history search.
- Data check: none
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=history,tavily
- Set: route

## Prompt
what's the latest stable release of Bun?

## Items
- [H-RT01] blocker · No history skill loaded for a web question.
  evidence: absent-skill:history-recall

- [H-RT02] blocker · No history tool call.
  evidence: count:history.search == 0
  evidence: count:history.recall == 0

- [H-OC01] major · It answers with a version, or says it would search the web.
  evidence: text:any matches /([0-9]+\.[0-9]+(\.[0-9]+)?|search the web|tavily|web search)/i

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
