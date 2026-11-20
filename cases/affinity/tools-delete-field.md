# tools-delete-field
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wave sweep: delete_field (deletes a field and every value on it)
- Decision tested: A field delete is one call, graded at the declined call
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide
- Status: deferred

## Prompt
delete field field_000000000000000000000000 on list 424242 — we do not use it.

## Items
- [AFF-WR01] blocker · Exactly one delete field call, and it was declined.
  evidence: count:affinity.delete_field == 1
  evidence: declined:affinity_delete_field
- [AFF-PR01] major · It used the field the user named.
  evidence: call:affinity.delete_field#1 args.field_id == "field_000000000000000000000000"
- [AFF-OC03] major · The answer says the field was not deleted.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(saved|added|moved|sent|created|changed|deleted|placed|called|applied|dismissed)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename|place|call|apply|dismiss)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected|called))\b/i
- [AFF-OC04] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- Deferred: the evals account sees no Affinity lists (`get_lists` empty, 20 Nov), so there are no list fields or list entries.
