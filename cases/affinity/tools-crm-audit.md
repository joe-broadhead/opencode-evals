# tools-crm-audit
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: crm_audit (Affinity's CRM hygiene audit text)
- Decision tested: An audit-our-CRM request calls crm_audit once
- Data check: the CRM's records
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
audit our CRM hygiene — what's missing, stale or duplicated?

## Items
- [AFF-TR01] blocker · It used crm_audit once.
  evidence: call:affinity.crm_audit#1
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
