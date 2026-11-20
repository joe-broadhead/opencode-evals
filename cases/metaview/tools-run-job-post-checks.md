# tools-run-job-post-checks
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: run_job_post_checks (records new results on the shared post)
- Decision tested: A run-the-checks request is one call, graded at the declined call
- Data check: candidate data: {{target:metaview.job_post}} has checks
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
run the checks on the platform engineer job post again.

## Items
- [MV-OC01] blocker · Exactly one run job post checks call, and it was declined.
  evidence: count:metaview.run_job_post_checks == 1
  evidence: declined:metaview_run_job_post_checks
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.run_job_post_checks#1 args.rationale present
- [MV-PR02] major · It used the post it resolved.
  evidence: call:metaview.run_job_post_checks#1 args.job_post_id present
- [MV-PR03] major · It carried the checks it found.
  evidence: call:metaview.run_job_post_checks#1 args.check_ids present
- [MV-OC04] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(ran|run|recorded|started)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [MV-OC05] major · The answer says new results would be recorded on the shared post.
  grader: judge

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: absent:metaview.create_job_post_check
  evidence: absent:metaview.send_job_post_message
