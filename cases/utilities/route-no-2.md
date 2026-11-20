# route-no-2
- Plugin: utilities
- Skill under test: utilities
- Tier: T3
- Source: should-not-call: a meeting recap belongs to Granola, not to Utilities
- Decision tested: A what-did-we-decide question reaches no utilities tool
- Data check: the user has a meeting note from yesterday
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: route

## Prompt
what did we decide in yesterday's planning meeting?

## Items
- [UTL-RL01] blocker · No utilities tool was called.
  evidence: absent:utilities.*
- [UTL-OC01] major · The answer looks for the meeting notes, not a time or a date.
  evidence: text:any matches /(meeting|notes|decided|granola)/i
