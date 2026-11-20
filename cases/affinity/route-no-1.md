# route-no-1
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: should-not-call: a calendar question belongs to the calendar, not the CRM
- Decision tested: A what-is-on-my-calendar question reaches no Affinity tool
- Data check: the user's calendar holds at least one event tomorrow
- Seed: plugins=affinity,gws utc-hours=9-17
- Data: real
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
what's on my calendar tomorrow?

## Items
- [AFF-RT01] blocker · No Affinity tool was called.
  evidence: absent:affinity.*
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

- [AFF-OC02] major · It read the calendar with the Google Workspace tools.
  evidence: call:gws.read#1 args.operation matches /^calendar\./

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
