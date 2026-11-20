# tools-create-company
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: create_company (a new company record)
- Decision tested: A new company is one create, graded at the declined call
- Data check: the company is not yet tracked
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
add Acme Robotics as a company in Affinity — acmerobotics.example, no people yet.

## Items
- [AFF-WR01] blocker · Exactly one create company call, and it was declined.
  evidence: count:affinity.create_company == 1
  evidence: declined:affinity_create_company
- [AFF-PR01] major · It passed the value the user gave.
  evidence: call:affinity.create_company#1 args.name == "Acme Robotics"
- [AFF-PR02] major · It passed the value the user gave.
  evidence: call:affinity.create_company#1 args.domain == "acmerobotics.example"
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(created|added|saved)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
