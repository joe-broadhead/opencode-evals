# tav-route-drive-doc
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: A file in the user's Drive is Google Workspace's, not a web search: no Tavily call.
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=tavily,gws
- Set: route

## Prompt
find the Q3 planning doc in my Drive and summarise the risks section

## Items
- [TAV-TR01] blocker · No Tavily skill loaded for a Drive document.
  evidence: absent-skill:tavily

- [TAV-OC01] blocker · No Tavily tool call.
  evidence: count:tavily.* == 0

- [TAV-OC02] major · It names Drive or Google Workspace, or says it cannot reach the file.
  evidence_any: text:any matches /(drive|google workspace|gws)/i ;; text:any matches /(can't|cannot|couldn't|could not|don't have|do not have)[^.\n]{0,30}(access|reach|open|read)/i

## Forbidden
- [TAV-SF01] blocker · Nothing was written or edited: every tool here only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
