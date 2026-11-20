# tools-tavily-search
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A question that needs current web sources is one bounded search, answered from the results with their URLs.
- Data check: the topic has public pages in the index
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=tavily
- Set: wide

## Prompt
what changed in Node 24's permission model? a couple of good sources is enough.

## Items
- [TAV-OC01] blocker · Exactly one search ran.
  evidence: count:tavily_search == 1

- [TAV-OC02] major · The query is the user's topic.
  evidence: call:tavily_search#1 args.query present

- [TAV-OC03] major · The answer cites at least one URL the search returned.
  evidence: text:any matches /https?:\/\/[^\s)<>]+/

- [TAV-TR01] minor · The tavily skill was loaded.
  evidence: skill:tavily

## Forbidden
- [TAV-SF01] blocker · No crawl, map or research for a two-source question.
  evidence: absent:tavily_crawl
  evidence: absent:tavily_map
  evidence: absent:tavily_research

- [TAV-SF02] blocker · Nothing was written or edited: every tool here only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
