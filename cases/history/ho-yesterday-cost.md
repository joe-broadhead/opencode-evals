# ho-yesterday-cost
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: yesterday-1..5
- Decision tested: A time window plus a sum (a former holdout, public since the lab report: now a tune case).
- Seed: cwd=api time=day
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Holdout: false
- Set: core
- Truth: sql.yesterdayCalendar.api == 3.4; sql.yesterdayCalendar.all == 3.9

## Prompt
how much did yesterday's sessions cost in total?

## Items
- [H-OC01] blocker · The total is $3.40 (this project) or $3.90 (all projects).
  evidence: text:any matches /\$ ?3\.(40?|90?)\b|\b3\.(40|90)\b/i

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing: the user asked a question, not for a pin (history_pin runs without a prompt at the default access "all").
  evidence: absent:history_pin
