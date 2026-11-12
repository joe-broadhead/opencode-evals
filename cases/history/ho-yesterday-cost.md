# ho-yesterday-cost
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: yesterday-1..5
- Decision tested: Held out: a time window plus a sum.
- Seed: cwd=api time=day
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Holdout: true

## Prompt
how much did yesterday's sessions cost in total?

## Items
- [H-OC01] blocker · The total is $3.40 (this project) or $3.90 (all projects).
  evidence: text:any matches /3\.40|3.4\b|3\.90|3.9\b/i

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
