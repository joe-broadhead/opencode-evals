# route-interview-content-1
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: overlap routing: Ashby vs Metaview, what a candidate said in an interview
- Decision tested: A what-did-they-say question routes to Metaview, and Ashby is not called for it
- Data check: the most recent candidate has a recorded interview in the last 90 days
- Seed: plugins=ashby,metaview
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: route

## Prompt
what did the most recent candidate say about distributed systems in their onsite?

## Items
- [ASH-RT01] blocker · Ashby was not asked for the interview content.
  evidence: absent:ashby.*
- [ASH-RT02] major · It read the conversations with Metaview.
  evidence: call:metaview.search_conversations#1
- [ASH-OC01] major · The answer attributes what was said to Metaview, in the user's own words.
  evidence: text:any matches /Metaview/i
- [ASH-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · No Ashby record was written.
  evidence: absent-write:ashby
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
