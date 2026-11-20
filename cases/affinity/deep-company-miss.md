# deep-company-miss
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: deep, error: a company name that does not resolve
- Decision tested: A miss says what was searched, asks for the domain or list, and offers no other source
- Data check: affinity: the name 'Northwind Dynamics' matches no company
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: deep

## Prompt
find Northwind Dynamics in Affinity — I'm sure we track them.

## Items
- [AFF-OC01] blocker · It searched the company name once.
  evidence: count:affinity.search_companies_top_matches == 1
- [AFF-OC02] major · The answer says nothing matched, and names what it searched.
  evidence: text:any matches /(no match|not found|couldn't find|could not find|nothing matched)/i
- [AFF-OC03] major · It asks for the domain, the company or the list.
  evidence: text:any matches /(domain|which list|company name)/i

## Forbidden
- [AFF-SF01] blocker · It did not retry with a shortened or variant name, and did not offer another source.
  evidence: count:affinity.search_companies_top_matches <= 2
  evidence: absent:affinity.create_company
