# tools-get-opportunities-info
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: get_opportunities_info (deals by id)
- Decision tested: A what-are-these-deals question is one opportunities read for the ids
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what are opportunities 434343 and 434344? name and list is fine.

## Items
- [AFF-TR01] blocker · It used get_opportunities_info once.
  evidence: call:affinity.get_opportunities_info#1
- [AFF-PR01] major · It read the deals the user named.
  evidence: call:affinity.get_opportunities_info#1 args.opportunity_ids contains 434343
- [AFF-OC01] major · The answer gives each deal's name and list.
  evidence: text:any matches /(deal|list|name)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

- [AFF-OC08] major · It says the object was not found, and invents nothing.
  evidence: text:any matches /(not found|couldn't find|could not find|no such|doesn't exist|does not exist|404|no (interviewer|interview|company|path|opportunity|set|task|dictionary|guide))/i

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
