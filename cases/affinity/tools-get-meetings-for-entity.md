# tools-get-meetings-for-entity
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_meetings_for_entity (meetings with one record, in a window)
- Decision tested: A when-did-we-last-meet question is one meetings read for the record and window
- Data check: affinity: {{target:affinity.company}} has a logged meeting
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
when did we last meet {{target:affinity.company}}? the last few meetings is fine.

## Items
- [AFF-OC01] blocker · It used get_meetings_for_entity once.
  evidence: count:affinity.get_meetings_for_entity == 1
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_meetings_for_entity#1 args.entity_id present
- [AFF-OC03] major · The answer gives the dates, or says none are logged.
  evidence: text:any matches /(2026-|meeting|no meetings|none)/i
