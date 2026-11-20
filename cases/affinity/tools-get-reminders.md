# tools-get-reminders
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_reminders (reminders on records, filtered)
- Decision tested: A what-reminders-are-due question is one get_reminders for the window
- Data check: affinity: at least one reminder due this week
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what CRM reminders are due this week?

## Items
- [AFF-OC01] blocker · It used get_reminders once.
  evidence: count:affinity.get_reminders == 1
- [AFF-PR01] major · It bounded the window.
  evidence: call:affinity.get_reminders#1 args.due_before present
- [AFF-OC03] major · The answer lists the reminders and the records they are on.
  evidence: text:any matches /(reminder|due|company|none)/i
