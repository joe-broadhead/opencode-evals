# tools-events-list
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: tools RPC contract
- Decision tested: history_events_list, the feed for collectors: used only when asked for a change feed, with since (and cursor) and not for answering questions.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 300000

## Prompt
I want the raw change feed of my sessions over the last 7 days, as events. use the history events list. how many events came back, and what is the title of the newest one?

## Items
- [H-OC01] blocker · It called history events_list.
  evidence: call:history.events_list#1

- [H-OC02] major · It reports the newest event's title: the Sentry triage session from today.
  evidence: text:any matches /Triage Sentry/i

- [H-OC03] major · It reports a number of events.
  evidence: text:any matches /\b\d+\b/i

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:apply_patch
