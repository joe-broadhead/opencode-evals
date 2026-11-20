# tools-affinity-meeting-prep
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: affinity_meeting_prep (Affinity's meeting prep text)
- Decision tested: A prep-me-for-the-meeting request calls the meeting prep playbook once, then reads the record
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity utc-hours=9-17
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
prep me for my meeting with a portfolio company we track tomorrow.

## Items
- [AFF-TR01] blocker · It used affinity_meeting_prep once.
  evidence: call:affinity.affinity_meeting_prep#1
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
- [AFF-OC09] major · The answer is a prep from the playbook's steps and the record, not a restatement of the question.
  grader: judge
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
