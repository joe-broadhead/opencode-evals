# tools-list-field-values
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_field_values (the values a filter takes, such as a candidate)
- Decision tested: A find-the-candidate question resolves the name to a filter value, and several matches are shown, not merged
- Data check: candidate data: {{target:metaview.candidate}} resolves to one value, or several are shown
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
find {{target:metaview.candidate}} in Metaview for me — I need the right record before I search their interviews.

## Items
- [MV-OC01] blocker · It used list_field_values once.
  evidence: count:metaview.list_field_values == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_field_values#1 args.rationale present
- [MV-PR02] major · It searched the candidate field.
  evidence: call:metaview.list_field_values#1 args.field_id matches /candidate/i
- [MV-OC04] major · The answer names the match, or shows the several matches with enough to choose.
  evidence: text:any matches /(found|match|one record|several)/i
