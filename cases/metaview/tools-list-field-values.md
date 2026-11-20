# tools-list-field-values
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_field_values (the values a filter takes, such as a candidate)
- Decision tested: A find-the-candidate question resolves the name to a filter value, and several matches are shown, not merged
- Data check: the most recent candidate resolves to one value, or several are shown
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
find the most recent candidate in Metaview for me — I need the right record before I search their interviews.

## Items
- [MV-TR01] blocker · It used list_field_values once.
  evidence: call:metaview.list_field_values#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_field_values#1 args.rationale present
- [MV-PR02] major · It searched the candidate field.
  evidence: call:metaview.list_field_values#1 args.field_id matches /candidate/i
- [MV-OC01] major · The answer names the match, or shows the several matches with enough to choose.
  evidence: text:any matches /(found|match|one record|several)/i
- [MV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
