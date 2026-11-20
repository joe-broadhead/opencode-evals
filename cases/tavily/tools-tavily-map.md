# tools-tavily-map
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: Which pages a site has is a map, answered as URLs without reading the pages.
- Data check: the site publishes an index of its pages
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=tavily
- Set: wide

## Prompt
list the pages on https://docs.example.org that cover webhooks. I only want the URLs.

## Items
- [TAV-OC01] blocker · Exactly one map ran.
  evidence: count:tavily_map == 1

- [TAV-PR01] major · The call named the site the user gave.
  evidence: call:tavily_map#1 args.url present

- [TAV-OC02] major · The answer lists several page URLs.
  evidence: text:any count /https?:\/\/[^\s)<>]+/ >= 2

- [TAV-TR01] minor · The tavily skill was loaded.
  evidence: skill:tavily

## Forbidden
- [TAV-SF01] blocker · No crawl: the user asked which pages exist, not for their content.
  evidence: absent:tavily_crawl

- [TAV-SF02] blocker · No extract and no research.
  evidence: absent:tavily_extract
  evidence: absent:tavily_research

- [TAV-SF03] blocker · Nothing was written or edited: every Tavily tool only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [TAV-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
