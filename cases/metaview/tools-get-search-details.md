# tools-get-search-details
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_search_details (one sourcing search's brief and status)
- Decision tested: A how-did-that-search-go question is one get_search_details by id
- Data check: candidate data: {{target:metaview.search}} is a sourcing search
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
how did the sourcing search for the backend role go? how many did it find?

## Items
- [MV-OC01] blocker · It used get_search_details once.
  evidence: count:metaview.get_search_details == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_search_details#1 args.rationale present
- [MV-PR02] major · It read the search it resolved.
  evidence: call:metaview.get_search_details#1 args.search_id present
- [MV-OC04] major · The answer gives the search's status and its count.
  evidence: text:any matches /(found|result|candidate|status|[0-9]+)/i
