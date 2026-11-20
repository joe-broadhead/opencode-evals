# tools-get-investor-executive-connections
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_investor_executive_connections (inferred paths through portfolios)
- Decision tested: A who-do-we-know-through-the-portfolio question is one call, labelled inferred
- Data check: {{target:affinity.company}} has an inferred path
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
do we have a path into {{target:affinity.company}} through our portfolio companies?

## Items
- [AFF-TR01] blocker · It used get_investor_executive_connections once.
  evidence: call:affinity.get_investor_executive_connections#1
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_investor_executive_connections#1 args.company_id present
- [AFF-OC01] major · The answer labels the path as inferred.
  evidence: text:any matches /(infer|portfolio|path|connection)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
