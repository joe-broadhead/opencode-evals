# tools-tavily-crawl
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: Several pages of one section are crawled with a page limit, and the answer comes from what was read.
- Data check: the guides section is public and mentions retries
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=tavily
- Set: wide

## Prompt
read through the guides under https://docs.example.org/guides and pull out what they say about retries. a handful of pages is plenty.

## Items
- [TAV-WR01] blocker · Exactly one crawl was proposed, and it was declined.
  evidence: count:tavily_crawl == 1
  evidence: declined:tavily_crawl

- [TAV-PR01] major · The crawl was bounded by a page limit.
  evidence: call:tavily_crawl#1 args.limit present

- [TAV-OC01] major · The answer says the crawl did not run, and offers the cheaper route.
  evidence_any: text:any matches /(not run|wasn't run|was not run|not started|declined)/i ;; text:any matches /(search|tavily_search|instead|fewer credits)/i

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
