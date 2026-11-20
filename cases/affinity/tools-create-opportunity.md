# tools-create-opportunity
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: create_opportunity (a deal on a list)
- Decision tested: A new deal is one create_opportunity, graded at the declined call
- Data check: the pipeline exists
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
create a deal for {{target:affinity.company}} on the the pipeline list, called "Acme Robotics seed".

## Items
- [AFF-WR01] blocker · Exactly one create opportunity call, and it was declined.
  evidence: count:affinity.create_opportunity == 1
  evidence: declined:affinity_create_opportunity
- [AFF-PR01] major · It passed the value the user gave.
  evidence: call:affinity.create_opportunity#1 args.name matches /Acme Robotics seed/
- [AFF-PR02] major · It used the list it resolved.
  evidence: call:affinity.create_opportunity#1 args.list_id present
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(created|added|saved)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
