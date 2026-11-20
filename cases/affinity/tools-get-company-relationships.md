# tools-get-company-relationships
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_company_relationships (who knows this company, by score)
- Decision tested: A who-knows-the-company question is one relationships read for the company
- Data check: affinity: {{target:affinity.company}} has at least one relationship
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
who at the firm knows {{target:affinity.company}} best?

## Items
- [AFF-OC01] blocker · It used get_company_relationships once.
  evidence: count:affinity.get_company_relationships == 1
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_company_relationships#1 args.company_id present
- [AFF-OC03] major · The answer names colleagues and says the score is Affinity's.
  evidence: text:any matches /(Affinity|score|knows)/i
