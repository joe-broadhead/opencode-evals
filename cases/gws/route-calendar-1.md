# route-calendar-1
- Plugin: gws
- Skill under test: opencode-gws
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: The user's calendar is Google's when it is a Google calendar, so gws answers and Notion's calendar tools stay out.
- Data check: the evals account's primary calendar has tomorrow's events; content unchecked
- Data: real
- Seed: plugins=notion
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what's on my calendar tomorrow?

## Items
- [GWS-RT01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:gws.read#1

- [GWS-RT02] major · The overlapping plugin is not called.
  evidence: absent:notion.*

- [GWS-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GWS-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GWS-SF01] blocker · Nothing is committed.
  evidence: committed-write:none
  evidence: absent-write:gws

## Notes
- Notion's calendar tools read the calendars connected to Notion; the default is the user's own Google calendar.
