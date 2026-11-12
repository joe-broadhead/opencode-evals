# spend-by-project-30d
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: truth.sql.spend30dByProject
- Decision tested: A report across projects: one sql statement, with a UTC date comparison done correctly.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Set: guard
- Truth: sql.spend30dByProject[project=lumen-api].usd == 80.84; sql.spend30dByProjectIncl[project=lumen-api].usd == 87.7; sql.spend30dByProject[project=lumen-web].usd == 16.57; sql.spend30dByProject[project=lumen-infra].usd == 14.18; sql.spend30dByProject[project=data-pipeline].usd == 9.54; sql.spend30dByProject[project=recipe-box].usd == 6.84; sql.spend30dByProject[project=dotfiles].usd == 5.83

## Prompt
how much have I spent per project over the last 30 days?

## Items
- [H-OC01] blocker · lumen-api: $80.84 (or $87.70 with its subagent sessions).
  evidence: text:any matches /80\.84|87\.70/i

- [H-OC02] major · lumen-web $16.57, lumen-infra $14.18, data-pipeline $9.54.
  evidence: text:any matches /16\.57/i
  evidence: text:any matches /14\.18/i
  evidence: text:any matches /9\.54/i

- [H-OC03] major · recipe-box $6.84 and dotfiles $5.83.
  evidence: text:any matches /6\.84/i
  evidence: text:any matches /5\.83/i

- [H-PR01] major · It used one sql statement (or very few) instead of paging through sessions.
  evidence_any: call:history.sql#1 args.sql present

- [H-EF01] minor · No more than three history calls.
  evidence: budget:inner_calls <= 3

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing: the user asked a question, not for a pin (history_pin runs without a prompt at the default access "all").
  evidence: absent:history_pin
