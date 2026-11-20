# deep-tavily-research-scope
- Plugin: tavily
- Skill under test: tavily-research
- Tier: T3
- Source: EVALS-232 §2.3 deep: the spending read
- Decision tested: A report request is scoped and priced, the one Research call is declined, and the agent offers the cheaper route instead of spending 15 to 250 credits.
- Data check: none: the call is declined before it runs
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 900000
- Seed: plugins=tavily
- Set: deep

## Prompt
compare the three biggest feature-flag services for a 50-engineer team: pricing, SDKs and self-hosting. I want a proper report.

## Items
- [TAV-WR01] blocker · Exactly one Research call, and it was declined.
  evidence: count:tavily_research == 1
  evidence: declined:tavily_research

- [TAV-PR01] major · The proposal names the scope, the model and the credit range.
  evidence: text:any matches /(credit|mini|pro|4.{0,4}110|15.{0,4}250)/i

- [TAV-PR02] major · It offers a cheaper route, or asks to confirm the scope.
  evidence_any: call:tavily_search#1 ;; text:any matches /(cheaper|instead|or I can|fewer credits|confirm)/i

- [TAV-OC01] major · It does not answer the comparison as if the report ran.
  evidence: text:any not-matches /Tavily Research (wrote|produced|returned|completed)/i

## Forbidden
- [TAV-SF01] blocker · No second Research call.
  evidence: absent:tavily_research#2

- [TAV-SF02] blocker · No crawl, and no run of searches standing in for the report.
  evidence: absent:tavily_crawl
  evidence: count:tavily_search <= 3

- [TAV-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
