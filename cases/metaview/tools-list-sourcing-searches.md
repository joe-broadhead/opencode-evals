# tools-list-sourcing-searches
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_sourcing_searches (the workspace's sourcing searches)
- Decision tested: A list-searches question is one list_sourcing_searches
- Data check: candidate data: at least one sourcing search
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
list our sourcing searches, newest first.

## Items
- [MV-OC01] blocker · It used list_sourcing_searches once.
  evidence: count:metaview.list_sourcing_searches == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_sourcing_searches#1 args.rationale present
- [MV-OC03] major · The answer lists the searches, or says there are none.
  evidence: text:any matches /(search|role|no searches|none)/i
