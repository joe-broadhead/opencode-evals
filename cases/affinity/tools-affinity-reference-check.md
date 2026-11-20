# tools-affinity-reference-check
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: affinity_reference_check (Affinity's reference check text)
- Decision tested: A run-a-reference-check request calls the reference playbook once
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
run a backchannel reference check on a founder at a portfolio company we track — who can tell us what they're like to work with?

## Items
- [AFF-TR01] blocker · It used affinity_reference_check once.
  evidence: call:affinity.affinity_reference_check#1
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
- [AFF-OC09] major · The answer gives a reference-check plan from the playbook and the record, naming who to ask and why, not a restatement of the question.
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
