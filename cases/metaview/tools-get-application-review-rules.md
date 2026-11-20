# tools-get-application-review-rules
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_application_review_rules (the workspace's review rules)
- Decision tested: A what-rules question is one rules read
- Data check: candidate data: the workspace's review rules
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
what rules does our application review use at the moment?

## Items
- [MV-OC01] blocker · It used get_application_review_rules once.
  evidence: count:metaview.get_application_review_rules == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_application_review_rules#1 args.rationale present
- [MV-OC03] major · The answer states the rules as they are.
  evidence: text:any matches /(rule|criteria|review)/i
