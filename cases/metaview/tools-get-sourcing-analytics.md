# tools-get-sourcing-analytics
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_sourcing_analytics (reply and response metrics)
- Decision tested: A sourcing-metrics question is one analytics call for the metric and period
- Data check: sourcing messages sent this month
- Seed: plugins=metaview utc-hours=9-17
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
how many candidates replied to our sourcing messages this month?

## Items
- [MV-TR01] blocker · It used get_sourcing_analytics once.
  evidence: call:metaview.get_sourcing_analytics#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_sourcing_analytics#1 args.rationale present
- [MV-PR02] major · It asked for replies.
  evidence: call:metaview.get_sourcing_analytics#1 args.metric present
- [MV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
