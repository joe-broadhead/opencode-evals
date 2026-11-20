# tools-get-field-value-changes
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_field_value_changes (a log of field changes)
- Decision tested: A what-changed question is one change log for the window, and the window is named
- Data check: affinity: at least one field change in the last week
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what changed on our records this week? stages, owners, anything.

## Items
- [AFF-OC01] blocker · It used get_field_value_changes once.
  evidence: count:affinity.get_field_value_changes == 1
- [AFF-PR01] major · It bounded the window.
  evidence: call:affinity.get_field_value_changes#1 args.filter_expr present
- [AFF-OC03] major · The answer lists the changes and names the window.
  evidence: text:any matches /(changed|stage|owner|week|2026-)/i
