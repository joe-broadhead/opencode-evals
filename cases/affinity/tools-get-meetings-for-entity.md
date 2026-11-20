# tools-get-meetings-for-entity
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_meetings_for_entity (meetings with one record, in a window)
- Decision tested: A when-did-we-last-meet question is one meetings read for the record and window
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
when did we last meet a portfolio company we track? the last few meetings is fine.

## Items
- [AFF-TR01] blocker · It used get_meetings_for_entity once.
  evidence: call:affinity.get_meetings_for_entity#1
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_meetings_for_entity ;; before:affinity.search_all_companies,affinity.get_meetings_for_entity
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_meetings_for_entity#1 args.entity_id > 0
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_meetings_for_entity ;; before:affinity.search_all_companies,affinity.get_meetings_for_entity
- [AFF-OC09] major · The answer reports the meetings the call returned, or says there are none.
  grader: judge
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
