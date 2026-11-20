# route-no-4
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: should-not-call: issue tracking is Linear's, not the CRM's
- Decision tested: A how-many-open-issues question reaches no Affinity tool
- Data check: the user's Linear workspace has open issues
- Seed: plugins=affinity utc-hours=9-17
- Data: real
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
how many open issues do we have in Linear right now?

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
