# tools-merge-companies
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: merge_companies (merges two company records)
- Decision tested: A merge request is one call, graded at the declined call, with both records named
- Data check: two company records are duplicates
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
merge company 424245 (Acme Test Co) into {{target:affinity.company}} — they're the same company.

## Items
- [AFF-WR01] blocker · Exactly one merge companies call, and it was declined.
  evidence: count:affinity.merge_companies == 1
  evidence: declined:affinity_merge_companies
- [AFF-PR01] major · It named the record to keep.
  evidence: call:affinity.merge_companies#1 args.primary_company_id present
- [AFF-PR02] major · It named the record to merge in.
  evidence: call:affinity.merge_companies#1 args.duplicate_company_id == 424245
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(merged|combined)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
