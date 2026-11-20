# tools-crm-audit
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: crm_audit (Affinity's CRM hygiene audit text)
- Decision tested: An audit-our-CRM request calls crm_audit once
- Data check: affinity: the CRM's records
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
audit our CRM hygiene — what's missing, stale or duplicated?

## Items
- [AFF-OC01] blocker · It used crm_audit once.
  evidence: count:affinity.crm_audit == 1
- [AFF-OC02] major · The answer gives the audit as findings and steps.
  evidence: text:any matches /(missing|stale|duplicate|audit|field)/i

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
