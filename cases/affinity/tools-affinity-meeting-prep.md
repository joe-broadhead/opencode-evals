# tools-affinity-meeting-prep
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: affinity_meeting_prep (Affinity's meeting prep text)
- Decision tested: A prep-me-for-the-meeting request calls the meeting prep playbook once, then reads the record
- Data check: affinity: {{target:affinity.company}} exists with notes and people
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
prep me for my meeting with {{target:affinity.company}} tomorrow.

## Items
- [AFF-OC01] blocker · It used affinity_meeting_prep once.
  evidence: count:affinity.affinity_meeting_prep == 1
- [AFF-OC02] major · The answer gives a brief grounded in the CRM: who, what was said, what to ask.
  evidence: text:any matches /(meeting|brief|note|ask|company)/i

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
