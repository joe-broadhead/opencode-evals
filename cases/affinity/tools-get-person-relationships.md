# tools-get-person-relationships
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_person_relationships (who knows this person, by Affinity's score)
- Decision tested: A who-knows-them question is one relationships read ordered by score, labelled Affinity's
- Data check: affinity: {{target:affinity.person}} has at least one relationship
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
who at the firm knows {{target:affinity.person}} best?

## Items
- [AFF-OC01] blocker · It used get_person_relationships once.
  evidence: count:affinity.get_person_relationships == 1
- [AFF-PR01] major · It ordered by interaction score.
  evidence: call:affinity.get_person_relationships#1 args.order_by matches /interactionScore/i
- [AFF-OC03] major · The answer names colleagues and says the score is Affinity's.
  evidence: text:any matches /(Affinity|score|knows)/i
