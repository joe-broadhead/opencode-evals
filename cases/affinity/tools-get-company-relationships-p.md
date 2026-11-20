# tools-get-company-relationships-p
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-get-company-relationships (lane L6b)
- Decision tested: A who-knows-the-company question is one relationships read for the company
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide, twin

## Prompt
which colleague at the firm has the strongest connection to the people at one of our portfolio companies?

## Items
- [AFF-TR01] blocker · It used get_company_relationships once.
  evidence: call:affinity.get_company_relationships#1
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_company_relationships#1 args.company_id > 0
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_company_relationships ;; before:affinity.search_all_companies,affinity.get_company_relationships
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
