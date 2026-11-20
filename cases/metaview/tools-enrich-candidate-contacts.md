# tools-enrich-candidate-contacts
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: enrich_candidate_contacts (spends credits; state the estimate first)
- Decision tested: An enrich request is one call, graded at the declined call, with the credit estimate stated before it
- Data check: the most recent candidate has no email on file, and credits are available
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
find the most recent candidate's email and phone number for me.

## Items
- [MV-WR01] blocker · Exactly one enrich candidate contacts call, and it was declined.
  evidence: count:metaview.enrich_candidate_contacts == 1
  evidence: declined:metaview_enrich_candidate_contacts
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.enrich_candidate_contacts#1 args.rationale present
- [MV-PR02] major · It enriched the candidate it resolved.
  evidence: call:metaview.enrich_candidate_contacts#1 args.candidate_ids present
- [MV-PR03] major · It chose the type of enrichment.
  evidence: call:metaview.enrich_candidate_contacts#1 args.enrichment_type matches /email|phone|both/i
- [MV-OC01] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(enriched|found|added|saved)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [MV-OC02] major · The answer states the credits it would cost and what remains, before saying nothing was spent.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
