# tools-list-application-review-candidates
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_application_review_candidates (the candidates in a review, with fit filters)
- Decision tested: A who-is-undecided question is one candidate list with the undecided filter
- Data check: the backend application review has at least three candidates
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
who's still undecided in the backend review? show their fit bands.

## Items
- [MV-TR01] blocker · It used list_application_review_candidates once.
  evidence: call:metaview.list_application_review_candidates#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_application_review_candidates#1 args.rationale present
- [MV-PR02] major · It filtered to undecided.
  evidence: call:metaview.list_application_review_candidates#1 args.decision_filter == undecided
- [MV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
