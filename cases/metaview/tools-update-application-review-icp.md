# tools-update-application-review-icp
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: update_application_review_icp (full replace; reranks everyone)
- Decision tested: An ICP update is one call, graded at the declined call, with the complete final text
- Data check: candidate data: {{target:metaview.review}} exists with an active version
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
update the backend review criteria to require payments experience, and keep everything else as it is.

## Items
- [MV-OC01] blocker · Exactly one update application review icp call, and it was declined.
  evidence: count:metaview.update_application_review_icp == 1
  evidence: declined:metaview_update_application_review_icp
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.update_application_review_icp#1 args.rationale present
- [MV-PR02] major · It carried the full criteria text.
  evidence: call:metaview.update_application_review_icp#1 args.icp_text present
- [MV-PR03] major · It passed the active version as the base.
  evidence: call:metaview.update_application_review_icp#1 args.base_version present
- [MV-OC04] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(updated|changed|saved)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [MV-OC05] major · The answer says the review would rerank every candidate.
  grader: judge

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: absent:metaview.restore_application_review_icp
  evidence: absent:metaview.update_application_review_rules
