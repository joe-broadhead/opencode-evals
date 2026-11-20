# tools-get-persons-info
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_persons_info (several people in one read)
- Decision tested: A pull-up-these-three question is one batched read, not three
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
pull up the founders of a portfolio company we track in one go — names, roles and emails.

## Items
- [AFF-TR01] blocker · It used get_persons_info once.
  evidence: call:affinity.get_persons_info#1
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
- [AFF-PR01] major · It passed the people it resolved as a list.
  evidence: call:affinity.get_persons_info#1 args.person_ids present
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_persons_info ;; before:affinity.search_all_companies,affinity.get_persons_info
- [AFF-OC09] major · The answer reports the people the call returned, or says there are none.
  grader: judge
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
