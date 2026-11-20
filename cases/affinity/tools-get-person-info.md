# tools-get-person-info
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_person_info (one person's fields)
- Decision tested: A person-record question is one get_person_info by id
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
pull up the record of a founder at a portfolio company we track — role, company and how we know them.

## Items
- [AFF-TR01] blocker · It used get_person_info once.
  evidence: call:affinity.get_person_info#1
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_person_info ;; before:affinity.search_all_companies,affinity.get_person_info
- [AFF-PR01] major · It read the person it resolved.
  evidence: call:affinity.get_person_info#1 args.person_id > 0
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_person_info ;; before:affinity.search_all_companies,affinity.get_person_info
- [AFF-OC09] major · The answer reports the person's fields the call returned, or says they were not found, and invents none.
  grader: judge
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
