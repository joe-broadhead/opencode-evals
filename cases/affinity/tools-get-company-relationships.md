# tools-get-company-relationships
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_company_relationships (who knows this company, by score)
- Decision tested: A who-knows-the-company question is one relationships read for the company
- Data check: {{target:affinity.company}} has at least one relationship
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
who at the firm knows {{target:affinity.company}} best?

## Items
- [AFF-TR01] blocker · It used get_company_relationships once.
  evidence: call:affinity.get_company_relationships#1
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_company_relationships#1 args.company_id present
- [AFF-OC01] major · The answer names colleagues and says the score is Affinity's.
  evidence: text:any matches /(Affinity|score|knows)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
