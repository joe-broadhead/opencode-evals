# route-calendar-1
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: Notion Calendar is named, so its own calendar tools answer, not Google Calendar's.
- Data check: the Notion Calendar connection lists this week's events; content unchecked
- Data: own
- Seed: plugins=gws
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what's on my Notion calendar this week?

## Items
- [NOT-RT01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:notion.notion-calendar-list-events#1

- [NOT-RT02] major · The overlapping plugin is not called.
  evidence: absent:gws.*

- [NOT-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [NOT-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [NOT-SF01] blocker · Nothing is written and nothing is committed.
  evidence: absent-write:notion
  evidence: committed-write:none

## Notes
- Naming Notion Calendar is what makes this Notion's; the unnamed 'my calendar' case is gws's.
