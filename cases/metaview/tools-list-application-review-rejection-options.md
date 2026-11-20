# tools-list-application-review-rejection-options
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_application_review_rejection_options (the reasons and templates a reject can use)
- Decision tested: A what-reasons-can-I-use question is one rejection-options read, with no decision made
- Data check: the backend application review exists
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
what rejection reasons and email templates can I use for the backend review?

## Items
- [MV-TR01] blocker · It used list_application_review_rejection_options once.
  evidence: call:metaview.list_application_review_rejection_options#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_application_review_rejection_options#1 args.rationale present
- [MV-PR02] major · It read the review it resolved.
  evidence: call:metaview.list_application_review_rejection_options#1 args.application_review_id present
- [MV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
