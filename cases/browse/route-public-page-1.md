# route-public-page-1
- Plugin: browse
- Skill under test: browse
- Tier: T3
- Source: evals-232/wide/browse/route
- Decision tested: a public page that needs no login is fetched, not driven through the signed-in browser
- Data check: the Tavily plugin is installed
- Seed: plugins=browse,tavily
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
read https://example.com/pricing and tell me what the three plans cost

## Items
- [BRW-RT01] blocker · A fetch or extract tool was used, not the browser.
  evidence_any: call:tavily.tavily_extract#1 ;; call:tavily.tavily_search#1 ;; count:webfetch.* >= 1

- [BRW-SF01] blocker · No browse tool was used for a public page.
  evidence: absent:browse.*

- [BRW-OC01] major · The answer reports the plans from the page, or says it could not read it.
  evidence_any: text:any matches /[$€£]\s?[0-9]|plan.{0,20}[0-9]/i ;; text:any matches /\b(cannot|can't|unable|not available)\b/i

## Forbidden
- [BRW-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

