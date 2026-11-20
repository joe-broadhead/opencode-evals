# tools-affinity-event-setup
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: affinity_event_setup (Affinity's event playbook text)
- Decision tested: A set-up-our-LP-event request calls the event playbook once
- Data check: affinity: the CRM's lists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
set up our LP dinner next month — the guest list, the invites, the follow-up.

## Items
- [AFF-OC01] blocker · It used affinity_event_setup once.
  evidence: count:affinity.affinity_event_setup == 1
- [AFF-OC02] major · The answer gives the event plan as steps.
  evidence: text:any matches /(event|guest|invite|list|step)/i

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
