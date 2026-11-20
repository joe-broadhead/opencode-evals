# tools-get-investor-executive-connections
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_investor_executive_connections (inferred paths through portfolios)
- Decision tested: A who-do-we-know-through-the-portfolio question is one call, labelled inferred
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
do we have a path into a portfolio company we track through our portfolio companies?

## Items
- [AFF-TR01] blocker · It used get_investor_executive_connections once.
  evidence: call:affinity.get_investor_executive_connections#1
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_investor_executive_connections ;; before:affinity.search_all_companies,affinity.get_investor_executive_connections
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_investor_executive_connections#1 args.company_id > 0
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_investor_executive_connections ;; before:affinity.search_all_companies,affinity.get_investor_executive_connections
- [AFF-OC09] major · The answer reports the paths the call returned, or says there are none.
  grader: judge
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
