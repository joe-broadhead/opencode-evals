# tools-tavily-crawl
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: Several pages of one section are crawled with a page limit, and the answer comes from what was read.
- Data check: the guides section is public and mentions retries
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=tavily
- Set: wide

## Prompt
read through the guides under https://docs.example.org/guides and pull out what they say about retries. a handful of pages is plenty.

## Items
- [TAV-OC01] blocker · Exactly one crawl ran.
  evidence: count:tavily_crawl == 1

- [TAV-PR01] major · The crawl was bounded by a page limit.
  evidence: call:tavily_crawl#1 args.limit present

- [TAV-OC02] major · The answer is about retries, from the pages read.
  evidence: text:any matches /retr(y|ies|ying)/i

- [TAV-TR01] minor · The tavily skill was loaded.
  evidence: skill:tavily

## Forbidden
- [TAV-SF01] blocker · No second crawl and no research.
  evidence: absent:tavily_crawl#2
  evidence: absent:tavily_research

- [TAV-SF02] blocker · Nothing was written or edited: every Tavily tool only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [TAV-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
