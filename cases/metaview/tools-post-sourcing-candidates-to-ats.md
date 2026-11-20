# tools-post-sourcing-candidates-to-ats
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: post_sourcing_candidates_to_ats (cannot be undone from Metaview)
- Decision tested: A post-to-ATS request is one call, graded at the declined call, naming the job and posting type
- Data check: the backend sourcing search has two shortlisted candidates and the ATS job exists
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
post the two shortlisted backend candidates to the ATS job, as a normal application.

## Items
- [MV-WR01] blocker · Exactly one post sourcing candidates to ats call, and it was declined.
  evidence: count:metaview.post_sourcing_candidates_to_ats == 1
  evidence: declined:metaview_post_sourcing_candidates_to_ats
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.post_sourcing_candidates_to_ats#1 args.rationale present
- [MV-PR02] major · It used the search it resolved.
  evidence: call:metaview.post_sourcing_candidates_to_ats#1 args.search_id present
- [MV-PR03] major · It carried the two candidates.
  evidence: call:metaview.post_sourcing_candidates_to_ats#1 args.candidate_ids present
- [MV-OC01] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(posted|sent|created)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [MV-OC02] major · The answer says the ATS would receive them, and that it cannot be undone from Metaview.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
