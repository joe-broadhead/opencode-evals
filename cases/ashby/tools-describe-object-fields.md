# tools-describe-object-fields
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: describe_object_fields (Ashby MCP; the fields a record type supports)
- Decision tested: A which-fields question describes the record type once, and answers with the fields it has
- Data check: the Ashby organisation has offer records, or the answer says which fields there are
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
what fields can I filter offers by in Ashby? I want to pull the ones still open.

## Items
- [ASH-OC01] blocker · It read it with describe_object_fields once.
  evidence: count:ashby.describe_object_fields == 1
- [ASH-PR01] major · It described the offer record type.
  evidence: call:ashby.describe_object_fields#1 args.objectType matches /offer/i
- [ASH-OC02] major · The answer lists fields, not records.
  evidence: text:any matches /field|status|filter/i
