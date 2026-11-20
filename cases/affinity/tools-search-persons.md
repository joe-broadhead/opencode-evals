# tools-search-persons
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: search_persons (people by name or email)
- Decision tested: A find-this-person question is one search_persons, and namesakes are shown, not merged
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
find a founder at a portfolio company we track in the CRM.

## Items
- [AFF-TR01] blocker · It used search_persons once.
  evidence: call:affinity.search_persons#1
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
  evidence_any: before:affinity.search_companies_top_matches,affinity.search_persons ;; before:affinity.search_all_companies,affinity.search_persons
- [AFF-PR01] major · It searched on the name or email.
  evidence: call:affinity.search_persons#1 args.search_criteria present
  evidence_any: before:affinity.search_companies_top_matches,affinity.search_persons ;; before:affinity.search_all_companies,affinity.search_persons
- [AFF-OC01] major · The answer names the person the search returned, or says there are none, and asks if several match.
  evidence_any: text:any matches /(here (is|are)|I found|matches|which one)/i ;; text:any matches /\b(none|no (person|match|result))\b/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
