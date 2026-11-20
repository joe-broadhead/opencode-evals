# deep-ambiguous-company-health
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: deep, ambiguous: 'how's Acme doing?'
- Decision tested: An open-ended company question is answered from the CRM and asks what the user wants, without inventing news or a verdict
- Data check: {{target:affinity.company}} exists with a stage and notes
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: deep

## Prompt
how's {{target:affinity.company}} doing?

## Items
- [AFF-TR01] blocker · It read the company's CRM record.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.get_company_info#1
- [AFF-OC01] major · The answer gives the CRM facts (stage, last contact) and asks what the user wants to know.
  evidence: text:any matches /(stage|last|which|what would you like)/i
- [AFF-OC02] major · It invents no news, funding or market fact.
  grader: judge
- [AFF-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · No web search and no write.
  evidence: absent:affinity.create_note
  evidence: absent:write
  evidence: absent:websearch
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
