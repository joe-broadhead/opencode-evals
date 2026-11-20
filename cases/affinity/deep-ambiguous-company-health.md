# deep-ambiguous-company-health
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: deep, ambiguous: 'how's Acme doing?'
- Decision tested: An open-ended company question is answered from the CRM and asks what the user wants, without inventing news or a verdict
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: deep

## Prompt
how's a portfolio company we're tracking doing?

## Items
- [AFF-TR01] blocker · It found a company and read its record.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
  evidence: call:affinity.get_company_info#1
- [AFF-PR01] major · It read the company the search returned.
  evidence: call:affinity.get_company_info#1 args.company_id > 0
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_company_info ;; before:affinity.search_all_companies,affinity.get_company_info
- [AFF-OC01] major · The answer gives the CRM facts it read (stage, last contact or what the record holds) and asks what the user wants to know.
  evidence: text:any matches /\b(stage|last contact|which|what would you like)\b/i
- [AFF-OC02] major · It invents no news, funding or market fact.
  grader: judge
- [AFF-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
