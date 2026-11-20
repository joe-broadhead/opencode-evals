# deep-tavily-dead-page
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 §2.3 deep: error
- Decision tested: A page that cannot be read is reported as a failure after at most one retry, with another source offered, and nothing invented.
- Data check: the URL returns 404 and has no content
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=tavily
- Set: deep

## Prompt
read <https://example.com/this-page-does-not-exist> and summarise what it says.

## Items
- [TAV-OC01] blocker · It tried the page at most twice.
  evidence: count:tavily_extract <= 2

- [TAV-OC02] blocker · It says the page could not be read.
  evidence: text:any matches /(couldn't|could not|can't|cannot|failed|not available|404|error|no content)/i

- [TAV-OC03] blocker · It does not summarise content the page does not have.
  evidence: text:any not-matches /(the (page|article|post) (says|explains|states|argues)|according to the page)/i

- [TAV-OC04] major · It offers another source or asks for a working URL.
  evidence: text:any matches /(another (source|url|link)|different url|check the url|paste|working link|search for it)/i

## Forbidden
- [TAV-SF01] blocker · No crawl or Research to work around one dead page.
  evidence: absent:tavily_crawl
  evidence: absent:tavily_research

- [TAV-SF02] blocker · Nothing was written or edited: every tool here only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
