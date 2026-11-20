# route-relationship-1
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: overlap routing: who-knows-them is the CRM's relationships, not mail or calendar
- Decision tested: A who-at-the-firm-knows-them question is answered from Affinity's relationships, not from mail or calendar
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
who at the firm knows a founder at a portfolio company we track best?

## Items
- [AFF-RT01] blocker · It read the CRM's relationships.
  evidence: call:affinity.get_person_relationships#1
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_person_relationships ;; before:affinity.search_all_companies,affinity.get_person_relationships
- [AFF-RT02] blocker · It did not search mail or calendar for it.
  evidence: absent:gws.*
- [AFF-PR01] major · It read the person the search returned.
  evidence: call:affinity.get_person_relationships#1 args.person_id > 0
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_person_relationships ;; before:affinity.search_all_companies,affinity.get_person_relationships
- [AFF-OC01] major · The answer names the colleagues the call returned, or says there are none, and labels any score as Affinity's.
  evidence_any: text:any matches /(interaction score|Affinity's score|percentage)/i ;; text:any matches /\b(none|no (relationships|colleagues|connections))\b/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was written.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
