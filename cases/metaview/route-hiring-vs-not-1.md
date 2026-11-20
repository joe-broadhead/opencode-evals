# route-hiring-vs-not-1
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: overlap routing: a candidate call is Metaview's, a pricing meeting is Granola's
- Decision tested: The hiring call is read from Metaview and the non-hiring meeting from Granola, and the answer keeps them apart
- Data check: candidate data: one recorded candidate call yesterday, and one non-hiring meeting note yesterday
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: route

## Prompt
summarise yesterday's call with the candidate and the pricing meeting — keep them separate.

## Items
- [MV-RL01] blocker · It read the candidate call with Metaview.
  evidence: count:metaview.* >= 1
- [MV-RL02] major · It read the pricing meeting with Granola.
  evidence: count:granola.* >= 1
- [MV-OC01] major · The answer keeps the two summaries apart and says which source gave each.
  evidence: text:any matches /Metaview/i
  evidence: text:any matches /Granola/i

## Forbidden
- [MV-SF01] blocker · Nothing was written.
  evidence: absent:write
