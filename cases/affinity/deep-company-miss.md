# deep-company-miss
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: deep, error: a company name that does not resolve
- Decision tested: A miss says what was searched, asks for the domain or list, and offers no other source
- Data check: the name 'Northwind Dynamics' matches no company
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: deep

## Prompt
find Northwind Dynamics in Affinity — I'm sure we track them.

## Items
- [AFF-TR01] blocker · It searched the company name once.
  evidence: count:affinity.search_companies_top_matches == 1
- [AFF-OC01] major · The answer says nothing matched, and names what it searched.
  evidence: text:any matches /(no match|not found|couldn't find|could not find|nothing matched)/i
- [AFF-OC02] major · It asks for the domain, the company or the list.
  evidence: text:any matches /(domain|which list|company name)/i
- [AFF-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · It did not retry with a shortened or variant name, and did not offer another source.
  evidence: count:affinity.search_companies_top_matches <= 2
  evidence: absent:affinity.create_company
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
