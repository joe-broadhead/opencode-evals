# route-drive-doc-1
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: A file in the user's Drive is Google Workspace's, not a web search: no Tavily call.
- Data check: none
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=tavily,gws
- Set: route

## Prompt
find the Q3 planning doc in my Drive and summarise the risks section

## Items
- [TAV-RT01] blocker · No Tavily skill loaded for a Drive document.
  evidence: absent-skill:tavily

- [TAV-RT02] blocker · No Tavily tool call.
  evidence: absent:tavily.*

- [TAV-RT03] major · It read Drive, or says it cannot reach the file.
  evidence_any: count:gws.* >= 1 ;; text:any matches /(can't|cannot|couldn't|could not|don't have|do not have)[^.\n]{0,30}(access|reach|open|read)/i

## Forbidden
- [TAV-SF01] blocker · Nothing was written or edited: every Tavily tool only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [TAV-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
