# tools-get-person-relationships
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_person_relationships (who knows this person, by Affinity's score)
- Decision tested: A who-knows-them question is one relationships read ordered by score, labelled Affinity's
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
who at the firm knows a founder at a portfolio company we track best?

## Items
- [AFF-TR01] blocker · It used get_person_relationships once.
  evidence: call:affinity.get_person_relationships#1
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
- [AFF-PR01] major · It ordered by interaction score.
  evidence: call:affinity.get_person_relationships#1 args.order_by matches /interactionScore/i
- [AFF-PR02] major · It read the person the search returned.
  evidence: call:affinity.get_person_relationships#1 args.person_id > 0
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_person_relationships ;; before:affinity.search_all_companies,affinity.get_person_relationships
- [AFF-OC01] major · The answer names the colleagues the call returned, or says there are none, and labels any score as Affinity's.
  evidence_any: text:any matches /(interaction score|Affinity's score|percentage)/i ;; text:any matches /\b(none|no (relationships|colleagues|connections))\b/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
