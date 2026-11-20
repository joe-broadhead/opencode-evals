# route-calendar-1
- Plugin: gws
- Skill under test: opencode-gws
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: The user's calendar is Google's when it is a Google calendar, so gws answers and Notion's calendar tools stay out.
- Data check: data=seeded; the evals account's primary calendar has tomorrow's events
- Seed: plugins=notion
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what's on my calendar tomorrow?

## Items
- [GWS-TR01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:gws.read#1

- [GWS-TR02] major · The overlapping plugin is not called.
  evidence: absent:notion.*

- [GWS-OC01] major · The answer reports what it found, from the source it used.
  evidence_any: text:any matches /(tomorrow|calendar|event|no events)/i

## Notes
- Notion's calendar tools read the calendars connected to Notion; the default is the user's own Google calendar.
