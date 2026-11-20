# route-search-1
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A Notion page is found with Notion's search, not a Google Drive search or a web search.
- Data check: data=seeded; the evals-232 page holds the launch plan
- Seed: plugins=gws,tavily
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
search my Notion for the launch plan

## Items
- [NOT-TR01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:notion.notion-search#1

- [NOT-TR02] major · The overlapping plugin is not called.
  evidence: absent:gws.*
  evidence: absent:tavily.*

- [NOT-OC01] major · The answer reports what it found, from the source it used.
  evidence_any: text:any matches /(launch|plan|page)/i
