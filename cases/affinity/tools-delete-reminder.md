# tools-delete-reminder
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: delete_reminder (deletes a reminder)
- Decision tested: A delete-the-reminder request lists the firm's reminders, takes the next due one, and is graded at the declined call
- Data check: the firm has at least one reminder
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
delete the firm's next due follow-up reminder.

## Items
- [AFF-WR01] blocker · Exactly one delete reminder call, and it was declined.
  evidence: count:affinity.delete_reminder == 1
  evidence: declined:affinity_delete_reminder
- [AFF-TR02] blocker · It listed the firm's reminders.
  evidence: call:affinity.get_reminders#1
- [AFF-PR01] major · It carried the reminder it found.
  evidence: call:affinity.delete_reminder#1 args.reminder_id > 0
  evidence: before:affinity.get_reminders,affinity.delete_reminder
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(deleted|removed)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [AFF-OC09] major · The reminder id it passed came from the reminders read; it invented none.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- The harness cannot prove the reminder id came from the earlier read (`created` counts write results only); the before order and a non-empty id are the strongest code checks, and a judge settles provenance.
