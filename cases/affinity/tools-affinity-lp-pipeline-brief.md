# tools-affinity-lp-pipeline-brief
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: affinity_lp_pipeline_brief (Affinity's LP brief text)
- Decision tested: A brief-me-on-the-LP-pipeline request calls the LP brief playbook once
- Data check: affinity: an LP pipeline list exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
brief me on our LP pipeline — where each conversation stands.

## Items
- [AFF-OC01] blocker · It used affinity_lp_pipeline_brief once.
  evidence: count:affinity.affinity_lp_pipeline_brief == 1
- [AFF-OC02] major · The answer gives the LP brief, grounded in the list.
  evidence: text:any matches /(LP|pipeline|commit|conversation)/i

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
