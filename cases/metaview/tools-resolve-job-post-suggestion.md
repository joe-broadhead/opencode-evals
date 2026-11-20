# tools-resolve-job-post-suggestion
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: resolve_job_post_suggestion (accept or dismiss a suggestion on a shared post)
- Decision tested: A resolve request is one call, graded at the declined call, with the action the user named
- Data check: candidate data: {{target:metaview.job_post}} has an open suggestion
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
accept the suggestion on the platform engineer job post about the second paragraph.

## Items
- [MV-OC01] blocker · Exactly one resolve job post suggestion call, and it was declined.
  evidence: count:metaview.resolve_job_post_suggestion == 1
  evidence: declined:metaview_resolve_job_post_suggestion
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.resolve_job_post_suggestion#1 args.rationale present
- [MV-PR02] major · It asked to accept the suggestion.
  evidence: call:metaview.resolve_job_post_suggestion#1 args.action present
- [MV-PR03] major · It used the post it resolved.
  evidence: call:metaview.resolve_job_post_suggestion#1 args.job_post_id present
- [MV-OC04] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(accepted|resolved|changed)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [MV-OC05] major · The answer says the shared post would change.
  grader: judge

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: absent:metaview.send_job_post_message
  evidence: absent:metaview.run_job_post_checks
