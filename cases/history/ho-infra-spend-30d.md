# ho-infra-spend-30d
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: truth.sql.spend30dByProject
- Decision tested: Held out: a per-project cost question.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Holdout: true
- Status: retired

## Prompt
how much did I spend on lumen-infra sessions in the last 30 days?

## Items
- [H-OC01] blocker · It states $14.18.
  evidence: text:any matches /14\.18/i

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

- [H-EF01] minor · No more than three history calls.
  evidence: budget:inner_calls <= 3

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
