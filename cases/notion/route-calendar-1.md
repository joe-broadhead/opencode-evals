# route-calendar-1
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: Notion Calendar is named, so its own calendar tools answer, not Google Calendar's.
- Data check: data=seeded; the Notion Calendar connection lists this week's events
- Seed: plugins=gws
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what's on my Notion calendar this week?

## Items
- [NOT-TR01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:notion.notion-calendar-list-events#1

- [NOT-TR02] major · The overlapping plugin is not called.
  evidence: absent:gws.*

- [NOT-OC01] major · The answer reports what it found, from the source it used.
  evidence_any: text:any matches /(event|week|calendar)/i

## Notes
- Naming Notion Calendar is what makes this Notion's; the unnamed 'my calendar' case is gws's.
