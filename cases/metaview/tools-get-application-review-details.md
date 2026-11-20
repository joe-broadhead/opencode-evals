# tools-get-application-review-details
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_application_review_details (one review's ICP, versions and status)
- Decision tested: A how-is-the-review-set-up question is one details read by id
- Data check: candidate data: {{target:metaview.review}} is an application review
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
how is the backend engineer application review set up? I want the criteria and the version.

## Items
- [MV-OC01] blocker · It used get_application_review_details once.
  evidence: count:metaview.get_application_review_details == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_application_review_details#1 args.rationale present
- [MV-PR02] major · It read the review it resolved.
  evidence: call:metaview.get_application_review_details#1 args.application_review_id present
- [MV-OC04] major · The answer gives the criteria and the version.
  evidence: text:any matches /(criteria|ICP|version|review)/i
