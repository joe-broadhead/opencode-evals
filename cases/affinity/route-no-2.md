# route-no-2
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: should-not-call: a non-hiring meeting recap belongs to Granola, not the CRM
- Decision tested: A what-did-we-decide-in-the-planning-meeting question reaches no Affinity tool
- Data check: the user has a planning meeting note from yesterday
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
what did we decide in yesterday's planning meeting?

## Items
- [AFF-RT01] blocker · No Affinity tool was called.
  evidence: absent:affinity.*
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
