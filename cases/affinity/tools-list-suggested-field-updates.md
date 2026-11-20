# tools-list-suggested-field-updates
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: list_suggested_field_updates (the user's sets, newest first)
- Decision tested: A list-my-sets question is one list, optionally by status
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
list my pending suggested field updates.

## Items
- [AFF-TR01] blocker · It used list_suggested_field_updates once.
  evidence: call:affinity.list_suggested_field_updates#1
- [AFF-PR01] major · It filtered to pending.
  evidence: call:affinity.list_suggested_field_updates#1 args.status == "pending"
- [AFF-OC01] major · The answer lists the sets.
  evidence: text:any matches /(suggest|set|pending|none)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
