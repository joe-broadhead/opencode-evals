# tools-create-list-entry
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: create_list_entry (adds a record to a list)
- Decision tested: An add-to-the-list request is one create_list_entry, graded at the declined call
- Data check: the CRM holds at least one list and at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
add a portfolio company we track to our pipeline list.

## Items
- [AFF-WR01] blocker · Exactly one create list entry call, and it was declined.
  evidence: count:affinity.create_list_entry == 1
  evidence: declined:affinity_create_list_entry
- [AFF-TR02] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
- [AFF-TR03] blocker · It found the pipeline list.
  evidence: call:affinity.get_lists#1
- [AFF-PR01] major · It used the list it resolved.
  evidence: call:affinity.create_list_entry#1 args.list_id > 0
  evidence: before:affinity.get_lists,affinity.create_list_entry
- [AFF-PR02] major · It used the company it resolved.
  evidence: call:affinity.create_list_entry#1 args.entity_id > 0
  evidence_any: before:affinity.search_companies_top_matches,affinity.create_list_entry ;; before:affinity.search_all_companies,affinity.create_list_entry
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(added|created|saved)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
