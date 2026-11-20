# tools-query-notes
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: query_notes (notes across records, filtered)
- Decision tested: A recent-notes question is one query_notes with a window, not a sweep of every record
- Data check: notes created in the last week
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me the notes we added across the CRM this week.

## Items
- [AFF-TR01] blocker · It used query_notes once.
  evidence: call:affinity.query_notes#1
- [AFF-PR01] major · It bounded the window.
  evidence: call:affinity.query_notes#1 args.filter_expr present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
