# tools-query-notes
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: query_notes (notes across records, filtered)
- Decision tested: A recent-notes question is one query_notes with a window, not a sweep of every record
- Data check: affinity: notes created in the last week
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me the notes we added across the CRM this week.

## Items
- [AFF-OC01] blocker · It used query_notes once.
  evidence: count:affinity.query_notes == 1
- [AFF-PR01] major · It bounded the window.
  evidence: call:affinity.query_notes#1 args.filter_expr present
- [AFF-OC03] major · The answer lists the notes with the records they belong to.
  evidence: text:any matches /(note|company|2026-)/i
