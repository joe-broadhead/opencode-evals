# tools-create-reminder
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: create_reminder (a reminder on a record)
- Decision tested: A reminder is one create_reminder, graded at the declined call
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity utc-hours=9-17
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
remind me to follow up with a founder at a portfolio company we track next Tuesday.

## Items
- [AFF-WR01] blocker · Exactly one create reminder call, and it was declined.
  evidence: count:affinity.create_reminder == 1
  evidence: declined:affinity_create_reminder
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
- [AFF-PR01] major · It attached the reminder to the person.
  evidence: call:affinity.create_reminder#1 args.entity_id > 0
  evidence_any: before:affinity.search_companies_top_matches,affinity.create_reminder ;; before:affinity.search_all_companies,affinity.create_reminder
- [AFF-PR02] major · It set the due date.
  evidence: call:affinity.create_reminder#1 args.due_date matches /T[0-9]{2}:[0-9]{2}/
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(created|added|set|saved)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [AFF-OC09] major · The person id it attached the reminder to came from the search; it invented none.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
