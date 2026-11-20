# tools-list-application-review-candidates
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_application_review_candidates (the candidates in a review, with fit filters)
- Decision tested: A who-is-undecided question is one candidate list with the undecided filter
- Data check: candidate data: {{target:metaview.review}} has at least three candidates
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
who's still undecided in the backend review? show their fit bands.

## Items
- [MV-OC01] blocker · It used list_application_review_candidates once.
  evidence: count:metaview.list_application_review_candidates == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_application_review_candidates#1 args.rationale present
- [MV-PR02] major · It filtered to undecided.
  evidence: call:metaview.list_application_review_candidates#1 args.decision_filter == undecided
- [MV-OC04] major · The answer lists them with their fit bands.
  evidence: text:any matches /(fit|undecided|candidate|none)/i
