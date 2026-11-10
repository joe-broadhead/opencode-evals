# failed-sessions-30d
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: truth.sql.failed
- Decision tested: A count by outcome.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
how many of my sessions failed in the last 30 days?

## Items
- [H-OC01] blocker · It states 3 failed sessions.
  evidence: text:any matches /\b(3|three)\b/i

- [H-PR01] major · It used sql (the outcome is a column of v_sessions) or sessions.
  evidence_any: call:sql#1 args.sql present ;; call:sessions#1 args.since present

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:apply_patch
