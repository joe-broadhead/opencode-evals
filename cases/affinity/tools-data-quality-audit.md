# tools-data-quality-audit
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: data_quality_audit (Affinity's CRM audit routine)
- Decision tested: A CRM-audit request calls the audit routine once
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
audit our CRM data quality — what is missing or stale?

## Items
- [AFF-TR01] blocker · It used data_quality_audit once.
  evidence: call:affinity.data_quality_audit#1
- [AFF-OC01] major · The answer gives concrete findings (missing, stale or duplicate fields) and next steps, not a restatement of the question.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
