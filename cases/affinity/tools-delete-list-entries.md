# tools-delete-list-entries
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: delete_list_entries (removes entries from a list)
- Decision tested: A remove-from-the-list request lists the lists, reads an entry, and is graded at the declined call
- Data check: the CRM holds at least one list with an entry
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide
- Status: deferred

## Prompt
take the most recently added entry on our first pipeline list off that list — they passed.

## Items
- [AFF-WR01] blocker · Exactly one delete list entries call, and it was declined.
  evidence: count:affinity.delete_list_entries == 1
  evidence: declined:affinity_delete_list_entries
- [AFF-TR02] blocker · It listed the firm's lists.
  evidence: call:affinity.get_lists#1
- [AFF-TR03] blocker · It read an entry from the list.
  evidence: call:affinity.search_list_entries#1
- [AFF-PR01] major · It used the list it found.
  evidence: call:affinity.delete_list_entries#1 args.list_id > 0
  evidence_any: before:affinity.get_lists,affinity.delete_list_entries ;; before:affinity.search_list_entries,affinity.delete_list_entries
- [AFF-PR02] major · It carried the entry it read.
  evidence: call:affinity.delete_list_entries#1 args.list_entry_ids present
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(removed|deleted)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- Deferred: the evals account sees no Affinity lists (`get_lists` empty, 20 Nov), so there are no list entries or opportunities.
