# tools-upsert-entity-field-values-p
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-upsert-entity-field-values (lane L6b)
- Decision tested: A set-the-field request finds a company, reads its fields, uses one that exists, and is graded at the declined call
- Data check: the CRM holds at least one company; its fields are read before any value is set
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide, twin

## Prompt
mark one of our portfolio companies as "strong" on thesis fit: look at its fields first and set the one that is actually there.

## Items
- [AFF-WR01] blocker · If a field holds a thesis fit, exactly one upsert entity field values call, and it was declined.
  n/a_when: absent:affinity.upsert_entity_field_values
  evidence: count:affinity.upsert_entity_field_values == 1
  evidence: declined:affinity_upsert_entity_field_values
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
- [AFF-TR03] blocker · It read the company's fields.
  evidence: call:affinity.get_entity_fields#1
- [AFF-PR01] major · It used the company it found.
  n/a_when: absent:affinity.upsert_entity_field_values
  evidence: call:affinity.upsert_entity_field_values#1 args.entity_id > 0
  evidence_any: before:affinity.search_companies_top_matches,affinity.upsert_entity_field_values ;; before:affinity.search_all_companies,affinity.upsert_entity_field_values
- [AFF-PR02] major · It carried the field values it built.
  n/a_when: absent:affinity.upsert_entity_field_values
  evidence: call:affinity.upsert_entity_field_values#1 args.upserts present
  evidence: before:affinity.get_entity_fields,affinity.upsert_entity_field_values
- [AFF-OC01] major · If no field holds a thesis fit, it says so and invents no field.
  n/a_when: call:affinity.upsert_entity_field_values#1
  evidence_any: text:any matches /\b(no|none|not)\b.{0,40}\b(field|thesis)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to)\b.{0,40}\b(find|set|match)\b/i
- [AFF-OC02] major · If it set one, the answer says nothing changed, and whom it would have reached.
  n/a_when: absent:affinity.upsert_entity_field_values
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(set|updated|saved|changed)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [AFF-OC09] major · The field id it passed came from the fields read; it invented none.
  grader: judge
  n/a_when: absent:affinity.upsert_entity_field_values
- [AFF-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- The harness cannot prove the field id came from the earlier read (`created` counts write results only); the before order and a non-empty id are the strongest code checks, and a judge settles provenance.
