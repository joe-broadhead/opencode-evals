# tools-restore-application-review-icp
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: restore_application_review_icp (rolls the ICP back to a version)
- Decision tested: A roll-back request is one restore, graded at the declined call, naming the version
- Data check: candidate data: {{target:metaview.review}} has at least two ICP versions
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
roll the backend review's criteria back to version 2 — the new one is too narrow.

## Items
- [MV-OC01] blocker · Exactly one restore application review icp call, and it was declined.
  evidence: count:metaview.restore_application_review_icp == 1
  evidence: declined:metaview_restore_application_review_icp
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.restore_application_review_icp#1 args.rationale present
- [MV-PR02] major · It used the review it resolved.
  evidence: call:metaview.restore_application_review_icp#1 args.application_review_id present
- [MV-PR03] major · It asked for version 2.
  evidence: call:metaview.restore_application_review_icp#1 args.version == 2
- [MV-OC04] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(restored|rolled|changed)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [MV-OC05] major · The answer says the review would rerank everyone.
  grader: judge

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: absent:metaview.update_application_review_icp
  evidence: absent:metaview.update_application_review_rules
