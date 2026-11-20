# tools-affinity-reference-check
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: affinity_reference_check (Affinity's reference check text)
- Decision tested: A run-a-reference-check request calls the reference playbook once
- Data check: the founder of {{target:affinity.company}} has a shared history with the firm
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
run a backchannel reference check on the founder of {{target:affinity.company}} — who can tell us what they're like to work with?

## Items
- [AFF-TR01] blocker · It used affinity_reference_check once.
  evidence: call:affinity.affinity_reference_check#1
- [AFF-OC01] major · The answer names the people to ask, from the CRM.
  evidence: text:any matches /(reference|backchannel|who|ask|person)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
