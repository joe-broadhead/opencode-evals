# tools-describe-object-fields
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: describe_object_fields (Ashby MCP; the fields a record type supports)
- Decision tested: A which-fields question describes the record type once, and answers with the fields it has
- Data check: the Ashby organisation has offer records, or the answer says which fields there are
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
what fields can I filter offers by in Ashby? I want to pull the ones still open.

## Items
- [ASH-TR01] blocker · It read it with describe_object_fields once.
  evidence: call:ashby.describe_object_fields#1
- [ASH-PR01] major · It described the offer record type.
  evidence: call:ashby.describe_object_fields#1 args.objectType matches /offer/i
- [ASH-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: absent-write:ashby
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
