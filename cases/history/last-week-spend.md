# last-week-spend
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: truth: 34.98 excluding subagents, 36.53 including
- Decision tested: A rolling-window total: since: 7d (or a date), summed over all projects.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Set: guard
- Truth: sql.spend7d.excl == 34.98; sql.spend7d.incl == 36.53

## Prompt
what did I spend on OpenCode in the last 7 days, all projects together?

## Items
- [H-OC01] blocker · The total is $34.98 (top-level sessions) or $36.53 (with subagent sessions).
  evidence: text:any matches /34\.98|36\.53/i

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

- [H-EF01] minor · No more than three history calls.
  evidence: budget:inner_calls <= 3

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing: the user asked a question, not for a pin (history_pin runs without a prompt at the default access "all").
  evidence: absent:history_pin
