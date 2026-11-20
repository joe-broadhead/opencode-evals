# tools-update-opportunity
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: update_opportunity (renames or relinks a deal)
- Decision tested: A deal rename searches the deals, picks one, and is graded at the declined call
- Data check: the CRM holds at least one opportunity
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide
- Status: deferred

## Prompt
rename one of our open deals to "Acme Robotics seed (2026)".

## Items
- [AFF-WR01] blocker · Exactly one update opportunity call, and it was declined.
  evidence: count:affinity.update_opportunity == 1
  evidence: declined:affinity_update_opportunity
- [AFF-TR02] blocker · It searched the opportunities.
  evidence: call:affinity.search_opportunities#1
- [AFF-PR01] major · It used the deal it found.
  evidence: call:affinity.update_opportunity#1 args.opportunity_id > 0
  evidence: before:affinity.search_opportunities,affinity.update_opportunity
- [AFF-PR02] major · It passed the value the user gave.
  evidence: call:affinity.update_opportunity#1 args.name matches /Acme Robotics seed/
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(renamed|updated|changed|saved)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- Deferred: the evals account sees no Affinity lists (`get_lists` empty, 20 Nov), so there are no list entries or opportunities.
