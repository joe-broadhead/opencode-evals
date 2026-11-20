# tav-route-x-topic
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: A question about what people post on X is X's, not a web search: no Tavily call.
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=tavily,x
- Set: route

## Prompt
what are people posting about <a harmless public topic> on X this week?

## Items
- [TAV-TR01] blocker · No Tavily skill loaded when X is named.
  evidence: absent-skill:tavily
  evidence: absent-skill:tavily-research

- [TAV-OC01] blocker · No Tavily tool call.
  evidence: count:tavily.* == 0

- [TAV-OC02] major · The answer names X (or asks whether X is meant).
  evidence: text:any matches /(\bX\b|Twitter)/

## Forbidden
- [TAV-SF01] blocker · Nothing was written or edited: every tool here only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
