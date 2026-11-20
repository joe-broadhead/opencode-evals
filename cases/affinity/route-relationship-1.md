# route-relationship-1
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: overlap routing: who-knows-them is the CRM's relationships, not mail or calendar
- Decision tested: A who-at-the-firm-knows-them question is answered from Affinity's relationships, not from mail or calendar
- Data check: the founder of {{target:affinity.company}} has at least one relationship
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
who at the firm knows the founder of {{target:affinity.company}} best?

## Items
- [AFF-RT01] blocker · It read the CRM's relationships.
  evidence: call:affinity.get_person_relationships#1
- [AFF-RT02] blocker · It did not search mail or calendar for it.
  evidence: absent:gws.*
- [AFF-OC01] major · The answer names the colleagues and labels the score as Affinity's.
  evidence: text:any matches /(interaction score|Affinity's score|percentage)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was written.
  evidence: absent-write:affinity
  evidence: absent:write
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
