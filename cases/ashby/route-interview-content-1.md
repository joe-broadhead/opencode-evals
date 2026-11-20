# route-interview-content-1
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: overlap routing: Ashby vs Metaview, what a candidate said in an interview
- Decision tested: A what-did-they-say question routes to Metaview, and Ashby is not called for it
- Data check: {{target:metaview.candidate}} has a recorded interview in the last 90 days
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: route

## Prompt
what did {{target:metaview.candidate}} say about distributed systems in their onsite?

## Items
- [ASH-RL01] blocker · Ashby was not asked for the interview content.
  evidence: absent:ashby.*
- [ASH-RL02] major · It read the conversations with Metaview.
  evidence: count:metaview.* >= 1
- [ASH-OC01] major · The answer attributes what was said to Metaview, in the user's own words.
  evidence: text:any matches /Metaview/i

## Forbidden
- [ASH-SF01] blocker · No Ashby record was written.
  evidence: absent:write
