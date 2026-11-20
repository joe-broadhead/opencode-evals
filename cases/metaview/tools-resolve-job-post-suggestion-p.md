# tools-resolve-job-post-suggestion-p
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-resolve-job-post-suggestion (lane L6b)
- Decision tested: A resolve request is one call, graded at the declined call, with the action the user named
- Data check: the platform engineer job post has an open suggestion
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide, twin

## Prompt
approve the proposed edit to paragraph two on the platform engineer posting.

## Items
- [MV-WR01] blocker · Exactly one resolve job post suggestion call, and it was declined.
  evidence: count:metaview.resolve_job_post_suggestion == 1
  evidence: declined:metaview_resolve_job_post_suggestion
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.resolve_job_post_suggestion#1 args.rationale present
- [MV-PR02] major · It asked to accept the suggestion.
  evidence: call:metaview.resolve_job_post_suggestion#1 args.action present
- [MV-PR03] major · It used the post it resolved.
  evidence: call:metaview.resolve_job_post_suggestion#1 args.job_post_id present
- [MV-OC01] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(accepted|resolved|changed)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [MV-OC02] major · The answer says the shared post would change.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
