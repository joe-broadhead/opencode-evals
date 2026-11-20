# tools-manage-candidate-sequence
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: manage_candidate_sequence (starts or stops outreach to a candidate)
- Decision tested: An add-to-sequence request is one call, graded at the declined call, with whom it reaches stated
- Data check: candidate data: {{target:metaview.candidate}} is not in {{target:metaview.sequence}}
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
add {{target:metaview.candidate}} to the backend outreach sequence.

## Items
- [MV-OC01] blocker · Exactly one manage candidate sequence call, and it was declined.
  evidence: count:metaview.manage_candidate_sequence == 1
  evidence: declined:metaview_manage_candidate_sequence
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.manage_candidate_sequence#1 args.rationale present
- [MV-PR02] major · It asked to add the candidate.
  evidence: call:metaview.manage_candidate_sequence#1 args.action present
- [MV-PR03] major · It carried the candidate the user named.
  evidence: call:metaview.manage_candidate_sequence#1 args.candidate_ids present
- [MV-OC04] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(added|started|sent|changed)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [MV-OC05] major · The answer says outreach by email or LinkedIn would start.
  grader: judge

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: absent:metaview.give_application_review_candidate_feedback
  evidence: absent:metaview.send_sourcing_message
