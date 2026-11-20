# tools-affinity-lp-pipeline-brief-p
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-affinity-lp-pipeline-brief (lane L6b)
- Decision tested: A brief-me-on-the-LP-pipeline request calls the LP brief playbook once
- Data check: the playbook text is returned
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide, twin

## Prompt
give me a status rundown on each of our limited partner conversations.

## Items
- [AFF-TR01] blocker · It used affinity_lp_pipeline_brief once.
  evidence: call:affinity.affinity_lp_pipeline_brief#1
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
