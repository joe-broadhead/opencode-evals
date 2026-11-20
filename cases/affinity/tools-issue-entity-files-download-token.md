# tools-issue-entity-files-download-token
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: issue_entity_files_download_token (a signed link for a file)
- Decision tested: A download-link request searches the files, takes the one it finds, and is graded at the declined call
- Data check: the CRM holds at least one file
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
get me a download link for the most recent deck.

## Items
- [AFF-WR01] blocker · Exactly one issue entity files download token call, and it was declined.
  evidence: count:affinity.issue_entity_files_download_token == 1
  evidence: declined:affinity_issue_entity_files_download_token
- [AFF-TR02] blocker · It searched the files first.
  evidence: call:affinity.search_files#1
- [AFF-PR01] major · It used the file it found.
  evidence: call:affinity.issue_entity_files_download_token#1 args.file_id > 0
  evidence: before:affinity.search_files,affinity.issue_entity_files_download_token
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(downloaded|issued|created|sent)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [AFF-OC09] major · The file id it passed came from the file search; it invented none.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- The harness cannot prove the file id came from the earlier read (`created` counts write results only); the before order and a non-empty id are the strongest code checks, and a judge settles provenance.
