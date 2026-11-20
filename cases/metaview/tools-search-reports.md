# tools-search-reports
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: search_reports (saved reports by term)
- Decision tested: A find-the-report question is one search_reports by the term the user gave
- Data check: candidate data: at least one saved report about interview themes
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
find the saved report about interview themes from the last quarter.

## Items
- [MV-OC01] blocker · It used search_reports once.
  evidence: count:metaview.search_reports == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.search_reports#1 args.rationale present
- [MV-PR02] major · It searched for the report the user described.
  evidence: call:metaview.search_reports#1 args.search_term present
- [MV-OC04] major · The answer names the report, or says none matched.
  evidence: text:any matches /(report|theme|no reports|not found)/i
