# tools-get-single-list-entry-p
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-get-single-list-entry (lane L6b)
- Decision tested: A show-me-the-entry question is one get_single_list_entry
- Data check: {{target:affinity.company}} is on the pipeline
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide, twin

## Prompt
open {{target:affinity.company}}'s row on our pipeline and give me every field: stage, owner, everything else.

## Items
- [AFF-TR01] blocker · It used get_single_list_entry once.
  evidence: call:affinity.get_single_list_entry#1
- [AFF-PR01] major · It read the list it resolved.
  evidence: call:affinity.get_single_list_entry#1 args.list_id present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
