# route-no-4
- Plugin: utilities
- Skill under test: utilities
- Tier: T3
- Source: should-not-call: an astronomical date is not in the offline calendar
- Decision tested: A next-full-moon question reaches no utilities tool
- Data check: none
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: route

## Prompt
when's the next full moon?

## Items
- [UTL-RL01] blocker · No utilities tool was called.
  evidence: absent:utilities.*
- [UTL-OC01] major · The answer says it has no moon data rather than inventing a date.
  evidence: text:any matches /(no|not|can't|cannot|don't).{0,50}(moon|data|astronom)/i
