# tools-affinity-meeting-prep
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: affinity_meeting_prep (Affinity's meeting prep text)
- Decision tested: A prep-me-for-the-meeting request calls the meeting prep playbook once, then reads the record
- Data check: {{target:affinity.company}} exists with notes and people
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
prep me for my meeting with {{target:affinity.company}} tomorrow.

## Items
- [AFF-TR01] blocker · It used affinity_meeting_prep once.
  evidence: call:affinity.affinity_meeting_prep#1
- [AFF-OC01] major · The answer gives a brief grounded in the CRM: who, what was said, what to ask.
  evidence: text:any matches /(meeting|brief|note|ask|company)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
