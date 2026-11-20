# tools-get-coworker-connections
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_coworker_connections (which colleagues are connected)
- Decision tested: A which-colleagues-know-them question is one connections read, with Affinity's score labelled
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which of my colleagues are connected to a portfolio company we track?

## Items
- [AFF-TR01] blocker · It used get_coworker_connections once.
  evidence: call:affinity.get_coworker_connections#1
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_coworker_connections ;; before:affinity.search_all_companies,affinity.get_coworker_connections
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_coworker_connections#1 args.company_id > 0
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_coworker_connections ;; before:affinity.search_all_companies,affinity.get_coworker_connections
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
