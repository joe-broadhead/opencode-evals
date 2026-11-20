# tools-search-reports
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: search_reports (saved reports by term)
- Decision tested: A find-the-report question is one search_reports by the term the user gave
- Data check: at least one saved report about interview themes
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
find the saved report about interview themes from the last quarter.

## Items
- [MV-TR01] blocker · It used search_reports once.
  evidence: call:metaview.search_reports#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.search_reports#1 args.rationale present
- [MV-PR02] major · It searched for the report the user described.
  evidence: call:metaview.search_reports#1 args.search_term matches /theme/i
- [MV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
