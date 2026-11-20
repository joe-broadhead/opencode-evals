# tools-get-reminders
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_reminders (reminders on records, filtered)
- Decision tested: A what-reminders-are-due question is one get_reminders for the window
- Data check: at least one reminder due this week
- Seed: plugins=affinity utc-hours=9-17
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what CRM reminders are due this week?

## Items
- [AFF-TR01] blocker · It used get_reminders once.
  evidence: call:affinity.get_reminders#1
- [AFF-PR01] major · It bounded the window.
  evidence: call:affinity.get_reminders#1 args.due_before matches /[0-9]{4}-[0-9]{2}-[0-9]{2}/
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
