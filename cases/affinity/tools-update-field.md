# tools-update-field
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wave sweep: update_field (renames or edits a field)
- Decision tested: A field rename reads the company fields, picks a global one, and is graded at the declined call; a request to say which field is also accepted
- Data check: the evals account sees at least one global company field (20 Nov)
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
rename one of our custom company fields to "Company tier".

## Items
- [AFF-WR01] blocker · If it attempted the rename, exactly one update field call, and it was declined.
  n/a_when: absent:affinity.update_field
  evidence: count:affinity.update_field == 1
  evidence: declined:affinity_update_field
- [AFF-TR02] blocker · It read the company fields before any rename.
  n/a_when: absent:affinity.update_field
  evidence: call:affinity.get_entity_fields#1 args.entity_type == 1
  evidence: before:affinity.get_entity_fields,affinity.update_field
- [AFF-PR01] major · It used the field it read.
  n/a_when: absent:affinity.update_field
  evidence: call:affinity.update_field#1 args.field_id matches /.+/
- [AFF-PR02] major · It used the new name the user gave.
  n/a_when: absent:affinity.update_field
  evidence: call:affinity.update_field#1 args.name == "Company tier"
- [AFF-OC01] major · If it attempted the rename, the answer says the field was not renamed.
  n/a_when: absent:affinity.update_field
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(renamed|updated|changed|saved)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [AFF-OC11] major · If it did not attempt the rename, it asks which field (or lists the candidates) and says nothing was renamed.
  n/a_when: call:affinity.update_field#1
  evidence: text:any matches /(which field|which one|do you mean|which of|the fields|candidates|available fields)/i
  evidence: text:any matches /\b(not|nothing|didn't|did not|wasn't)\b.{0,40}\b(renamed|changed|updated)\b/i
- [AFF-OC09] major · The field id it passed came from the fields read; it invented none.
  grader: judge
  n/a_when: absent:affinity.update_field
- [AFF-OC10] major · The field it chose is a global field, not an enriched or relationship-intelligence one.
  grader: judge
  n/a_when: absent:affinity.update_field
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- The harness cannot prove the field id came from the earlier read (`created` counts write results only); the before order and a non-empty id are the strongest code checks, and a judge settles provenance and the field's global type.
- A careful agent may ask which field, since the prompt names none; the case accepts that path.
