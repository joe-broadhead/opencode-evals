# hot-file
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: hot-file filler (settings.ts in 8 sessions)
- Decision tested: An aggregate over file touches: one SQL statement (or files calls), not a guess.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
which file have we changed in the most different sessions?

## Items
- [H-OC01] blocker · It names src/config/settings.ts.
  evidence: text:any matches /config/settings\.ts|settings\.ts/i

- [H-OC02] major · It states the count: 8 sessions.
  evidence: text:any matches /\b8\b|eight/i

- [H-OC08] major · It used the history tools (sql or files).
  evidence: count:history.* >= 1

- [H-EF01] minor · One or two queries were enough.
  evidence: budget:inner_calls <= 4

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:apply_patch
