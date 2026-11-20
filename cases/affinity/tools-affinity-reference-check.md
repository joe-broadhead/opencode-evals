# tools-affinity-reference-check
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: affinity_reference_check (Affinity's reference check text)
- Decision tested: A run-a-reference-check request calls the reference playbook once
- Data check: affinity: {{target:affinity.person}} has a shared history with the firm
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
run a backchannel reference check on {{target:affinity.person}} — who can tell us what they're like to work with?

## Items
- [AFF-OC01] blocker · It used affinity_reference_check once.
  evidence: count:affinity.affinity_reference_check == 1
- [AFF-OC02] major · The answer names the people to ask, from the CRM.
  evidence: text:any matches /(reference|backchannel|who|ask|person)/i

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
