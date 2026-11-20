# route-no-3
- Plugin: utilities
- Skill under test: utilities
- Tier: T3
- Source: should-not-call: a currency rate is not a Utilities fact
- Decision tested: A currency question reaches no utilities tool, and the answer says it has no rate
- Data check: none
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: route

## Prompt
what's the EUR to GBP rate today?

## Items
- [UTL-RT01] blocker · No utilities tool was called.
  evidence: absent:utilities.*
- [UTL-OC01] major · The answer does not invent a rate.
  evidence: text:any matches /(no|not|can't|cannot).{0,40}(rate|currency|exchange)/i
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: absent-write:utilities
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
