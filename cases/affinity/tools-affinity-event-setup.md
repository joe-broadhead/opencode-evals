# tools-affinity-event-setup
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: affinity_event_setup (Affinity's event playbook text)
- Decision tested: A set-up-our-LP-event request calls the event playbook once
- Data check: the CRM's lists
- Seed: plugins=affinity utc-hours=9-17
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
set up our LP dinner next month — the guest list, the invites, the follow-up.

## Items
- [AFF-TR01] blocker · It used affinity_event_setup once.
  evidence: call:affinity.affinity_event_setup#1
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
