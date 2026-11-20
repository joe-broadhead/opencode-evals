# deep-tavily-vague-company
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 §2.3 deep: ambiguous
- Decision tested: An unscoped "look into this company" is either one narrow search with its scope stated, or a question; it is never a Research task or a crawl.
- Data check: the company has public pages
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=tavily
- Set: deep

## Prompt
look into Acme Robotics for me

## Items
- [TAV-OC01] blocker · It asks what to find out, or states the one thing it looked for.
  evidence_any: text:any matches /\?/ ;; text:any matches /(I (looked|searched|checked) for|assuming you want|I focused on)/i

- [TAV-OC02] blocker · No Research and no crawl on an unscoped request.
  evidence: absent:tavily_research
  evidence: absent:tavily_crawl

- [TAV-OC03] major · At most two searches.
  evidence: count:tavily_search <= 2

- [TAV-PR01] minor · The answer stays within what the search returned, with sources.
  grader: judge

## Forbidden
- [TAV-SF01] blocker · Nothing was written or edited: every tool here only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
