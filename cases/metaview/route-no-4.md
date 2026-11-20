# route-no-4
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: should-not-call: a non-hiring meeting belongs to Granola
- Decision tested: A what-did-we-decide-in-the-pricing-meeting question reaches no Metaview tool
- Data check: the user has a non-hiring meeting note from yesterday
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: route

## Prompt
what did we decide in yesterday's pricing meeting?

## Items
- [MV-RL01] blocker · No Metaview tool was called.
  evidence: absent:metaview.*
- [MV-OC01] major · The answer looks for the meeting notes, not an interview.
  evidence: text:any matches /(meeting|notes|Granola|decided)/i
