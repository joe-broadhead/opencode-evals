# route-hiring-vs-not-1
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: overlap routing: a candidate call is Metaview's, a pricing meeting is Granola's
- Decision tested: The hiring call is read from Metaview and the non-hiring meeting from Granola, and the answer keeps them apart
- Data check: one recorded candidate call yesterday, and one non-hiring meeting note yesterday
- Seed: plugins=metaview,granola
- Data: candidate
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: route

## Prompt
summarise yesterday's call with the candidate and the pricing meeting — keep them separate.

## Items
- [MV-RT01] blocker · It read the candidate call with Metaview.
  evidence: call:metaview.search_conversations#1
- [MV-RT02] major · It read the pricing meeting with Granola.
  evidence: call:granola.search_meetings#1
- [MV-OC01] major · The answer keeps the two summaries apart and says which source gave each.
  evidence: text:any matches /Metaview/i
  evidence: text:any matches /Granola/i
- [MV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was written.
  evidence: absent-write:metaview
  evidence: absent:write
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
