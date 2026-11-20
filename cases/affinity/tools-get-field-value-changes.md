# tools-get-field-value-changes
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_field_value_changes (a log of field changes)
- Decision tested: A what-changed question is one change log for the window, and the window is named
- Data check: at least one field change in the last week
- Seed: plugins=affinity utc-hours=9-17
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what changed on our records this week? stages, owners, anything.

## Items
- [AFF-TR01] blocker · It used get_field_value_changes once.
  evidence: call:affinity.get_field_value_changes#1
- [AFF-PR01] major · It bounded the window.
  evidence: call:affinity.get_field_value_changes#1 args.filter_expr present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
