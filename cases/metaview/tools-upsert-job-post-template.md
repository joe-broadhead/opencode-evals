# tools-upsert-job-post-template
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: upsert_job_post_template (creates or replaces a shared template)
- Decision tested: A save-as-template request is one upsert, graded at the declined call
- Data check: the platform engineer job post exists
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
save the platform engineer post as a template called "Platform engineer v2".

## Items
- [MV-WR01] blocker · Exactly one upsert job post template call, and it was declined.
  evidence: count:metaview.upsert_job_post_template == 1
  evidence: declined:metaview_upsert_job_post_template
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.upsert_job_post_template#1 args.rationale present
- [MV-PR02] major · It used the name the user gave.
  evidence: call:metaview.upsert_job_post_template#1 args.name == Platform engineer v2
- [MV-PR03] major · It carried the post's sections.
  evidence: call:metaview.upsert_job_post_template#1 args.sections present
- [MV-OC01] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(saved|created|changed)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [MV-OC02] major · The answer says the template would be shared with the workspace.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
