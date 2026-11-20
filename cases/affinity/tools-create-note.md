# tools-create-note
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: create_note (a note on records)
- Decision tested: A note is one create_note, graded at the declined call
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
add a note to a portfolio company we track: "Wants a warm intro to the platform team; follow up after their board meeting."

## Items
- [AFF-WR01] blocker · Exactly one create note call, and it was declined.
  evidence: count:affinity.create_note == 1
  evidence: declined:affinity_create_note
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
  evidence_any: before:affinity.search_companies_top_matches,affinity.create_note ;; before:affinity.search_all_companies,affinity.create_note
- [AFF-PR01] major · It passed the value the user gave.
  evidence: call:affinity.create_note#1 args.content matches /warm intro/
- [AFF-PR02] major · It attached the note to the company.
  evidence: call:affinity.create_note#1 args.company_ids present
  evidence_any: before:affinity.search_companies_top_matches,affinity.create_note ;; before:affinity.search_all_companies,affinity.create_note
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(added|created|saved)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [AFF-OC09] major · The company id it attached the note to came from the search; it invented none.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
