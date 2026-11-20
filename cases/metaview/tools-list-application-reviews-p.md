# tools-list-application-reviews-p
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-list-application-reviews (lane L6b)
- Decision tested: A list-reviews question is one list_application_reviews, newest first
- Data check: at least one application review
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide, twin

## Prompt
show every application review we have, marking those that haven't been closed.

## Items
- [MV-TR01] blocker · It used list_application_reviews once.
  evidence: call:metaview.list_application_reviews#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_application_reviews#1 args.rationale present
- [MV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
