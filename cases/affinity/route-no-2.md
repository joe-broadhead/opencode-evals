# route-no-2
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: should-not-call: a non-hiring meeting recap belongs to Granola, not the CRM
- Decision tested: A what-did-we-decide-in-the-planning-meeting question reaches no Affinity tool
- Data check: the user has a planning meeting note from yesterday
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
what did we decide in yesterday's planning meeting?

## Items
- [AFF-RL01] blocker · No Affinity tool was called.
  evidence: absent:affinity.*
- [AFF-OC01] major · The answer looks for the meeting notes, not a CRM record.
  evidence: text:any matches /(meeting|notes|Granola|decided)/i
