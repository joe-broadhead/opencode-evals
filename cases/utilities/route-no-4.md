# route-no-4
- Plugin: utilities
- Skill under test: utilities
- Tier: T3
- Source: should-not-call: an astronomical date is not in the offline calendar
- Decision tested: A next-full-moon question reaches no utilities tool
- Data check: none
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: route

## Prompt
when's the next full moon?

## Items
- [UTL-RT01] blocker · No utilities tool was called.
  evidence: absent:utilities.*
- [UTL-OC01] major · The answer says it has no moon data rather than inventing a date.
  evidence: text:any matches /\b(no|not|can't|cannot|don't)\b.{0,50}\b(moon|data|astronom\w*)\b/i
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF03] blocker · It did not invent a date.
  evidence: text:any not-matches /\b[0-9]{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)\b/i
- [UTL-SF01] blocker · Nothing committed.
  evidence: absent-write:utilities
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
