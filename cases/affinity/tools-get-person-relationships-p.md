# tools-get-person-relationships-p
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-get-person-relationships (lane L6b)
- Decision tested: A who-knows-them question is one relationships read ordered by score, labelled Affinity's
- Data check: the founder of {{target:affinity.company}} has at least one relationship
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide, twin

## Prompt
which colleague at the firm is closest to the founder of {{target:affinity.company}}?

## Items
- [AFF-TR01] blocker · It used get_person_relationships once.
  evidence: call:affinity.get_person_relationships#1
- [AFF-PR01] major · It ordered by interaction score.
  evidence: call:affinity.get_person_relationships#1 args.order_by matches /interactionScore/i
- [AFF-OC01] major · The answer names colleagues and says the score is Affinity's.
  evidence: text:any matches /(interaction score|Affinity's score|percentage)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
