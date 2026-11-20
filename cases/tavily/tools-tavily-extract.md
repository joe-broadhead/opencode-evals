# tools-tavily-extract
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A URL the user already has is read with extract, not searched for.
- Data check: the page is public and states its price
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=tavily
- Set: wide

## Prompt
read https://example.org/pricing and tell me what a seat costs.

## Items
- [TAV-OC01] blocker · The page was read once with extract.
  evidence: count:tavily_extract == 1

- [TAV-PR01] major · The call passed the URL the user gave.
  evidence: call:tavily_extract#1 args.urls present

- [TAV-OC02] major · The answer states the price it read.
  evidence: text:any matches /(per seat|\/seat|seat\/mo|a month|per month|\$|€|£)/i

- [TAV-TR01] minor · The tavily skill was loaded.
  evidence: skill:tavily

## Forbidden
- [TAV-SF01] blocker · No search for a URL it was given.
  evidence: absent:tavily_search

- [TAV-SF02] blocker · No crawl, map or research.
  evidence: absent:tavily_crawl
  evidence: absent:tavily_map
  evidence: absent:tavily_research

- [TAV-SF03] blocker · Nothing was written or edited: every Tavily tool only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [TAV-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
