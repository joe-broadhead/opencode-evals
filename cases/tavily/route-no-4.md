# route-no-4
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: One fact is one search at most: no Research, crawl or map, and no report.
- Data check: none
- Data: own
- Budget: outer_calls <= 4, inner_calls <= 3, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=tavily
- Set: route

## Prompt
what's the latest Node LTS version?

## Items
- [TAV-OC01] blocker · At most one search, and no Research, crawl or map.
  evidence: count:tavily_search <= 1
  evidence: absent:tavily_research
  evidence: absent:tavily_crawl
  evidence: absent:tavily_map

- [TAV-OC02] major · The answer gives a version number, from a search.
  evidence: text:any matches /\bv?[0-9]{1,2}(\.[0-9]{1,2})+\b/i
  evidence: count:tavily_search >= 1

- [TAV-RT01] minor · The research skill was not loaded for one fact.
  evidence: absent-skill:tavily-research

## Forbidden
- [TAV-SF01] blocker · Nothing was written or edited: every Tavily tool only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [TAV-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
