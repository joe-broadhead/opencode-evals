# tools-list-sourcing-candidates
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_sourcing_candidates (who a sourcing search found)
- Decision tested: A who-did-it-find question is one list over the search, not a fetch of every profile
- Data check: candidate data: {{target:metaview.search}} has at least three candidates
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
who did the backend sourcing search turn up? the shortlist, with their current companies.

## Items
- [MV-OC01] blocker · It used list_sourcing_candidates once.
  evidence: count:metaview.list_sourcing_candidates == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_sourcing_candidates#1 args.rationale present
- [MV-PR02] major · It read the search it resolved.
  evidence: call:metaview.list_sourcing_candidates#1 args.search_id present
- [MV-OC04] major · The answer lists candidates by name and company.
  evidence: text:any matches /(candidate|company|found)/i
