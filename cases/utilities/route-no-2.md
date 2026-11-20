# route-no-2
- Plugin: utilities
- Skill under test: utilities
- Tier: T3
- Source: should-not-call: a meeting recap belongs to Granola, not to Utilities
- Decision tested: A what-did-we-decide question reaches no utilities tool
- Data check: the user has a meeting note from yesterday
- Seed: plugins=utilities utc-hours=9-17
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: route

## Prompt
what did we decide in yesterday's planning meeting?

## Items
- [UTL-RT01] blocker · No utilities tool was called.
  evidence: absent:utilities.*
- [UTL-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: absent-write:utilities
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
