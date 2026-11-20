# tools-issue-entity-files-upload-token
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: issue_entity_files_upload_token (a token to upload a file)
- Decision tested: An upload request is one token issue, graded at the declined call
- Data check: {{target:affinity.company}} exists
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
upload the deck at ./acme-deck.pdf to {{target:affinity.company}}'s record.

## Items
- [AFF-WR01] blocker · Exactly one issue entity files upload token call, and it was declined.
  evidence: count:affinity.issue_entity_files_upload_token == 1
  evidence: declined:affinity_issue_entity_files_upload_token
- [AFF-PR01] major · It used the company it resolved.
  evidence: call:affinity.issue_entity_files_upload_token#1 args.entity_id present
- [AFF-PR02] major · It passed the file name.
  evidence: call:affinity.issue_entity_files_upload_token#1 args.filename matches /acme-deck\.pdf/
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(uploaded|issued|created|sent)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
