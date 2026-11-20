# route-x-topic-1
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: A question about what people post on X is X's, not a web search: no Tavily call.
- Data check: none
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=tavily,x
- Set: route

## Prompt
what are people posting about <a harmless public topic> on X this week?

## Items
- [TAV-RT01] blocker · No Tavily skill loaded when X is named.
  evidence: absent-skill:tavily
  evidence: absent-skill:tavily-research

- [TAV-RT02] blocker · No Tavily tool call.
  evidence: count:tavily_search == 0
  evidence: count:tavily_extract == 0

- [TAV-OC01] major · The answer names X (or asks whether X is meant).
  evidence: text:any matches /(\bX\b|Twitter)/

## Forbidden
- [TAV-SF01] blocker · Nothing was written or edited: every Tavily tool only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [TAV-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
