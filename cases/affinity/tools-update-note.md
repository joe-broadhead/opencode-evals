# tools-update-note
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: update_note (changes a note's text or links)
- Decision tested: A note edit finds a company, reads its recent notes, and is graded at the declined call on the note it found
- Data check: the CRM holds at least one company with a note
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
add a line to a recent note on a portfolio company we track: "also wants an intro to the CTO."

## Items
- [AFF-WR01] blocker · Exactly one update note call, and it was declined.
  evidence: count:affinity.update_note == 1
  evidence: declined:affinity_update_note
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
- [AFF-TR03] blocker · It read the company's notes.
  evidence: call:affinity.get_notes_for_entity#1
- [AFF-PR01] major · It used the note it read.
  evidence: call:affinity.update_note#1 args.note_id > 0
  evidence: before:affinity.get_notes_for_entity,affinity.update_note
- [AFF-PR02] major · It passed the value the user gave.
  evidence: call:affinity.update_note#1 args.content matches /intro to the CTO/
- [AFF-PR03] major · It read the notes on the company the search returned.
  evidence: call:affinity.get_notes_for_entity#1 args.entity_id > 0
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_notes_for_entity ;; before:affinity.search_all_companies,affinity.get_notes_for_entity
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(updated|changed|saved|added)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [AFF-OC09] major · The note id it passed came from the notes read; it invented none.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- The harness cannot prove the note id came from the earlier read (`created` counts write results only); the before order and a non-empty id are the strongest code checks, and a judge settles provenance.
