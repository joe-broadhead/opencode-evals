# tools-list-fields
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_fields (the fields a conversation can be filtered by)
- Decision tested: A which-fields question is one list_fields, and the answer names filterable fields
- Data check: candidate data: the workspace's field list
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
what can I filter interviews by in Metaview? I want job title and stage if they exist.

## Items
- [MV-OC01] blocker · It used list_fields once.
  evidence: count:metaview.list_fields == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_fields#1 args.rationale present
- [MV-PR02] major · It searched for the fields the user named.
  evidence: call:metaview.list_fields#1 args.search_term present
- [MV-OC04] major · The answer names the fields it found, or says which are not there.
  evidence: text:any matches /(job title|stage|field|candidate)/i
